"""
OpenViktor Modal.com tool execution backend.

Deploys a web endpoint that receives tool execution requests and runs them
inside a Debian container with a persistent workspace volume.

All tools are implemented natively in Python — no bun/Node subprocess needed.

Usage (from repo root):
    modal deploy infra/modal/app.py

Environment variables (set via `modal secret`):
    TOOL_TOKEN - Bearer token for authenticating requests from the bot
"""

import base64
import os
import subprocess
from pathlib import Path
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("openviktor-tools")

volume = modal.Volume.from_name("openviktor-workspaces", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ripgrep")
    .pip_install("fastapi[standard]")
)

WORKSPACE_ROOT = "/data/workspaces"
WORKSPACE_SUBDIRS = ("skills", "crons", "logs", "temp", "repos")
MAX_OUTPUT_BYTES = 32_768
KNOWN_TOOLS = {"bash", "file_read", "file_write", "file_edit", "glob", "grep", "view_image"}


# ---------------------------------------------------------------------------
# Workspace helpers
# ---------------------------------------------------------------------------

def ensure_workspace(workspace_id: str) -> str:
    if not workspace_id or "/" in workspace_id or "\\" in workspace_id or ".." in workspace_id:
        raise ValueError(f"Invalid workspace_id: {workspace_id}")
    base = os.path.join(WORKSPACE_ROOT, workspace_id)
    for sub in WORKSPACE_SUBDIRS:
        os.makedirs(os.path.join(base, sub), exist_ok=True)
    return base


def resolve_safe_path(workspace_dir: str, user_path: str) -> str:
    abs_workspace = os.path.realpath(workspace_dir)
    abs_target = os.path.realpath(os.path.join(abs_workspace, user_path))
    if not abs_target.startswith(abs_workspace + "/") and abs_target != abs_workspace:
        raise ValueError(f"Path escapes workspace: {user_path}")
    return abs_target


# ---------------------------------------------------------------------------
# Tool executors — each returns {"result": ...} or {"error": ...}
# ---------------------------------------------------------------------------

def tool_bash(args: dict, workspace_dir: str, timeout_ms: int) -> dict:
    command = args.get("command", "")
    per_cmd_timeout = args.get("timeout_ms", 120_000)
    timeout_s = min(per_cmd_timeout, timeout_ms) / 1000

    try:
        result = subprocess.run(
            ["bash", "-c", command],
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=workspace_dir,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": workspace_dir, "LANG": os.environ.get("LANG", "C.UTF-8")},
            stdin=subprocess.DEVNULL,
        )
        stdout = result.stdout[:MAX_OUTPUT_BYTES]
        stderr = result.stderr[:MAX_OUTPUT_BYTES]
        return {"result": {"exit_code": result.returncode, "stdout": stdout, "stderr": stderr}}
    except subprocess.TimeoutExpired:
        return {"error": f"Command timed out after {timeout_s}s"}


def tool_file_read(args: dict, workspace_dir: str) -> dict:
    try:
        abs_path = resolve_safe_path(workspace_dir, args["path"])
    except (ValueError, KeyError) as e:
        return {"error": str(e)}

    if not os.path.isfile(abs_path):
        return {"error": f"Not a file: {args['path']}"}

    with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    offset = max(int(args.get("offset", 1)), 1)
    raw_limit = args.get("limit")
    limit = int(raw_limit) if raw_limit is not None else None
    start = offset - 1
    sliced = all_lines[start : start + limit] if limit is not None else all_lines[start:]

    content = "".join(f"{start + i + 1:>6}\t{line}" for i, line in enumerate(sliced))
    if len(content) > MAX_OUTPUT_BYTES:
        content = content[:MAX_OUTPUT_BYTES] + "\n... (output truncated)"

    return {"result": {"content": content, "total_lines": len(all_lines), "lines_shown": len(sliced)}}


def tool_file_write(args: dict, workspace_dir: str) -> dict:
    try:
        abs_path = resolve_safe_path(workspace_dir, args["path"])
    except (ValueError, KeyError) as e:
        return {"error": str(e)}

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    content = args.get("content", "")
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)

    return {"result": {"path": args["path"], "bytes_written": len(content.encode("utf-8"))}}


def tool_file_edit(args: dict, workspace_dir: str) -> dict:
    try:
        abs_path = resolve_safe_path(workspace_dir, args["path"])
    except (ValueError, KeyError) as e:
        return {"error": str(e)}

    old_string = args.get("old_string", "")
    new_string = args.get("new_string", "")
    replace_all = args.get("replace_all", False)

    if not old_string:
        return {"error": "old_string must not be empty"}

    if not os.path.isfile(abs_path):
        return {"error": f"File not found: {args['path']}"}

    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()

    if old_string not in content:
        return {"error": "old_string not found in file"}

    if not replace_all:
        first = content.index(old_string)
        second = content.find(old_string, first + 1)
        if second != -1:
            return {"error": "old_string matches multiple locations. Provide more context or set replace_all to true."}

    count = content.count(old_string) if replace_all else 1
    updated = content.replace(old_string, new_string) if replace_all else content.replace(old_string, new_string, 1)

    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(updated)

    return {"result": {"path": args["path"], "replacements": count}}


def tool_glob(args: dict, workspace_dir: str) -> dict:
    pattern = args.get("pattern", "*")
    search_dir = workspace_dir
    if "path" in args and args["path"]:
        try:
            search_dir = resolve_safe_path(workspace_dir, args["path"])
        except ValueError as e:
            return {"error": str(e)}

    try:
        result = subprocess.run(
            ["find", search_dir, "-maxdepth", "10", "-type", "f", "-name", pattern],
            capture_output=True,
            text=True,
            timeout=30,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"error": "Glob search timed out"}

    prefix = workspace_dir if workspace_dir.endswith("/") else workspace_dir + "/"
    files = sorted(
        line.removeprefix(prefix)
        for line in result.stdout.strip().split("\n")
        if line
    )[:500]

    return {"result": {"files": files, "count": len(files), "truncated": len(files) >= 500}}


def tool_grep(args: dict, workspace_dir: str) -> dict:
    pattern = args.get("pattern", "")
    search_path = workspace_dir
    if "path" in args and args["path"]:
        try:
            search_path = resolve_safe_path(workspace_dir, args["path"])
        except ValueError as e:
            return {"error": str(e)}

    rg_args = ["rg", "--color", "never", "--line-number"]
    if args.get("include"):
        rg_args += ["--glob", args["include"]]
    if args.get("context"):
        rg_args += ["-C", str(int(args["context"]))]
    if args.get("max_count"):
        rg_args += ["-m", str(int(args["max_count"]))]
    if args.get("case_insensitive"):
        rg_args.append("-i")
    rg_args += ["--", pattern, search_path]

    try:
        result = subprocess.run(
            rg_args,
            capture_output=True,
            text=True,
            timeout=30,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"error": "Grep timed out"}

    prefix = workspace_dir if workspace_dir.endswith("/") else workspace_dir + "/"
    content = result.stdout[:MAX_OUTPUT_BYTES].replace(prefix, "")

    if result.returncode == 1 and not result.stdout:
        return {"result": {"content": "", "match_count": 0}}

    if result.returncode not in (0, 1) and result.stderr:
        return {"error": f"Grep failed: {result.stderr.strip()}"}

    return {"result": {"content": content, "truncated": len(result.stdout) > MAX_OUTPUT_BYTES}}


MIME_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp",
}
MAX_IMAGE_SIZE = 3 * 1024 * 1024


def tool_view_image(args: dict, workspace_dir: str) -> dict:
    try:
        abs_path = resolve_safe_path(workspace_dir, args["path"])
    except (ValueError, KeyError) as e:
        return {"error": str(e)}

    ext = os.path.splitext(abs_path)[1].lower()
    mime = MIME_TYPES.get(ext)
    if not mime:
        return {"error": f"Unsupported image format: {ext}. Supported: {', '.join(MIME_TYPES)}"}

    size = os.path.getsize(abs_path)
    if size > MAX_IMAGE_SIZE:
        return {"error": f"File too large: {size / 1024 / 1024:.1f}MB (max {MAX_IMAGE_SIZE / 1024 / 1024}MB)"}

    with open(abs_path, "rb") as f:
        data = f.read()

    return {"result": {"mime_type": mime, "base64": base64.b64encode(data).decode(), "size_bytes": size}}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

TOOL_DISPATCH = {
    "bash": lambda args, wd, tms: tool_bash(args, wd, tms),
    "file_read": lambda args, wd, _: tool_file_read(args, wd),
    "file_write": lambda args, wd, _: tool_file_write(args, wd),
    "file_edit": lambda args, wd, _: tool_file_edit(args, wd),
    "glob": lambda args, wd, _: tool_glob(args, wd),
    "grep": lambda args, wd, _: tool_grep(args, wd),
    "view_image": lambda args, wd, _: tool_view_image(args, wd),
}


# ---------------------------------------------------------------------------
# Modal endpoint
# ---------------------------------------------------------------------------

class ToolRequest(BaseModel):
    tool_name: str
    arguments: dict = {}
    workspace_id: str = "default"
    timeout_ms: int = 600_000
    auth_token: Optional[str] = None


@app.function(
    image=image,
    volumes={"/data/workspaces": volume},
    timeout=660,
    secrets=[modal.Secret.from_name("openviktor-tools")],
)
@modal.fastapi_endpoint(method="POST")
def execute(request: ToolRequest) -> dict:
    """Execute a tool in an isolated Modal container."""
    auth_token = os.environ.get("TOOL_TOKEN", "")
    if not auth_token or request.auth_token != auth_token:
        return {"error": "Unauthorized"}

    if request.tool_name not in TOOL_DISPATCH:
        return {"error": f"Unknown tool: {request.tool_name}"}

    try:
        workspace_dir = ensure_workspace(request.workspace_id)
        return TOOL_DISPATCH[request.tool_name](request.arguments, workspace_dir, request.timeout_ms)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}"}
