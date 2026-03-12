# Thread Orchestrator Architecture

Deep dive into Viktor's thread system — how agent runs are triggered, how threads coordinate, and the complete lifecycle state machine.

---

## Overview

Viktor's thread orchestrator is simpler than expected: **HTTP-based spawning with file-based coordination, not an event bus.** Each thread is an independent Modal container that shares a persistent `/work/` volume with all other threads in the workspace.

![thread-orchestrator-01](diagrams/thread-orchestrator-01.svg)

---

## Five Trigger Mechanisms

![thread-orchestrator-02](diagrams/thread-orchestrator-02.svg)

### Trigger Details

| # | Trigger | Log Signature | Path Pattern | Creates New Thread? |
|---|---------|--------------|--------------|-------------------|
| 1 | Cron scheduler | `[task_triggered]` | `/{cron}/threads/{ISO_datetime}` | Yes |
| 2 | Slack DM | `[webhook] dm from` | `/slack/{user}/{slack_ts}` | Yes |
| 3 | Slack reply | `[webhook] dm_reply` | Same as parent thread | No — injects message |
| 4 | System event | (no log entry) | `/onboarding`, `/integration_exploration/{name}` | Yes |
| 5 | Agent spawn | `[thread_created]` | Custom path from `create_thread()` | Yes |

**Scheduler precision**: Median 11.4s from cron tick to first JSONL message (95% CI: 8-19s, n=47 matched heartbeat runs).

---

## Thread API Surface

Four tools form the complete thread coordination API:

![thread-orchestrator-03](diagrams/thread-orchestrator-03.svg)

### `create_thread` — Spawn a Child Agent

```python
from sdk.tools.default_tools import create_thread

result = await create_thread(
    path="/heartbeat/threads/crypto_research",
    title="Continue crypto team research",
    initial_prompt="""Research remaining ~2,600 projects from the crypto database.
    Read /work/crons/heartbeat/LEARNINGS.md for context on what's been done.
    Focus on finding team members with LinkedIn profiles.""",
    dependent_paths=["/heartbeat/threads/2026-02-25_14-05-24"]
)
# Returns: {status: "created", thread_id: "abc123", path: "/heartbeat/..."}
```

The `initial_prompt` becomes the task body for the spawned agent. **It has NO context from the parent** — all necessary information must be included in the prompt.

### `wait_for_paths` — Block Until Dependencies Complete

```python
from sdk.tools.default_tools import wait_for_paths

result = await wait_for_paths(
    paths=["/integration_exploration/linear", "/integration_exploration/posthog"],
    timeout_minutes=30
)
# Returns: {waited_seconds: 142, paths_waited_for: [...], timed_out: False}
```

Implementation: **server-side polling** — the tool gateway holds the HTTP request and checks path status periodically. Returns when all paths complete or timeout is reached.

### `send_message_to_thread` — Inter-Thread Communication

```python
from sdk.tools.default_tools import send_message_to_thread

await send_message_to_thread(
    content="Research complete. Found 21 verified LinkedIn profiles.",
    thread_id="abc123",
    trigger_reply=True  # Wake the target agent
)
```

---

## Thread Path Hierarchy

![thread-orchestrator-04](diagrams/thread-orchestrator-04.svg)

---

## Agent Run Lifecycle — 8-Phase State Machine

![thread-orchestrator-05](diagrams/thread-orchestrator-05.svg)

### Phase Details

| Phase | Message Roles | Description |
|-------|--------------|-------------|
| **1. Trigger** | — | Platform event (cron tick / webhook / spawn) |
| **2. Prompt Injection** | `user` (name=system), `coworker_slack_message` | System prompt with thread info + task description |
| **3. Thread Lock** | `thread_lock` | Per-thread mutex — prevents re-triggering |
| **4. Reasoning** | `reasoning` | Encrypted reasoning blob + readable summary |
| **5. Tool Loop** | `tool_call_preparation`, `tool_call`, `no_more_tool_calls`, `tool_response` | Core execution cycle |
| **6. Draft Gate** | `draft_message`, `button_click`, `approval_response` | Human-in-the-loop for write ops |
| **7. Progress** | `assistant` (intermediate=True) | Visible progress updates |
| **8. Completion** | `assistant` (final) | Summary, LEARNINGS.md updated, thread ends |

### All 15 Message Roles in JSONL Transcripts

![thread-orchestrator-06](diagrams/thread-orchestrator-06.svg)

---

## Prompt Assembly

The platform constructs the initial system message differently for each trigger type:

### Cron Runs

![thread-orchestrator-07](diagrams/thread-orchestrator-07.svg)

**Example** (heartbeat, 5,941 chars):
```
## Your Thread Info
- Path: /heartbeat/threads/2026-02-25_11-05-24
- Triggered by: cron
- Task (from task.json): [FULL task.json description — VERBATIM, ~3,618 chars]

**IMPORTANT**: You are running the scheduled task at crons/heartbeat/.
Focus ONLY on the task described above.

**NOTE**: This is the FIRST TIME this cron is running. [only on run #1]

A fresh agent handles each cron run with no memory of previous runs.
Always start by checking crons/heartbeat/LEARNINGS.md...

**Start by creating crons/heartbeat/todo.md** [template follows]

## Currently Active Threads
- /onboarding
- /integration_exploration/posthog
```

### Slack DM Runs

![thread-orchestrator-08](diagrams/thread-orchestrator-08.svg)

---

## Concurrency Model

**No global serialization.** Multiple threads run simultaneously in separate containers sharing the `/work/` volume.

![thread-orchestrator-09](diagrams/thread-orchestrator-09.svg)

### Observed Concurrency Stats

| Metric | Value |
|--------|-------|
| Concurrent run pairs observed | 16 |
| Max temporal overlap | 83.5 minutes |
| Max simultaneous threads | 5 (onboarding day) |

### Coordination Primitives

| Primitive | Mechanism | Scope |
|-----------|-----------|-------|
| `thread_lock` | Per-thread mutex (message role) | Prevents same thread re-triggering |
| `wait_for_paths()` | HTTP long-poll via gateway | Cross-thread dependency blocking |
| `dependent_paths` | Cron config parameter | Scheduling dependency declaration |
| `list_running_paths()` | Query thread registry | Voluntary coordination |
| Append-only writes | `open(path, "a")` convention | Write conflict avoidance |
| UUID temp dirs | `/work/temp/{UUID}/` | Per-run isolation for bash output |

---

## Run Duration Analysis

![thread-orchestrator-10](diagrams/thread-orchestrator-10.svg)

| Run Type | Count | Median | Max | Max Messages |
|----------|-------|--------|-----|-------------|
| Heartbeat | 59 | 3.7 min | 13.1 min | 214 |
| Channel intros | 3 | 2.8 min | 83.6 min | 202 |
| Flow discovery | 3 | 6.4 min | 8.5 min | 198 |
| Integration explore | 5 | 4.8 min | 7.0 min | 135 |
| Onboarding | 1 | 2.6 min | 2.6 min | 86 |
| **Slack DM** | **5** | **9.1 min** | **353.1 min** | **1,576** |

The 353-minute Slack DM run (crypto research) received 14 user messages injected mid-run. Slack DM threads are **persistent and resumable** — they don't close until user interaction stops.

---

## Time-to-First-Action (TTFA)

How long from thread start until the agent produces its first user-visible output:

| Metric | Heartbeat (n=59) |
|--------|-----------------|
| Median TTFA | 36s |
| Mean TTFA | 112s |
| Max TTFA | 664s |

The variance is caused by reasoning depth and tool call chains before the first natural language response.

---

## Error Handling

The thread system has **no automatic retry**. If a tool call fails, the agent (LLM) decides how to handle it.

### Five Error Formats at the Gateway

| Format | Source | Example |
|--------|--------|---------|
| Gateway HTTP error | Gateway itself | `Gateway error: 500 - ...` |
| MCP validation | MCP server | `MCP error -32602: Invalid arguments...` |
| MCP upstream | MCP server | `Server error '500' for url 'https://mcp.posthog.com/sse'` |
| Pipedream proxy | Pipedream | `{status_code: 504, x-pd-proxy-error: "request never sent"}` |
| Pipedream config | Pipedream | `Failed to get options: 404 for url '.../configure'` |

**Overall error rate**: 0.26% (27 errors / 10,584 messages across 76 runs).

---

## Design Principles

Based on the reverse engineering, Viktor's thread architecture follows these principles:

1. **Stateless agents, stateful filesystem** — Each run is a pure function. Memory lives in files.
2. **Explicit over implicit** — `initial_prompt` must contain ALL context. No hidden state transfer.
3. **Voluntary coordination** — Threads run independently by default. Coordination is opt-in via `wait_for_paths`.
4. **Per-thread isolation** — `thread_lock` prevents re-entry, not cross-thread interference.
5. **Append-only convention** — Write conflicts avoided by design, not by locking.
6. **Human-in-the-loop for writes** — Draft/approval pattern for mutating external operations.

---

## API Reference

All thread tools route through the Tool Gateway: `POST {TOOL_GATEWAY_URL}/call`.

**Source:** `sdk/tools/default_tools.py`, `sdk/tools/thread_orchestration_tools.py`

### `create_thread`

Spawns a new independent agent thread. Starts execution immediately.

```json
{
  "role": "create_thread",
  "arguments": {
    "path": "/heartbeat/threads/crypto_research",
    "title": "Continue crypto team research",
    "initial_prompt": "Research remaining projects from the database...",
    "dependent_paths": ["/heartbeat/threads/2026-02-25_14-05-24"]
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Thread path (e.g. `"/slack/general/budget_question"`) |
| `title` | `string` | Yes | Display title |
| `initial_prompt` | `string` | Yes | Full task description — the spawned agent has NO parent context |
| `dependent_paths` | `list[string]` | No | Paths to wait for before starting |

**Response:**

```json
{"result": {"status": "created", "thread_id": "abc123", "path": "/heartbeat/threads/crypto_research"}}
```

### `send_message_to_thread`

Sends a message to another thread and optionally wakes its agent.

```json
{
  "role": "send_message_to_thread",
  "arguments": {
    "content": "Research complete. Found 21 verified LinkedIn profiles.",
    "thread_id": "abc123",
    "trigger_reply": true
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `string` | Yes | Message content |
| `thread_id` | `string` | One of | Target thread ID |
| `agent_runs_path` | `string` | One of | Alternative: the `agent_runs` path from an `[origin:...]` tag in Slack logs |
| `trigger_reply` | `bool` | No | Whether to wake the target agent (default: `true`) |

**Response:**

```json
{"result": {"status": "sent", "message_id": "msg_xyz"}}
```

### `wait_for_paths`

Blocks until all specified paths finish execution. Server-side long-poll — the gateway holds the HTTP request.

```json
{
  "role": "wait_for_paths",
  "arguments": {
    "paths": ["/integration_exploration/linear", "/integration_exploration/posthog"],
    "timeout_minutes": 30
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `paths` | `list[string]` | Yes | Paths to wait for (cron paths or thread paths) |
| `timeout_minutes` | `int` | No | Max wait time (default: 30) |

**Response:**

```json
{"result": {"waited_seconds": 142, "paths_waited_for": ["/integration_exploration/linear", "/integration_exploration/posthog"], "timed_out": false}}
```

### `list_running_paths`

Returns all currently executing thread paths. Used for voluntary coordination.

```json
{"role": "list_running_paths", "arguments": {}}
```

**Response:**

```json
{"result": {"running_paths": ["/heartbeat/threads/2026-03-12_08-05-33", "/slack/Mateusz Jacniacki/threads/1772008393_249069"]}}
```

### `get_path_info`

Returns detailed information about any path — works for both cron jobs and threads.

```json
{"role": "get_path_info", "arguments": {"path": "/heartbeat"}}
```

**Response (cron):**

```json
{
  "result": {
    "info": {
      "path_type": "cron",
      "cron": {
        "id": "cron_abc",
        "path": "/heartbeat",
        "title": "Heartbeat Check",
        "description": "...",
        "execution_type": "agent",
        "model": "claude-sonnet-4-6",
        "cron": "0 8,11,14,17 * * 1-5",
        "deleted": false,
        "created_at": "2026-02-25T08:00:00Z",
        "updated_at": "2026-03-10T14:05:24Z",
        "threads": [...]
      }
    }
  }
}
```

**Response (thread):**

```json
{
  "result": {
    "info": {
      "path_type": "thread",
      "thread": {
        "id": "thread_xyz",
        "title": "Crypto team research",
        "status": "completed",
        "timestamp": "2026-02-25T14:05:24Z",
        "updated": "2026-02-25T14:22:10Z",
        "path": "/heartbeat/threads/crypto_research",
        "thread_type": "agent"
      }
    }
  }
}
```

**Response (not found):**

```json
{"result": {"info": {"path_type": "not_found"}, "error": null}}
```

---

*Sources: 76 agent run JSONL transcripts (10,584 messages), `sdk/tools/default_tools.py`, `sdk/tools/thread_orchestration_tools.py`, `sdk/tools/scheduled_crons.py`, cron task.json files, daily global.log files*
