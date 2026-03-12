# Memory Architecture

Viktor is **stateless** — each run is a fresh LLM invocation with no memory. Persistence is achieved entirely through the filesystem.

![architecture-09](diagrams/architecture-09.svg)

> *"Treat your context window like RAM in a memory-constrained system. Page things in only when needed. Keep the hot path small."*
> — Viktor blog

---

## Key Memory Files

| File | Purpose | Size at Day 16 |
|------|---------|----------------|
| `crons/heartbeat/LEARNINGS.md` | Accumulated knowledge, behavioral rules, team profiles | 51KB (503 lines) |
| `team/SKILL.md` | Team member profiles with roles and communication styles | ~2KB |
| `company/SKILL.md` | Company context, product info, integrations | ~3KB |
| `skills/users/{id}/SKILL.md` | Per-user memory templates | Empty (unused) |
| `crons/flow_discovery/LEARNINGS.md` | Workflow discovery process notes | ~5KB |

---

## API Reference — Heartbeat Logging Utility

Local utility for structured logging within agent runs. Writes directly to workspace files — no gateway call needed.

**Source:** `sdk/utils/heartbeat_logging.py`

### `log_action()`

Log to both execution log and global log.

```python
from sdk.utils.heartbeat_logging import log_action

log_action("Spawned thread for weekly report analysis", cron_name="heartbeat")
# Writes to:
#   /work/crons/heartbeat/execution.log  — "[2026-03-12T08:05:33Z] Spawned thread for weekly report analysis"
#   /work/logs/2026-03-12/global.log     — same line
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Log message |
| `cron_name` | `string` | No | Cron name (writes to `crons/{name}/execution.log`) |
| `global_only` | `bool` | No | If `True`, skip execution log even if cron_name given |

### `log_heartbeat()`

Convenience function for heartbeat-specific logging.

```python
from sdk.utils.heartbeat_logging import log_heartbeat

log_heartbeat("Checked 3 channels, spawned 1 thread, no other action")
```

### `get_last_heartbeat_time()`

Returns the timestamp of the most recent heartbeat entry from `execution.log`.

```python
from sdk.utils.heartbeat_logging import get_last_heartbeat_time

last = get_last_heartbeat_time()
# Returns: "2026-03-12T08:05:33Z" or None
```

### `get_execution_log()`

Read recent entries from any cron's execution log.

```python
from sdk.utils.heartbeat_logging import get_execution_log

recent = get_execution_log(cron_name="heartbeat", max_lines=50)
```

### Log File Layout

```
/work/logs/{YYYY-MM-DD}/global.log    — all actions from all crons, one line per event
/work/crons/{name}/execution.log      — per-cron execution history
```

**Line format:** `[{ISO_8601_UTC}] {message}\n`

**Example:**
```
[2026-03-12T08:05:33Z] Heartbeat started. Checking 4 channels.
[2026-03-12T08:05:45Z] Found 7 new messages in #general since last check.
[2026-03-12T08:06:12Z] Spawned thread for crypto team research.
```

---

*Sources: backup archives (266 files), `sdk/utils/heartbeat_logging.py`, `crons/heartbeat/LEARNINGS.md`, [Viktor blog](https://getviktor.com/blog/what-breaks-when-your-agent-has-100000-tools)*
