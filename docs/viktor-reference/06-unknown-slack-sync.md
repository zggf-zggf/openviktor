# Viktor Slack Sync Pipeline - Deep Research Report

**Date**: 2026-03-12
**Source**: Reverse-engineering from workspace backup at `/home/mjacniacki/Downloads/viktor-analysis/`

---

## Executive Summary

Viktor's Slack integration uses a **dual-layer sync architecture**: a server-side platform layer that converts Slack API events into flat `.log` files on the agent's persistent filesystem (`/work/slack/`), and an agent-side SDK layer (`slack_reader.py`) that parses those files for the LLM to consume. Messages flow in real-time via webhooks for new activity, with a `coworker_slack_history` tool available for batch backfill of historical data. The agent never calls the Slack API directly for reading messages -- it reads local files instead.

---

## 1. The Slack File Format (.log Schema)

**Confidence: VERY HIGH** -- directly observed in `slack_reader.py` regex and in actual `.log` file content from agent run tool responses.

### Line Format

Each line in a `.log` file follows this pattern:

```
[UNIX_TIMESTAMP.MICROSECONDS] @USERNAME: MESSAGE_TEXT [METADATA]
```

The regex used to parse it (from `slack_reader.py` line 27):

```python
MESSAGE_PATTERN = re.compile(r"^\[([0-9.]+)\] @([^:]+): (.*)$")
```

### Concrete Examples (from actual agent tool responses reading `/work/slack/` files)

**Channel message (alerts):**
```
[1772359763.907159] @bot:B0AEXBW97R9: @Mateusz Jacniacki paused the neonagent monitor group with 3 monitors. [thread:1772359763.907159]
```

**DM message:**
```
[1772008393.249069] @Mateusz Jacniacki: do you have access to google sheets? [thread:1772008393.249069]
```

**Viktor's own message with origin tag:**
```
[1772007649.612009] @Viktor: How to use Viktor Three ways to work with me: ... [thread:1772007649.612009, origin:/agent_runs/misc/onboarding/2026-02-25T08-19-13]
```

**Multi-line messages** use `\n` literal escape sequences within the single log line:
```
[1772183424.536519] @Viktor: Hey Mateusz ... *1. Daily metric watchdog* ...\n\n... [thread:1772183424.536519, origin:/agent_runs/crons/flow_discovery/2026-02-27T09-05-30]
```

### Metadata Tags

The trailing `[...]` bracket contains comma-separated metadata:

| Tag | Meaning | Example |
|-----|---------|---------|
| `thread:TIMESTAMP` | This message is a thread parent with the given thread_ts | `[thread:1772007649.612009]` |
| `origin:/path` | This message was sent by an agent thread at the given path | `[origin:/agent_runs/crons/heartbeat/2026-02-25T14-10-02]` |
| `deleted:...` | Message was deleted (parser returns `None`, skipping it) | `[deleted:true]` |

The parser handles these in `_parse_message_line()` (lines 87-125 of `slack_reader.py`):
- `thread:` prefix marks the message as a thread parent and extracts the thread_ts
- `deleted:` prefix causes the message to be silently skipped (returns `None`)
- `origin:` is preserved in the text but not specially parsed by `slack_reader.py`

### Separator Lines

Lines starting with `---` are treated as separators and skipped by the parser.

### Bot Messages

Bot messages use the format `@bot:BOT_ID` for the username:
```
[1772060453.223109] @bot:B0AEXBW97R9: Your team: @Mateusz Jacniacki is now on-call.
```

---

## 2. Directory Structure

**Confidence: VERY HIGH** -- observed via `ls` commands in agent runs and confirmed by `slack_reader.py` logic.

### Layout of `/work/slack/` (the `$SLACK_ROOT`)

```
/work/slack/
  Mateusz Jacniacki/          # DM with person (directory name = display name)
    2026-02.log                # Monthly log: YYYY-MM.log
    threads/
      1772007649.612009.log    # Thread file: {thread_ts}.log
      1772007700.270919.log
      1772008393.249069.log
      1772008508.722309.log
  Maks Bilski/
    2026-02.log
    threads/
      1772183436.898099.log
  Ignacio Borrell/
    2026-02.log
    threads/
      1772125842.005209.log
  MTK/
    (monthly logs)
  Slackbot/
    (monthly logs)
  alerts/                       # Channel (directory name = channel name)
    2026-02.log
    2026-03.log
    threads/
  all-humalike/
    2026-02.log
    threads/
      1772014010.819519.log
      1772179693.711169.log
  social/
    2026-02.log
    threads/
  new-channel/
    2026-02.log
    threads/
  all_your_sent_slack_messages.log   # Top-level: log of ALL messages Viktor sent
  at_mentioned_by_users.log          # Top-level: log of all @Viktor mentions
```

### Key Observations

1. **Channels and DMs share the same structure** -- the only difference is the directory name (person display name for DMs, channel name for channels).
2. **Monthly log files** are named `YYYY-MM.log` and contain all top-level messages for that month.
3. **Thread files** live in a `threads/` subdirectory and are named `{thread_ts}.log`. The first line is the thread parent; subsequent lines are replies.
4. **Two special top-level files** exist:
   - `all_your_sent_slack_messages.log` -- records every message Viktor sent (used by the agent to check what it has already said)
   - `at_mentioned_by_users.log` -- records every @mention of Viktor by humans, in the format `CHANNEL_ID|USER_ID|MESSAGE_TEXT`

### `at_mentioned_by_users.log` Format

**Confidence: HIGH** -- observed in tool responses.

```
D0AH4490KJ8|U0AFVMCTZK2|do you have access to google sheets?
C0AEKVD4QP9|U0AFVMCTZK2|what have you achieved so far?
```

Format: `CHANNEL_ID|USER_ID|MESSAGE_TEXT` (pipe-delimited, one line per mention).

---

## 3. How Sync Works: Real-Time vs Batch

**Confidence: HIGH** -- inferred from tool docstrings, global.log patterns, and agent behavior.

### Real-Time Layer: Webhooks (Server-Side)

The Viktor platform subscribes to Slack Events API webhooks. When a Slack event occurs (new message, edit, deletion, reaction), the platform:

1. **Updates the `.log` files** on the agent's `/work/slack/` filesystem in real-time (appending new messages to the appropriate monthly log and/or thread file).
2. **Writes to `global.log`** with structured event entries.
3. **Routes to the appropriate agent thread** or creates a new one.

Evidence from `global.log` entries:

```
[2026-03-12 08:57:08] [/slack/Mateusz Jacniacki/1773305826_206079] [webhook] Webhook: dm from DM from Mateusz Jacniacki -> /slack/Mateusz Jacniacki/1773305826_206079 | from Mateusz Jacniacki: hi, are you still there?
[2026-03-12 08:57:08] [/slack/Mateusz Jacniacki/1773305826_206079] [slack_received] Slack message received in #D0AH4490KJ8 from U0AFVMCTZK2: hi, are you still there?
```

The webhook events observed in `global.log` include:
- `[webhook] Webhook: dm` -- new DM (creates a new thread)
- `[webhook] Webhook: dm_reply` -- reply in a DM thread (routes to existing agent thread)
- `[slack_received]` -- message received (logged after webhook processing)
- `[slack_sent]` -- message sent by Viktor (logged after sending)

The `coworker_slack_history` tool docstring explicitly confirms this:
> "Files are automatically kept up-to-date via webhooks for new messages, edits, and deletes."

### Batch Layer: `coworker_slack_history` Tool

For historical backfill (e.g., when Viktor first joins a workspace or needs older history), the `coworker_slack_history` tool fetches from the Slack API and writes to the same `.log` file format:

```python
async def coworker_slack_history(
    channel_ids: list[str],
    range: str = "3 months",
    end_date: str = "today",
    latest_ts: str | None = None,
    messages_per_channel: int = 999,
    include_threads: bool = True
) -> CoworkerSlackHistoryResponse
```

Key properties:
- Stores to `/slack/{channel_name}/channel.log` with threads in `/slack/{channel_name}/threads/`
- **Merges** with existing files (idempotent: "If run while files already exist, merges new messages with existing ones")
- Returns structured response with `channels_stored`, `total_messages`, `thread_parents_by_channel`, `truncated` list, and a `backfill_hint` for pagination
- Supports continuation via `latest_ts` parameter for paginated backfill
- Default fetches 3 months of history, up to 999 messages per channel

**Notably**: No call to `coworker_slack_history` was found in any of the agent_runs in this backup. The onboarding flow uses `coworker_join_slack_channels` (which likely triggers the platform to start webhook listening and possibly an automatic initial backfill), but the explicit batch history tool was not invoked by the agent in the 15 days of captured runs. This suggests the platform may auto-backfill recent history when channels are joined.

### Sync Flow Summary

```
                    REAL-TIME PATH (primary)
Slack Events API -----> Viktor Platform (webhook handler)
                              |
                              |-- Updates /work/slack/{channel}/YYYY-MM.log
                              |-- Updates /work/slack/{channel}/threads/{ts}.log
                              |-- Updates all_your_sent_slack_messages.log (for sent)
                              |-- Updates at_mentioned_by_users.log (for @mentions)
                              |-- Writes to /work/logs/YYYY-MM-DD/global.log
                              |-- Routes to agent thread (creates or wakes)

                    BATCH PATH (on-demand)
Agent calls coworker_slack_history(channel_ids, range)
                              |
                              |-- Viktor Platform calls Slack conversations.history API
                              |-- Converts to .log format
                              |-- Merges into /work/slack/{channel}/YYYY-MM.log
                              |-- Fetches and stores thread replies
```

---

## 4. `slack_reader.py` Implementation Details

**Confidence: VERY HIGH** -- full source code read.

**File**: `/home/mjacniacki/Downloads/viktor-analysis/sdk/utils/slack_reader.py`

### Purpose

A pure-Python SDK module that reads the local `.log` files and returns formatted text suitable for LLM consumption. This is the **read side** of the pipeline -- the agent uses this instead of making Slack API calls to read messages.

### Key Functions

#### `get_new_slack_messages(since, channel_names, include_threads, max_messages)`

The primary function. Called by the heartbeat cron every 3 hours to check what's new.

**Algorithm:**
1. Parse the `since` parameter (ISO datetime string or datetime object).
2. Resolve `$SLACK_ROOT` from environment variable.
3. Iterate all channel directories (or filter to `channel_names` if provided).
4. For each channel:
   a. Find relevant monthly `.log` files using `_get_relevant_month_files()` -- only reads files from `since_month` through current month.
   b. Parse each line with `_parse_message_line()`, keeping messages with `ts_float >= since_ts`.
   c. If `include_threads=True`, scan the `threads/` subdirectory. For each thread file, check if any reply is newer than `since_ts`. If so, include the entire thread context.
5. Format output grouped by channel, with threads showing context.

**Thread Context Display:**
- Always shows the thread parent (marked `[old]` if before cutoff)
- Shows up to `CONTEXT_MESSAGES_BEFORE = 2` old replies before the first new reply
- If more old replies exist, shows `... (N older replies not shown)`
- New replies shown without `[old]` marker

**Output Format:**
```
## #channel-name (3 new messages)

2026-03-11 14:08 (ts:1773336507.123456) @User: message text

### Thread [old]: 2026-03-10 10:00 @Starter: thread parent text...
  ... (5 older replies not shown)
  [old] 2026-03-11 13:00 (ts:1773332400.000000) @Someone: context reply
  [old] 2026-03-11 13:30 (ts:1773334200.000000) @Another: context reply
  2026-03-11 14:00 (ts:1773336000.000000) @Replier: NEW reply text
```

#### `get_channel_summary(channel_names)`

Returns a summary listing all channels with message counts, thread counts, and date ranges.

### Data Classes

```python
@dataclass
class SlackMessage:
    channel: str
    timestamp: str          # Unix epoch string e.g. "1772007553.554499"
    user: str               # Display name e.g. "Mateusz Jacniacki"
    text: str               # Message text (with \n unescaped)
    is_thread_parent: bool  # Has [thread:...] metadata
    thread_ts: str | None   # Thread timestamp if parent

@dataclass
class ThreadMessages:
    thread_ts: str
    parent: SlackMessage | None
    all_replies: list[SlackMessage]
    new_reply_timestamps: set[str]

@dataclass
class ChannelMessages:
    channel: str
    top_level: list[SlackMessage]
    threads: dict[str, ThreadMessages]
```

### Usage Pattern

The heartbeat cron uses it like this (from `task.json`):
```python
from sdk.utils.slack_reader import get_new_slack_messages
from sdk.utils.heartbeat_logging import get_last_heartbeat_time
since = get_last_heartbeat_time() or "2024-01-01"
print(get_new_slack_messages(since=since))
```

---

## 5. How `heartbeat_logging.py` Formats Entries

**Confidence: VERY HIGH** -- full source code read.

**File**: `/home/mjacniacki/Downloads/viktor-analysis/sdk/utils/heartbeat_logging.py`

### Log Line Format

All log entries follow:
```
[YYYY-MM-DDTHH:MM:SSZ] MESSAGE\n
```

Example:
```
[2026-03-11T14:08:27Z] Heartbeat #56 (Wed afternoon): PostHog 0 errors. HUM-117 completed...
```

### Dual-Write Pattern

The logging system writes to two locations:

1. **Global log**: `/work/logs/YYYY-MM-DD/global.log` (daily rotation by date)
2. **Execution log**: `/work/crons/{cron_name}/execution.log` (per-cron, append-only)

### Key Functions

| Function | Writes To | Purpose |
|----------|-----------|---------|
| `log_action(msg, cron_name)` | Global + Execution | Standard action log |
| `log_heartbeat(msg)` | Global + Heartbeat execution | Convenience for heartbeat cron |
| `log_to_execution(msg, cron_name)` | Execution only | Verbose/detail logging |
| `log_to_global(msg)` | Global only | Cross-cutting actions |
| `get_last_heartbeat_time()` | Reads execution.log | Returns last timestamp for "since" queries |
| `get_execution_log(cron_name, max_lines)` | Reads execution.log | Recent log entries |

### `get_last_heartbeat_time()` Algorithm

Reads `/work/crons/heartbeat/execution.log` backwards, finds the last line matching `[YYYY-MM-DDTHH:MM...]`, and returns that timestamp string. This is the bridge between heartbeat runs -- each run uses the previous run's timestamp as the `since` parameter for `get_new_slack_messages()`.

---

## 6. What `global.log` Looks Like

**Confidence: VERY HIGH** -- full files read from `/home/mjacniacki/Downloads/viktor-analysis/logs/`.

### Structure

Daily files at `/work/logs/YYYY-MM-DD/global.log`. One directory per day, going back to the install date (2026-02-25).

### Entry Types

The global.log contains **two distinct entry formats**:

#### Type 1: Platform Events (written by Viktor platform infrastructure)

```
[YYYY-MM-DD HH:MM:SS] [/PATH] [EVENT_TYPE] DESCRIPTION
```

Examples:
```
[2026-03-12 08:05:26] [/heartbeat] [task_triggered] Scheduled task triggered: /heartbeat -> /heartbeat/threads/2026-03-12_08-05-25
[2026-03-12 08:57:08] [/slack/Mateusz Jacniacki/1773305826_206079] [webhook] Webhook: dm from DM from Mateusz Jacniacki -> /slack/Mateusz Jacniacki/1773305826_206079 | from Mateusz Jacniacki: hi, are you still there?
[2026-03-12 08:57:08] [/slack/Mateusz Jacniacki/1773305826_206079] [slack_received] Slack message received in #D0AH4490KJ8 from U0AFVMCTZK2: hi, are you still there?
[2026-03-12 08:57:40] [/agent_runs/slack/Mateusz Jacniacki/threads/1773305826_206079] [slack_sent] Slack message sent to #D0AH4490KJ8: Hey! ...
```

Event types observed:
- `[task_triggered]` -- cron schedule fired
- `[webhook]` -- Slack webhook received (dm, dm_reply, channel_message)
- `[slack_received]` -- Slack message ingested
- `[slack_sent]` -- Viktor sent a Slack message

#### Type 2: Agent Log Entries (written by `heartbeat_logging.py`)

```
[YYYY-MM-DDTHH:MM:SSZ] FREE_TEXT_MESSAGE
```

Examples:
```
[2026-03-12T08:08:42Z] Heartbeat #58 (Thu morning): PostHog 0 errors. DAU avg 14...
```

Note the difference: platform events use space-separated datetime `YYYY-MM-DD HH:MM:SS` and include `[path]` and `[event_type]` brackets. Agent entries use ISO format `YYYY-MM-DDTHH:MM:SSZ` and are free-text.

---

## 7. The `check_new_messages.py` Script (Agent-Created)

**Confidence: VERY HIGH** -- full source read.

**File**: `/home/mjacniacki/Downloads/viktor-analysis/crons/heartbeat/scripts/check_new_messages.py`

This is a **script written by the Viktor agent itself** during its first heartbeat run. It provides an alternative, simpler message scanner:

- Hardcodes `SLACK_ROOT = "/work/slack"`
- Scans for messages in the last N hours (default: 2)
- Opens the current month's `.log` file for each channel directory
- Parses lines with regex `r'\[(\d+\.\d+)\]'` to extract timestamps
- **Filters out Viktor's own messages** (lines containing `@Viktor:`)
- Prints results grouped by channel

This script is simpler than `slack_reader.py` -- it does not handle threads, metadata tags, or cross-month queries. It was created as a quick utility for heartbeat runs but was largely superseded by the SDK's `get_new_slack_messages()`.

---

## 8. The Write Side: Sending Messages

**Confidence: HIGH** -- from tool definitions in `default_tools.py`.

Viktor sends messages via the `coworker_send_slack_message` tool, which:

1. Accepts Block Kit blocks (not plain text)
2. Requires a `reflection` parameter (the agent must reflect on whether the message is helpful before sending)
3. Has a `do_send` boolean gate (allows the agent to reconsider)
4. Supports thread replies via `thread_ts`
5. Supports permission requests with Approve/Reject buttons
6. Can replace existing messages via `replace_message_ts`
7. Returns `message_ts` on success

The platform then:
- Sends the message via Slack API
- Logs the sent message to `all_your_sent_slack_messages.log`
- Appends the message to the appropriate `.log` file
- Writes a `[slack_sent]` entry to `global.log`

---

## 9. Message Routing Architecture

**Confidence: HIGH** -- inferred from global.log patterns and `send_message_to_thread` tool.

When a Slack message arrives:

1. **New DM or channel message** (not in a thread):
   - Creates a new agent thread at `/slack/{person_name}/{thread_ts}` (or `/slack/{channel_name}/{thread_ts}`)
   - The agent thread handles the conversation

2. **Reply in a Slack thread**:
   - Routes to the existing agent thread at `/agent_runs/slack/{person_name}/threads/{thread_ts}`
   - The `[webhook] Webhook: dm_reply` event includes the routing path

3. **Cross-thread routing**:
   - If a user replies outside the original thread, the agent can use `send_message_to_thread` with an `agent_runs_path` (from the `[origin:...]` tag in Slack logs) to forward the message to the correct agent thread

4. **Heartbeat polling**:
   - The heartbeat cron (runs at `1 8,11,14,17 * * *` -- minute 1 of hours 8, 11, 14, 17) reads `.log` files via `get_new_slack_messages()` to find anything that might need proactive attention

---

## 10. What's NOT in the Backup

**Confidence: HIGH** -- from README.md.

The backup explicitly excludes:
- `slack/` and `slack_visible/` -- described as "ephemeral sync, not custom data"
- `agent_runs/` -- included in the backup we're analyzing, but labeled as "platform-managed"

The label "ephemeral sync" for the slack directory confirms this is platform-managed synced data, not something the agent creates or controls.

The `workspace_tree.py` utility also explicitly skips `slack/` and `slack_visible/` directories when generating the workspace tree for the agent, and notes: "agent uses $SLACK_ROOT instead" -- suggesting the `$SLACK_ROOT` environment variable may point to a different mount or view of the same data.

---

## 11. Open Questions and Unknowns

| Question | Confidence | Notes |
|----------|------------|-------|
| Does `coworker_slack_history` get called automatically on channel join? | LOW | No evidence in agent_runs, but the Slack data exists from day 1. Likely platform auto-backfills. |
| What is `slack_visible/` vs `slack/`? | LOW | Both are skipped in workspace_tree.py. May be different permission views of the same data. |
| How are message edits handled in .log files? | MEDIUM | The `deleted:` metadata tag is handled (message skipped), and the `coworker_slack_history` docstring mentions "edits, and deletes" via webhooks. Likely the line is updated in-place or a new line with the same timestamp replaces the old one. |
| How are files cleaned up / rotated? | LOW | Monthly log rotation is implicit (YYYY-MM.log naming), but no cleanup logic was found. Old months may accumulate indefinitely. |
| Is `$SLACK_ROOT` always `/work/slack`? | HIGH | The `check_new_messages.py` script hardcodes it, but `slack_reader.py` reads from the environment variable. The env var approach allows the platform to change the path. |
| How does the initial channel history get populated? | MEDIUM | The onboarding flow triggers `coworker_join_slack_channels`, and the earliest messages in .log files coincide with Viktor's install time. The platform likely backfills automatically on join. |

---

## 12. Summary: The Complete Slack Sync Pipeline

```
 SLACK WORKSPACE
       |
       v
 Slack Events API (real-time webhooks)
       |
       v
 VIKTOR PLATFORM (server-side, not visible to agent)
       |
       |-- Converts Slack JSON to flat .log format
       |-- Writes to /work/slack/{channel_or_dm}/YYYY-MM.log
       |-- Writes thread replies to /work/slack/{channel}/threads/{ts}.log
       |-- Maintains all_your_sent_slack_messages.log
       |-- Maintains at_mentioned_by_users.log
       |-- Writes platform events to /work/logs/YYYY-MM-DD/global.log
       |-- Routes messages to agent threads (creating new or waking existing)
       |
       v
 AGENT FILESYSTEM (/work/slack/ = $SLACK_ROOT)
       |
       |-- Read by: sdk.utils.slack_reader.get_new_slack_messages()
       |-- Read by: crons/heartbeat/scripts/check_new_messages.py
       |-- Read by: agent bash commands (cat, tail, grep on .log files)
       |
       v
 AGENT LLM CONTEXT
       |-- Heartbeat cron checks every 3 hours
       |-- Webhook-triggered threads get immediate context
       |-- Flow discovery reads conversation history for strategy
```

The design is elegant: by converting Slack's JSON API into simple, grep-able flat files, Viktor makes Slack history accessible to LLM agents using basic file I/O rather than requiring API tool calls. The monthly file partitioning keeps individual files manageable, and the thread file separation prevents main channel logs from being bloated with thread replies. The `[old]` context display in `slack_reader.py` ensures the LLM gets conversation context without being overwhelmed by historical data.

---

## Sources

- [Viktor - Your last hire](https://getviktor.com/)
- [Viktor Product Page](https://getviktor.com/product)
- [What Breaks When Your Agent Has 100,000 Tools - Viktor Blog](https://getviktor.com/blog/what-breaks-when-your-agent-has-100000-tools)
- [Viktor on Product Hunt](https://www.producthunt.com/products/viktor)
- [Viktor Getting Started Docs](https://getviktor.com/docs/getting-started)
