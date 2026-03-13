"""
OpenViktor Modal.com tool execution backend.

Deploys a web endpoint that receives tool execution requests and runs them
inside a Debian container with a persistent workspace volume.

All tools are implemented natively in Python — no bun/Node subprocess needed.

Usage (from repo root):
    modal deploy infra/modal/app.py

Environment variables (set via `modal secret`):
    TOOL_TOKEN          - Bearer token for authenticating requests from the bot
    SLACK_BOT_TOKEN     - Slack Bot User OAuth Token
    GITHUB_TOKEN        - GitHub personal access token
    BROWSERBASE_API_KEY - Browserbase API key
    SEARCH_API_KEY      - Brave Search API key
    IMAGEN_API_KEY      - Google Imagen API key
    CONTEXT7_BASE_URL   - Context7 API base URL (default: https://context7.com/api)
"""

import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import modal
from pydantic import BaseModel

app = modal.App("openviktor-tools")

volume = modal.Volume.from_name("openviktor-workspaces", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ripgrep", "git", "pandoc", "poppler-utils", "curl")
    .pip_install("fastapi[standard]")
    .run_commands("(curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg) && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' > /etc/apt/sources.list.d/github-cli.list && apt-get update && apt-get install -y gh")
)

WORKSPACE_ROOT = "/data/workspaces"
WORKSPACE_SUBDIRS = ("skills", "crons", "logs", "temp", "repos")
MAX_OUTPUT_BYTES = 32_768
SLACK_API_BASE = "https://slack.com/api"
BROWSERBASE_API_BASE = "https://www.browserbase.com/v1"
DEFAULT_CONTEXT7_BASE_URL = "https://context7.com/api"


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
# HTTP / Slack helpers
# ---------------------------------------------------------------------------

def _http_json_request(url: str, *, method: str = "GET", headers: dict | None = None,
                       body: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _http_download(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def slack_api_call(method: str, params: dict[str, str]) -> dict:
    token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not token:
        return {"ok": False, "error": "SLACK_BOT_TOKEN not configured"}
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        f"{SLACK_API_BASE}/{method}",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"Slack API HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not data.get("ok"):
        return {"ok": False, "error": f"Slack API error ({method}): {data.get('error', 'unknown')}"}
    return data


def slack_api_call_json(method: str, body: dict) -> dict:
    token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not token:
        return {"ok": False, "error": "SLACK_BOT_TOKEN not configured"}
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{SLACK_API_BASE}/{method}",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"Slack API HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if not data.get("ok"):
        return {"ok": False, "error": f"Slack API error ({method}): {data.get('error', 'unknown')}"}
    return data


def _require_str(args: dict, key: str) -> str:
    v = args.get(key)
    if not isinstance(v, str) or not v:
        raise ValueError(f"Invalid or missing required argument: {key}")
    return v


# ---------------------------------------------------------------------------
# Core tool executors (original 7)
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
# Slack Communication tools (9)
# ---------------------------------------------------------------------------

def tool_coworker_slack_history(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
    except ValueError as e:
        return {"error": str(e)}

    params: dict[str, str] = {"channel": channel, "limit": str(args.get("limit", 20))}
    if args.get("oldest"):
        params["oldest"] = str(args["oldest"])
    if args.get("latest"):
        params["latest"] = str(args["latest"])

    data = slack_api_call("conversations.history", params)
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    messages = []
    for msg in data.get("messages", []):
        if isinstance(msg, dict) and msg.get("ts"):
            messages.append({
                "ts": msg["ts"],
                "user": msg.get("user"),
                "text": msg.get("text"),
                "thread_ts": msg.get("thread_ts"),
            })

    return {"result": {"messages": messages, "has_more": data.get("has_more", False)}}


def tool_coworker_send_slack_message(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        text = _require_str(args, "text")
    except ValueError as e:
        return {"error": str(e)}

    params: dict[str, str] = {"channel": channel, "text": text}
    if args.get("thread_ts"):
        params["thread_ts"] = str(args["thread_ts"])

    data = slack_api_call("chat.postMessage", params)
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    ts = data.get("ts", "")
    if not ts:
        return {"error": "Slack response missing message timestamp"}

    return {"result": {"ts": ts, "channel": data.get("channel", channel)}}


def tool_coworker_slack_react(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        timestamp = _require_str(args, "timestamp")
        emoji = _require_str(args, "emoji")
    except ValueError as e:
        return {"error": str(e)}

    if ":" in emoji:
        return {"error": "Emoji must not include colons"}

    data = slack_api_call("reactions.add", {"channel": channel, "timestamp": timestamp, "name": emoji})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    return {"result": {"ok": True}}


def tool_coworker_delete_slack_message(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        timestamp = _require_str(args, "timestamp")
    except ValueError as e:
        return {"error": str(e)}

    data = slack_api_call("chat.delete", {"channel": channel, "ts": timestamp})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    return {"result": {"ok": True}}


def tool_coworker_upload_to_slack(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        file_path = _require_str(args, "file_path")
    except ValueError as e:
        return {"error": str(e)}

    try:
        abs_path = resolve_safe_path(workspace_dir, file_path)
    except ValueError as e:
        return {"error": str(e)}

    if not os.path.isfile(abs_path):
        return {"error": f"File not found: {file_path}"}

    filename = args.get("filename") or os.path.basename(file_path)
    title = args.get("title") or filename

    with open(abs_path, "rb") as f:
        content = f.read()

    init = slack_api_call("files.getUploadURLExternal", {
        "filename": filename,
        "length": str(len(content)),
    })
    if not init.get("ok"):
        return {"error": init.get("error", "Failed to get upload URL")}

    upload_url = init.get("upload_url", "")
    file_id = init.get("file_id", "")
    if not upload_url or not file_id:
        return {"error": "Slack response missing upload_url or file_id"}

    try:
        req = urllib.request.Request(upload_url, data=content, headers={"Content-Type": "application/octet-stream"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            pass
    except Exception as e:
        return {"error": f"File upload failed: {e}"}

    complete = slack_api_call("files.completeUploadExternal", {
        "files": json.dumps([{"id": file_id, "title": title}]),
        "channel_id": channel,
    })
    if not complete.get("ok"):
        return {"error": complete.get("error", "Failed to complete upload")}

    permalink = ""
    if isinstance(complete.get("file"), dict):
        permalink = complete["file"].get("permalink", "")
    elif isinstance(complete.get("files"), list) and complete["files"]:
        first = complete["files"][0]
        if isinstance(first, dict):
            permalink = first.get("permalink", "")

    return {"result": {"file_id": file_id, "permalink": permalink}}


def tool_coworker_download_from_slack(args: dict, workspace_dir: str) -> dict:
    try:
        url = _require_str(args, "url")
        save_path = _require_str(args, "save_path")
    except ValueError as e:
        return {"error": str(e)}

    try:
        abs_path = resolve_safe_path(workspace_dir, save_path)
    except ValueError as e:
        return {"error": str(e)}

    token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not token:
        return {"error": "SLACK_BOT_TOKEN not configured"}

    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".slack.com"):
            return {"error": "URL must be an https://*.slack.com address"}
    except Exception:
        return {"error": "Invalid URL"}

    try:
        data = _http_download(url, {"Authorization": f"Bearer {token}"})
    except Exception as e:
        return {"error": f"Download failed: {e}"}

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(data)

    return {"result": {"bytes_written": len(data), "path": save_path}}


def tool_create_thread(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        text = _require_str(args, "text")
    except ValueError as e:
        return {"error": str(e)}

    data = slack_api_call("chat.postMessage", {"channel": channel, "text": text})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    ts = data.get("ts", "")
    if not ts:
        return {"error": "Slack response missing message timestamp"}

    return {"result": {"ts": ts, "channel": data.get("channel", channel), "thread_ts": ts}}


def tool_send_message_to_thread(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        thread_ts = _require_str(args, "thread_ts")
        text = _require_str(args, "text")
    except ValueError as e:
        return {"error": str(e)}

    data = slack_api_call("chat.postMessage", {"channel": channel, "thread_ts": thread_ts, "text": text})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    ts = data.get("ts", "")
    if not ts:
        return {"error": "Slack response missing message timestamp"}

    return {"result": {"ts": ts, "channel": data.get("channel", channel), "thread_ts": thread_ts}}


def tool_wait_for_paths(args: dict, workspace_dir: str) -> dict:
    raw_paths = args.get("paths")
    if not isinstance(raw_paths, list) or any(not isinstance(p, str) for p in raw_paths):
        return {"error": "paths must be an array of strings"}

    timeout_ms = args.get("timeout_ms", 30_000)
    poll_interval_ms = args.get("poll_interval_ms", 500)

    if timeout_ms < 0 or poll_interval_ms <= 0:
        return {"error": "timeout_ms must be >= 0 and poll_interval_ms must be > 0"}

    targets = []
    for p in raw_paths:
        try:
            targets.append({"relative": p, "absolute": resolve_safe_path(workspace_dir, p)})
        except ValueError as e:
            return {"error": str(e)}

    found: set[str] = set()
    start = time.monotonic()
    timeout_s = timeout_ms / 1000

    while (time.monotonic() - start) <= timeout_s:
        for t in targets:
            if t["relative"] not in found and os.path.exists(t["absolute"]):
                found.add(t["relative"])
        if len(found) == len(targets):
            break
        time.sleep(poll_interval_ms / 1000)

    elapsed_ms = int((time.monotonic() - start) * 1000)
    found_list = [p for p in raw_paths if p in found]
    missing_list = [p for p in raw_paths if p not in found]

    return {"result": {"found": found_list, "missing": missing_list, "elapsed_ms": elapsed_ms}}


# ---------------------------------------------------------------------------
# Slack Admin tools (8)
# ---------------------------------------------------------------------------

def tool_coworker_list_slack_channels(args: dict, workspace_dir: str) -> dict:
    types = args.get("types", "public_channel,private_channel")
    if not isinstance(types, str) or not types.strip():
        types = "public_channel,private_channel"
    limit = args.get("limit", 200)

    data = slack_api_call_json("conversations.list", {"types": types, "limit": limit})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    channels = [
        {"id": ch["id"], "name": ch.get("name", ""), "is_private": ch.get("is_private", False), "num_members": ch.get("num_members")}
        for ch in data.get("channels", [])
        if isinstance(ch, dict) and ch.get("id")
    ]
    result: dict = {"channels": channels}
    cursor = (data.get("response_metadata") or {}).get("next_cursor", "")
    if cursor and cursor.strip():
        result["next_cursor"] = cursor
    return {"result": result}


def tool_coworker_join_slack_channels(args: dict, workspace_dir: str) -> dict:
    channel_ids = args.get("channel_ids")
    if not isinstance(channel_ids, list) or any(not isinstance(c, str) for c in channel_ids):
        return {"error": "channel_ids must be an array of strings"}

    joined = []
    failed = []
    for cid in channel_ids:
        resp = slack_api_call_json("conversations.join", {"channel": cid})
        if resp.get("ok"):
            joined.append(cid)
        else:
            failed.append(cid)

    return {"result": {"joined": joined, "failed": failed}}


def tool_coworker_open_slack_conversation(args: dict, workspace_dir: str) -> dict:
    user_ids = args.get("user_ids")
    if not isinstance(user_ids, list) or any(not isinstance(u, str) for u in user_ids):
        return {"error": "user_ids must be an array of strings"}

    users = ",".join(user_ids)
    data = slack_api_call_json("conversations.open", {"users": users})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    channel = data.get("channel")
    if isinstance(channel, str):
        channel_id = channel
    elif isinstance(channel, dict):
        channel_id = channel.get("id", "")
    else:
        return {"error": "Slack response missing channel id"}

    if not channel_id:
        return {"error": "Slack response missing channel id"}

    return {"result": {"channel_id": channel_id}}


def tool_coworker_leave_slack_channels(args: dict, workspace_dir: str) -> dict:
    channel_ids = args.get("channel_ids")
    if not isinstance(channel_ids, list) or any(not isinstance(c, str) for c in channel_ids):
        return {"error": "channel_ids must be an array of strings"}

    left = []
    failed = []
    for cid in channel_ids:
        resp = slack_api_call_json("conversations.leave", {"channel": cid})
        if resp.get("ok"):
            left.append(cid)
        else:
            failed.append(cid)

    return {"result": {"left": left, "failed": failed}}


def tool_coworker_list_slack_users(args: dict, workspace_dir: str) -> dict:
    limit = args.get("limit", 200)
    data = slack_api_call_json("users.list", {"limit": limit})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    members = [
        {"id": m["id"], "name": m.get("name", ""), "real_name": m.get("real_name", ""), "is_bot": m.get("is_bot", False)}
        for m in data.get("members", [])
        if isinstance(m, dict) and m.get("id")
    ]
    result: dict = {"members": members}
    cursor = (data.get("response_metadata") or {}).get("next_cursor", "")
    if cursor and cursor.strip():
        result["next_cursor"] = cursor
    return {"result": result}


def tool_coworker_invite_slack_user_to_team(args: dict, workspace_dir: str) -> dict:
    try:
        channel_id = _require_str(args, "channel_id")
        user_id = _require_str(args, "user_id")
    except ValueError as e:
        return {"error": str(e)}

    data = slack_api_call_json("conversations.invite", {"channel": channel_id, "users": user_id})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    return {"result": {"ok": True}}


def tool_coworker_get_slack_reactions(args: dict, workspace_dir: str) -> dict:
    try:
        channel = _require_str(args, "channel")
        timestamp = _require_str(args, "timestamp")
    except ValueError as e:
        return {"error": str(e)}

    data = slack_api_call_json("reactions.get", {"channel": channel, "timestamp": timestamp})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    msg = data.get("message", {})
    reactions = [
        {"name": r.get("name", ""), "count": r.get("count", 0), "users": r.get("users", [])}
        for r in msg.get("reactions", [])
        if isinstance(r, dict)
    ]

    return {"result": {"reactions": reactions}}


def tool_coworker_report_issue(args: dict, workspace_dir: str) -> dict:
    try:
        title = _require_str(args, "title")
        description = _require_str(args, "description")
    except ValueError as e:
        return {"error": str(e)}

    severity = args.get("severity", "medium")
    if severity not in ("low", "medium", "high"):
        severity = "medium"
    channel = args.get("channel", "#general")
    if not isinstance(channel, str) or not channel.strip():
        channel = "#general"

    emoji_map = {"low": "\U0001f7e2", "medium": "\U0001f7e1", "high": "\U0001f534"}
    text = f"{emoji_map[severity]} *{title}*\n\n{description}"

    data = slack_api_call_json("chat.postMessage", {"channel": channel, "text": text})
    if not data.get("ok"):
        return {"error": data.get("error", "Slack API error")}

    ts = data.get("ts") or (data.get("message") or {}).get("ts", "")
    if not ts:
        return {"error": "Slack response missing ts"}

    return {"result": {"ts": ts, "channel": channel}}


# ---------------------------------------------------------------------------
# Git tools (2)
# ---------------------------------------------------------------------------

def _run_cli(bin_name: str, cli_args: list[str], cwd: str, extra_env: dict | None = None) -> dict:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/root"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    if extra_env:
        env.update(extra_env)

    try:
        result = subprocess.run(
            [bin_name] + cli_args,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
        )
        stdout = result.stdout[:MAX_OUTPUT_BYTES]
        stderr = result.stderr[:MAX_OUTPUT_BYTES]
        return {"result": {"success": result.returncode == 0, "stdout": stdout, "stderr": stderr, "exit_code": result.returncode}}
    except subprocess.TimeoutExpired:
        return {"error": f"{bin_name} command timed out"}
    except FileNotFoundError:
        return {"error": f"{bin_name} not found on PATH"}


def tool_coworker_git(args: dict, workspace_dir: str) -> dict:
    cli_args = args.get("args")
    if not isinstance(cli_args, list) or not all(isinstance(a, str) for a in cli_args):
        return {"error": "args must be an array of strings"}

    cwd = workspace_dir
    if isinstance(args.get("working_dir"), str):
        try:
            cwd = resolve_safe_path(workspace_dir, args["working_dir"])
        except ValueError as e:
            return {"error": str(e)}

    github_token = os.environ.get("GITHUB_TOKEN", "")
    extra = {"GIT_ASKPASS": "echo", "GIT_TERMINAL_PROMPT": "0"}
    if github_token:
        extra["GITHUB_TOKEN"] = github_token

    return _run_cli("git", cli_args, cwd, extra)


def tool_coworker_github_cli(args: dict, workspace_dir: str) -> dict:
    cli_args = args.get("args")
    if not isinstance(cli_args, list) or not all(isinstance(a, str) for a in cli_args):
        return {"error": "args must be an array of strings"}

    cwd = workspace_dir
    if isinstance(args.get("working_dir"), str):
        try:
            cwd = resolve_safe_path(workspace_dir, args["working_dir"])
        except ValueError as e:
            return {"error": str(e)}

    github_token = os.environ.get("GITHUB_TOKEN", "")
    return _run_cli("gh", cli_args, cwd, {"GH_TOKEN": github_token, "NO_COLOR": "1"})


# ---------------------------------------------------------------------------
# Browser tools (3)
# ---------------------------------------------------------------------------

def tool_browser_create_session(args: dict, workspace_dir: str) -> dict:
    api_key = os.environ.get("BROWSERBASE_API_KEY", "")
    if not api_key:
        return {"error": "BROWSERBASE_API_KEY not configured"}

    starting_url = args.get("starting_url")
    if not isinstance(starting_url, str):
        return {"error": "starting_url is required"}

    viewport_width = args.get("viewport_width", 1024)
    viewport_height = args.get("viewport_height", 768)
    enable_proxies = args.get("enable_proxies", False)
    timeout_seconds = args.get("timeout_seconds", 300)

    payload = json.dumps({
        "browserSettings": {"viewport": {"width": viewport_width, "height": viewport_height}},
        "proxies": enable_proxies,
        "timeout": timeout_seconds,
        "startingUrl": starting_url,
    }).encode()

    try:
        req = urllib.request.Request(
            f"{BROWSERBASE_API_BASE}/sessions",
            data=payload,
            headers={"content-type": "application/json", "x-bb-api-key": api_key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        return {"error": f"Browserbase create session failed: {e}"}

    return {"result": {
        "session_id": data.get("id") or data.get("session_id") or data.get("sessionId") or "",
        "connect_url": data.get("connect_url") or data.get("connectUrl") or data.get("wsUrl") or "",
        "live_view_url": data.get("live_view_url") or data.get("liveViewUrl") or data.get("live_url") or "",
        "recording_url": data.get("recording_url") or data.get("recordingUrl") or None,
    }}


def tool_browser_download_files(args: dict, workspace_dir: str) -> dict:
    api_key = os.environ.get("BROWSERBASE_API_KEY", "")
    if not api_key:
        return {"error": "BROWSERBASE_API_KEY not configured"}

    session_id = args.get("session_id")
    if not isinstance(session_id, str):
        return {"error": "session_id is required"}

    target_dir = args.get("target_directory", "downloads")
    try:
        abs_dir = resolve_safe_path(workspace_dir, target_dir)
    except ValueError as e:
        return {"error": str(e)}
    os.makedirs(abs_dir, exist_ok=True)

    try:
        req = urllib.request.Request(
            f"{BROWSERBASE_API_BASE}/sessions/{urllib.parse.quote(session_id, safe='')}/downloads",
            headers={"x-bb-api-key": api_key},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        return {"error": f"Browserbase list downloads failed: {e}"}

    entries = data.get("downloads") or data.get("files") or (data if isinstance(data, list) else [])
    paths: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        url = entry.get("url") or entry.get("downloadUrl") or entry.get("download_url") or entry.get("signedUrl") or entry.get("signed_url")
        if not url:
            continue
        filename = entry.get("filename") or entry.get("name") or os.path.basename(urllib.parse.urlparse(url).path) or "download.bin"
        try:
            file_data = _http_download(url, {"x-bb-api-key": api_key})
            out_path = resolve_safe_path(abs_dir, filename)
            with open(out_path, "wb") as f:
                f.write(file_data)
            paths.append(out_path)
        except Exception:
            continue

    return {"result": {"files_downloaded": len(paths), "paths": paths}}


def tool_browser_close_session(args: dict, workspace_dir: str) -> dict:
    api_key = os.environ.get("BROWSERBASE_API_KEY", "")
    if not api_key:
        return {"error": "BROWSERBASE_API_KEY not configured"}

    session_id = args.get("session_id")
    if not isinstance(session_id, str):
        return {"error": "session_id is required"}

    try:
        payload = json.dumps({"status": "REQUEST_RELEASE"}).encode()
        req = urllib.request.Request(
            f"{BROWSERBASE_API_BASE}/sessions/{urllib.parse.quote(session_id, safe='')}",
            data=payload,
            headers={"content-type": "application/json", "x-bb-api-key": api_key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            pass
    except Exception as e:
        return {"error": f"Browserbase close session failed: {e}"}

    return {"result": {"ok": True}}


# ---------------------------------------------------------------------------
# Docs tools (2)
# ---------------------------------------------------------------------------

def tool_resolve_library_id(args: dict, workspace_dir: str) -> dict:
    library_name = args.get("library_name")
    if not isinstance(library_name, str) or not library_name:
        return {"error": "library_name is required"}

    base_url = os.environ.get("CONTEXT7_BASE_URL", DEFAULT_CONTEXT7_BASE_URL)

    try:
        search_url = f"{base_url}/search?q={urllib.parse.quote(library_name)}&limit=5"
        data = _http_json_request(search_url)
        results = data.get("results") or data.get("data") or []
        if results:
            first = results[0]
            if isinstance(first, dict):
                lib_id = first.get("library_id") or first.get("id") or first.get("slug") or ""
                if lib_id:
                    return {"result": {
                        "library_id": lib_id,
                        "name": first.get("name", lib_id),
                        "description": first.get("description", ""),
                    }}
    except Exception:
        pass

    try:
        npm_url = f"https://registry.npmjs.org/{urllib.parse.quote(library_name, safe='')}"
        npm_data = _http_json_request(npm_url)
        desc = npm_data.get("description", "") if isinstance(npm_data, dict) else ""
        return {"result": {"library_id": f"npm/{library_name}", "name": library_name, "description": desc}}
    except Exception as e:
        return {"error": str(e)}


def tool_query_library_docs(args: dict, workspace_dir: str) -> dict:
    library_id = args.get("library_id")
    if not isinstance(library_id, str) or not library_id:
        return {"error": "library_id is required"}

    topic = args.get("topic", "")
    max_tokens = args.get("max_tokens", 10_000)
    base_url = os.environ.get("CONTEXT7_BASE_URL", DEFAULT_CONTEXT7_BASE_URL)

    url = f"{base_url}/libraries/{urllib.parse.quote(library_id, safe='/')}/docs?topic={urllib.parse.quote(str(topic))}&tokens={max_tokens}"
    try:
        data = _http_json_request(url)
        if isinstance(data, dict) and data.get("ok") is False:
            return {"error": data.get("error", "Context7 API request failed")}
        return {"result": {
            "content": data.get("content", ""),
            "title": data.get("title", ""),
        }}
    except Exception as e:
        return {"error": f"Context7 request failed: {e}"}


# ---------------------------------------------------------------------------
# Utility tools (5)
# ---------------------------------------------------------------------------

def tool_file_to_markdown(args: dict, workspace_dir: str) -> dict:
    file_path = args.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        return {"error": "file_path is required"}

    try:
        abs_path = resolve_safe_path(workspace_dir, file_path)
    except ValueError as e:
        return {"error": str(e)}

    if not os.path.isfile(abs_path):
        return {"error": f"Not a file: {file_path}"}

    ext_map = {
        "pdf": "pdf", "docx": "docx", "xlsx": "xlsx", "xls": "xls",
        "pptx": "pptx", "ppt": "ppt", "rtf": "rtf", "odt": "odt", "ods": "ods", "odp": "odp",
    }
    ext = file_path.rsplit(".", 1)[-1].lower() if "." in file_path else ""
    fmt = ext_map.get(ext)
    if not fmt:
        return {"error": f"Unsupported file format. Supported: {', '.join('.' + k for k in ext_map)}"}

    try:
        result = subprocess.run(
            ["pandoc", f"--from={fmt}", "--to=markdown", abs_path],
            capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            content = result.stdout[:MAX_OUTPUT_BYTES]
            if len(result.stdout) > MAX_OUTPUT_BYTES:
                content += "\n... (output truncated)"
            return {"result": {"content": content, "format": fmt}}
    except FileNotFoundError:
        pass
    except subprocess.TimeoutExpired:
        return {"error": "File conversion timed out"}

    if fmt == "pdf":
        try:
            result = subprocess.run(
                ["pdftotext", abs_path, "-"],
                capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
            )
            if result.returncode == 0:
                content = result.stdout[:MAX_OUTPUT_BYTES]
                if len(result.stdout) > MAX_OUTPUT_BYTES:
                    content += "\n... (output truncated)"
                return {"result": {"content": content, "format": fmt}}
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    return {"error": "pandoc is required for file conversion"}


def tool_workspace_tree(args: dict, workspace_dir: str) -> dict:
    max_items = args.get("max_items_per_folder", 3)
    if not isinstance(max_items, int) or max_items < 1:
        max_items = 3

    skip_dirs = {"node_modules", ".git", "slack", "slack_visible"}

    def build_tree(dir_path: str, depth: int) -> list[str]:
        try:
            entries = sorted(os.listdir(dir_path))
        except PermissionError:
            return []

        visible = []
        for name in entries:
            full = os.path.join(dir_path, name)
            is_dir = os.path.isdir(full)
            if is_dir and name in skip_dirs:
                continue
            if not is_dir and name.endswith(".lock"):
                continue
            visible.append((name, full, is_dir))

        if depth >= 2 and len(visible) > max_items:
            hidden = len(visible) - max_items
            visible = visible[:max_items]
        else:
            hidden = 0

        lines: list[str] = []
        for i, (name, full, is_dir) in enumerate(visible):
            is_last = (i == len(visible) - 1) and hidden == 0
            connector = "\u2514\u2500\u2500 " if is_last else "\u251c\u2500\u2500 "
            continuation = "    " if is_last else "\u2502   "

            if not is_dir:
                if depth <= 1:
                    try:
                        sz = os.path.getsize(full)
                        if sz < 1024:
                            size_str = f"{sz}B"
                        elif sz < 1024 * 1024:
                            size_str = f"{sz / 1024:.1f}KB"
                        else:
                            size_str = f"{sz / (1024 * 1024):.1f}MB"
                        lines.append(f"{connector}{name} ({size_str})")
                    except OSError:
                        lines.append(f"{connector}{name}")
                else:
                    lines.append(f"{connector}{name}")
            else:
                rel = os.path.relpath(os.path.dirname(full), workspace_dir)
                if rel == "." and name == "skills":
                    lines.append(f"{connector}{name}/")
                elif rel == "." and name == "repos":
                    lines.append(f"{connector}{name}/ (repo)")
                else:
                    child_lines = build_tree(full, depth + 1)
                    lines.append(f"{connector}{name}/")
                    for cl in child_lines:
                        lines.append(f"{continuation}{cl}")

        if hidden > 0:
            lines.append(f"\u2514\u2500\u2500 ... {hidden} more")

        return lines

    tree_lines = build_tree(workspace_dir, 0)
    tree = "./\n" + "\n".join(tree_lines)
    return {"result": {"tree": tree}}


def tool_ai_structured_output(args: dict, workspace_dir: str) -> dict:
    return {"error": "ai_structured_output requires an LLM provider which is not available in the Modal backend. Use the bot's native LLM provider instead."}


def tool_quick_ai_search(args: dict, workspace_dir: str) -> dict:
    question = args.get("search_question")
    if not isinstance(question, str) or not question:
        return {"error": "search_question is required"}

    api_key = os.environ.get("SEARCH_API_KEY", "")
    if not api_key:
        return {"result": {"search_response": f"Web search not configured. Set SEARCH_API_KEY to enable live search. Cannot answer: {question}"}}

    url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(question)}&count=5"
    try:
        data = _http_json_request(url, headers={"Accept": "application/json", "X-Subscription-Token": api_key})
    except Exception as e:
        return {"error": f"Brave Search failed: {e}"}

    if isinstance(data, dict) and data.get("ok") is False:
        return {"error": data.get("error", "Brave Search request failed")}

    results = (data.get("web") or {}).get("results") or []
    if not results:
        return {"result": {"search_response": "No search results found."}}

    formatted = []
    for i, item in enumerate(results[:5]):
        if isinstance(item, dict):
            formatted.append(f"{i + 1}. {item.get('title', '')}\n{item.get('description', '')}\n{item.get('url', '')}")

    return {"result": {"search_response": "\n\n".join(formatted)}}


def tool_coworker_text2im(args: dict, workspace_dir: str) -> dict:
    prompt = args.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        return {"error": "prompt is required"}

    api_key = os.environ.get("IMAGEN_API_KEY", "")
    if not api_key:
        return {"error": "Image generation requires IMAGEN_API_KEY to be configured"}

    return {"result": {
        "status": "stubbed",
        "request": {
            "provider": "imagen",
            "prompt": prompt,
            "width": args.get("width", 1024),
            "height": args.get("height", 1024),
            "style": args.get("style"),
        },
        "message": "Image API call is intentionally stubbed and not executed",
    }}


def tool_create_custom_api_integration(args: dict, workspace_dir: str) -> dict:
    try:
        name = _require_str(args, "name")
        base_url = _require_str(args, "base_url")
        description = _require_str(args, "description")
    except ValueError as e:
        return {"error": str(e)}

    import re
    if not re.match(r"^[a-z0-9-]+$", name):
        return {"error": "Invalid name: must contain only lowercase letters, numbers, and hyphens"}

    try:
        urllib.parse.urlparse(base_url)
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("Not a URL")
    except Exception:
        return {"error": "Invalid base_url: must be a valid URL"}

    auth_type = args.get("auth_type", "bearer")
    if auth_type not in ("bearer", "api_key", "basic", "none"):
        return {"error": "Invalid auth_type: must be one of bearer, api_key, basic, none"}

    auth_header = args.get("auth_header", "Authorization")

    integrations_dir = resolve_safe_path(workspace_dir, ".integrations")
    os.makedirs(integrations_dir, exist_ok=True)

    config_path = os.path.join(".integrations", f"{name}.json")
    abs_config = resolve_safe_path(workspace_dir, config_path)

    import datetime
    config = {
        "name": name,
        "base_url": base_url,
        "description": description,
        "auth_type": auth_type,
        "auth_header": auth_header,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    with open(abs_config, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    return {"result": {"integration_id": name, "config_path": config_path}}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

TOOL_DISPATCH = {
    # Core (7)
    "bash": lambda args, wd, tms: tool_bash(args, wd, tms),
    "file_read": lambda args, wd, _: tool_file_read(args, wd),
    "file_write": lambda args, wd, _: tool_file_write(args, wd),
    "file_edit": lambda args, wd, _: tool_file_edit(args, wd),
    "glob": lambda args, wd, _: tool_glob(args, wd),
    "grep": lambda args, wd, _: tool_grep(args, wd),
    "view_image": lambda args, wd, _: tool_view_image(args, wd),
    # Slack Comms (9)
    "coworker_slack_history": lambda args, wd, _: tool_coworker_slack_history(args, wd),
    "coworker_send_slack_message": lambda args, wd, _: tool_coworker_send_slack_message(args, wd),
    "coworker_slack_react": lambda args, wd, _: tool_coworker_slack_react(args, wd),
    "coworker_delete_slack_message": lambda args, wd, _: tool_coworker_delete_slack_message(args, wd),
    "coworker_upload_to_slack": lambda args, wd, _: tool_coworker_upload_to_slack(args, wd),
    "coworker_download_from_slack": lambda args, wd, _: tool_coworker_download_from_slack(args, wd),
    "create_thread": lambda args, wd, _: tool_create_thread(args, wd),
    "send_message_to_thread": lambda args, wd, _: tool_send_message_to_thread(args, wd),
    "wait_for_paths": lambda args, wd, _: tool_wait_for_paths(args, wd),
    # Slack Admin (8)
    "coworker_list_slack_channels": lambda args, wd, _: tool_coworker_list_slack_channels(args, wd),
    "coworker_join_slack_channels": lambda args, wd, _: tool_coworker_join_slack_channels(args, wd),
    "coworker_open_slack_conversation": lambda args, wd, _: tool_coworker_open_slack_conversation(args, wd),
    "coworker_leave_slack_channels": lambda args, wd, _: tool_coworker_leave_slack_channels(args, wd),
    "coworker_list_slack_users": lambda args, wd, _: tool_coworker_list_slack_users(args, wd),
    "coworker_invite_slack_user_to_team": lambda args, wd, _: tool_coworker_invite_slack_user_to_team(args, wd),
    "coworker_get_slack_reactions": lambda args, wd, _: tool_coworker_get_slack_reactions(args, wd),
    "coworker_report_issue": lambda args, wd, _: tool_coworker_report_issue(args, wd),
    # Git (2)
    "coworker_git": lambda args, wd, _: tool_coworker_git(args, wd),
    "coworker_github_cli": lambda args, wd, _: tool_coworker_github_cli(args, wd),
    # Browser (3)
    "browser_create_session": lambda args, wd, _: tool_browser_create_session(args, wd),
    "browser_download_files": lambda args, wd, _: tool_browser_download_files(args, wd),
    "browser_close_session": lambda args, wd, _: tool_browser_close_session(args, wd),
    # Docs (2)
    "resolve_library_id": lambda args, wd, _: tool_resolve_library_id(args, wd),
    "query_library_docs": lambda args, wd, _: tool_query_library_docs(args, wd),
    # Utility (5)
    "file_to_markdown": lambda args, wd, _: tool_file_to_markdown(args, wd),
    "workspace_tree": lambda args, wd, _: tool_workspace_tree(args, wd),
    "ai_structured_output": lambda args, wd, _: tool_ai_structured_output(args, wd),
    "quick_ai_search": lambda args, wd, _: tool_quick_ai_search(args, wd),
    "coworker_text2im": lambda args, wd, _: tool_coworker_text2im(args, wd),
    "create_custom_api_integration": lambda args, wd, _: tool_create_custom_api_integration(args, wd),
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
