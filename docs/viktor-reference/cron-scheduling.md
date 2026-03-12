# Cron & Scheduling System

![architecture-07](diagrams/architecture-07.svg)

---

## Cost Tiers

| Tier | Type | Cost | Use Case |
|------|------|------|----------|
| Level 1 | Script cron (pure Python) | ~Free | Data pipelines, API syncs |
| Level 2 | Conditional cron (check + agent) | 80-90% cheaper | "Run only if new Slack messages" |
| Level 3 | Full agent cron | Expensive | Complex reasoning every cycle |

---

## Model Selection

| Model | When to Use |
|-------|-------------|
| `claude-opus-4-6#ReasoningLevel:very_high` | Default. Complex reasoning, multi-step analysis |
| `gpt-5.4` | Strongest OpenAI for complex professional work |
| `claude-sonnet-4-6` | Routine work, data lookups, first drafts |
| `gemini-3-flash-preview` | Simple, high-volume, speed over quality |

---

## API Reference

All cron tools route through the Tool Gateway: `POST {TOOL_GATEWAY_URL}/call`.

**Source:** `sdk/tools/scheduled_crons.py`

### `create_agent_cron`

Creates a scheduled cron job that spawns an LLM agent on each run.

```json
{
  "role": "create_agent_cron",
  "arguments": {
    "path": "/reports/weekly",
    "description": "Generate weekly team summary from Slack activity",
    "cron": "0 9 * * 1",
    "title": "Weekly Team Summary",
    "model": "claude-sonnet-4-6",
    "dependent_paths": ["/data-sync/threads/latest"],
    "condition_script_path": "/work/crons/reports/scripts/should_run.py",
    "slack_sender_name": "Viktor Reports",
    "trigger_now": false
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Cron path (e.g. `"/reports/weekly"`) |
| `description` | `string` | Yes | Task prompt/instructions executed on each run |
| `cron` | `string` | Yes | POSIX cron expression |
| `title` | `string` | No | Short display title |
| `model` | `string` | No | Model override (e.g. `"claude-opus-4-6#ReasoningLevel:very_high"`, `"gpt-5.4"`, `"claude-sonnet-4-6"`, `"gemini-3-flash-preview"`) |
| `dependent_paths` | `list[string]` | No | Paths to wait for before each run |
| `condition_script_path` | `string` | No | Python script gate — exit 0 = run, non-zero = skip |
| `slack_sender_name` | `string` | No | Custom Slack display name for this cron's messages |
| `trigger_now` | `bool` | No | Immediately trigger after creation |

**Response:** `dict` (tool execution result)

### `create_script_cron`

Creates a scheduled cron job that runs a Python script directly (no LLM agent — nearly free).

```json
{
  "role": "create_script_cron",
  "arguments": {
    "path": "/cleanup/logs",
    "script_path": "/work/scripts/cleanup_logs.py",
    "cron": "0 0 * * *",
    "title": "Daily Log Cleanup",
    "dependent_paths": null,
    "condition_script_path": null,
    "trigger_now": false
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Cron path |
| `script_path` | `string` | Yes | Absolute path to Python script in sandbox (e.g. `"/work/scripts/cleanup_logs.py"`) |
| `cron` | `string` | Yes | POSIX cron expression |
| `title` | `string` | No | Short display title |
| `dependent_paths` | `list[string]` | No | Paths to wait for before each run |
| `condition_script_path` | `string` | No | Python script gate |
| `trigger_now` | `bool` | No | Immediately trigger after creation |

**Response:** `dict` (tool execution result)

### `delete_cron`

Permanently deletes a scheduled cron job. Requires either `path` or `cron_id`.

```json
{"role": "delete_cron", "arguments": {"path": "/neonrain/pr-updates"}}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | One of | Path of the cron job to delete |
| `cron_id` | `string` | One of | ID of the cron job to delete |

**Response:**

```json
{"result": {"status": "deleted", "deleted": true}}
```

### `trigger_cron`

Manually triggers a cron job immediately, optionally with extra context injected into the prompt.

```json
{
  "role": "trigger_cron",
  "arguments": {
    "path": "/heartbeat",
    "extra_prompt": "Focus specifically on messages from @Mateusz today"
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Path of the cron to trigger |
| `extra_prompt` | `string` | No | Additional context appended to the task prompt |

**Response:**

```json
{"result": {"status": "triggered", "thread_id": "abc123", "thread_path": "/heartbeat/threads/2026-03-12_14-05-24"}}
```

### Cron Info Model (from `get_path_info`)

When querying a cron path via `get_path_info`, the response includes:

```json
{
  "info": {
    "path_type": "cron",
    "cron": {
      "id": "cron_abc123",
      "path": "/heartbeat",
      "title": "Heartbeat Check",
      "description": "Check Slack channels for new messages...",
      "slack_sender_name": null,
      "script_path": null,
      "condition_script_path": "/work/crons/heartbeat/scripts/check_new_messages.py",
      "execution_type": "agent",
      "model": "claude-sonnet-4-6",
      "cron": "0 8,11,14,17 * * 1-5",
      "dependent_paths": null,
      "deleted": false,
      "created_at": "2026-02-25T08:00:00Z",
      "updated_at": "2026-03-10T14:05:24Z",
      "threads": [{"id": "...", "title": "...", "status": "completed", ...}],
      "depth": 0
    }
  }
}
```

---

*Sources: `sdk/tools/scheduled_crons.py`, `sdk/tools/thread_orchestration_tools.py`, `skills/scheduled_crons/SKILL.md`, [Viktor blog](https://getviktor.com/blog/how-to-optimize-viktor-credits)*
