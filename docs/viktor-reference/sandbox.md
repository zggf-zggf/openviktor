# Sandbox Architecture

Every agent run is an ephemeral **Modal Firecracker microVM** that mounts a persistent workspace volume.

![architecture-02](diagrams/architecture-02.svg)

---

## Environment Variables (injected per run)

| Variable | Purpose | Example |
|----------|---------|---------|
| `TOOL_GATEWAY_URL` | Gateway endpoint | `{API_URL}/v1/tools` |
| `TOOL_TOKEN` | Bearer auth (per workspace) | `tok_...` |
| `THREAD_ID` | Current thread UUID | For OAuth redirect flows |
| `SLACK_ROOT` | Slack file mirror path | `/work/slack` |
| `API_URL` | Viktor API base | `https://api.getviktor.com` |

---

## Persistence Model

| Path | Lifecycle | Owner |
|------|-----------|-------|
| `/work/skills/` | Permanent | Agent-created + SDK-managed |
| `/work/crons/` | Permanent | Agent-created (LEARNINGS.md, scripts/) |
| `/work/logs/` | Permanent | Agent + platform |
| `/work/team/`, `/work/company/` | Permanent | Agent-created |
| `/work/sdk/` | Managed | Platform auto-regenerates on integration changes |
| `/work/slack/` | Platform-maintained | Webhook-synced Slack mirror |
| `/work/agent_runs/` | Read-only | Platform-written transcripts |
| `/work/temp/{UUID}/` | Per-run ephemeral | Bash output spill files |

---

## API Reference — Sandbox Tools

Core filesystem and shell tools available in every agent run. Route through the Tool Gateway.

**Source:** `sdk/tools/default_tools.py`

### `bash`

Execute shell commands in a persistent session.

```json
{
  "role": "bash",
  "arguments": {
    "command": "pip install pandas && python /work/scripts/analyze.py",
    "timeout": 120000,
    "description": "Install pandas and run analysis script"
  }
}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | `string` | Yes | — | Shell command to execute |
| `timeout` | `int` | No | `120000` | Timeout in milliseconds (max 600,000 = 10 min) |
| `description` | `string` | No | — | Human-readable description (5-10 words) |

**Response:**

```json
{"result": {"content": "Successfully installed pandas-2.2.0\nAnalysis complete: 847 rows processed", "exit_code": 0}}
```

### `file_read`

Read file contents (text, images, PDFs, Jupyter notebooks).

```json
{"role": "file_read", "arguments": {"file_path": "/work/crons/heartbeat/LEARNINGS.md", "offset": null, "limit": null}}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | `string` | Yes | Absolute path |
| `offset` | `int` | No | Start line number |
| `limit` | `int` | No | Number of lines (output truncated to ~32KB regardless) |

**Response:** `{"result": {"content": "1\t# Heartbeat Learnings\n2\t..."}}`

### `file_write`

Write/overwrite a file.

```json
{"role": "file_write", "arguments": {"file_path": "/work/crons/heartbeat/scripts/check.py", "content": "#!/usr/bin/env python3\n..."}}
```

**Response:** `{"result": {"content": "File written successfully", "success": true}}`

### `file_edit`

Exact string replacement in files.

```json
{
  "role": "file_edit",
  "arguments": {
    "file_path": "/work/team/SKILL.md",
    "old_string": "role: engineer",
    "new_string": "role: senior engineer",
    "replace_all": false
  }
}
```

**Response:** `{"result": {"content": "Edit applied successfully", "success": true}}`

### `glob`

Find files by pattern.

```json
{"role": "glob", "arguments": {"pattern": "**/*.py", "path": "/work/crons"}}
```

**Response:** `{"result": {"content": "/work/crons/heartbeat/scripts/check_new_messages.py\n/work/crons/heartbeat/scripts/weekly_summary.py"}}`

### `grep`

Search file contents with regex.

```json
{
  "role": "grep",
  "arguments": {
    "pattern": "LEARNINGS",
    "path": "/work/crons",
    "glob": "*.md",
    "output_mode": "content",
    "context": 2,
    "case_insensitive": true,
    "head_limit": 20
  }
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | `string` | Regex pattern (ripgrep syntax) |
| `path` | `string` | Search directory |
| `glob` | `string` | File filter (e.g. `"*.py"`) |
| `output_mode` | `string` | `"content"`, `"files_with_matches"`, `"count"` |
| `context` | `int` | Lines of context around matches |
| `case_insensitive` | `bool` | Case-insensitive search |
| `head_limit` | `int` | Limit output entries |
| `multiline` | `bool` | Enable cross-line matching |

**Response:** `{"result": {"content": "...matching lines..."}}`

### `view_image`

Display an image for visual analysis by the LLM.

```json
{"role": "view_image", "arguments": {"file_path": "/work/temp/screenshot.png"}}
```

**Response:** `{"result": {"content": "Image displayed successfully"}}`

## API Reference — Workspace Tree Utility

Generates a focused tree view of `/work/` for inclusion in agent prompts.

**Source:** `sdk/utils/workspace_tree.py`

```python
from sdk.utils.workspace_tree import get_focused_tree

tree = get_focused_tree(
    current_thread_path="heartbeat/threads/2026-03-12_08-05-33",
    max_items_per_folder=3,
    root="/work"
)
```

**Filtering rules:**

- Shows all `sdk/tools/` files (important for tool discovery)
- Skips `slack/` and `slack_visible/` (agent uses `$SLACK_ROOT`)
- Skills: folder names only (no internal files)
- Repos: folder exists marker only
- `sdk/internal/`, `sdk/utils/`: summary only
- Hides `.lock` files and `agent_runs/` contents
- Shows only today's `logs/` folder
- Marks current cron folder with `← (your task)`
- Depth 2+: max N items per folder (default 3)

---

*Sources: backup archives (266 files), `sdk/tools/default_tools.py`, `sdk/utils/workspace_tree.py`, agent run transcripts, SDK source, [Viktor blog](https://getviktor.com/blog/what-breaks-when-your-agent-has-100000-tools)*
