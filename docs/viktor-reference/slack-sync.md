# Slack Sync Pipeline

![architecture-08](diagrams/architecture-08.svg)

---

## Message Format

```
[1772007700.270919] @Mateusz Jacniacki: Pull our PostHog data... [thread:1772007700.270919]
[1772125842.005209] @Viktor: Here's your summary. [origin:coworker]
[1772183424.536519] @Maks Bilski: czyno [deleted:true]
```

**Regex**: `r"^\[([0-9.]+)\] @([^:]+): (.*)$"`

---

## API Reference — Slack Tools

All Slack tools route through the Tool Gateway: `POST {TOOL_GATEWAY_URL}/call`.

**Source:** `sdk/tools/default_tools.py`, `sdk/tools/slack_admin_tools.py`

### `coworker_slack_history`

Backfills Slack channel history to local workspace files. Messages stored at `/work/slack/{channel_name}/channel.log` with threads in `/work/slack/{channel_name}/threads/`. Merges with existing files on re-run. Webhook keeps files up-to-date after initial backfill.

```json
{
  "role": "coworker_slack_history",
  "arguments": {
    "channel_ids": ["C01ABC123", "C02DEF456"],
    "range": "3 months",
    "end_date": "today",
    "latest_ts": null,
    "messages_per_channel": 999,
    "include_threads": true
  }
}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel_ids` | `list[string]` | Yes | — | Channel IDs to backfill |
| `range` | `string` | No | `"3 months"` | Lookback: `"1 week"`, `"30 days"`, `"3 months"`, `"1 year"` |
| `end_date` | `string` | No | `"today"` | End date: `"today"` or `"YYYY-MM-DD"` |
| `latest_ts` | `string` | No | `null` | Precise Slack timestamp for continuation (e.g. `"1700000000.123456"`) |
| `messages_per_channel` | `int` | No | `999` | Max messages per channel |
| `include_threads` | `bool` | No | `true` | Fetch full thread replies |

**Response:**

```json
{
  "result": {
    "channels_stored": 2,
    "total_messages": 847,
    "files_by_channel": {"C01ABC123": 3, "C02DEF456": 2},
    "thread_parents_by_channel": {"C01ABC123": ["1772007700.270919", "1772008393.249069"]},
    "truncated": [],
    "backfill_hint": null,
    "errors": []
  }
}
```

If `messages_per_channel` is hit, `truncated` contains channel info and `backfill_hint` shows how to continue with `latest_ts`.

### `coworker_send_slack_message`

Sends a Slack message using Block Kit. Includes a built-in reflection step — the agent must reflect on message quality before sending.

```json
{
  "role": "coworker_send_slack_message",
  "arguments": {
    "channel_id": "C01ABC123",
    "blocks": [
      {"type": "section", "text": {"type": "mrkdwn", "text": "Hey @peter, here's the *weekly summary*"}},
      {"type": "divider"},
      {"type": "image", "image_url": "https://example.com/chart.png", "alt_text": "Weekly metrics"}
    ],
    "reflection": "Message is helpful and factual. Tone is professional. Content verified.",
    "do_send": true,
    "thread_ts": null,
    "message_type": "regular",
    "permission_request_draft_ids": null,
    "detailed_approval_context": null,
    "replace_message_ts": null
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel_id` | `string` | Yes | Channel or user ID |
| `blocks` | `list[dict]` | Yes | Slack Block Kit blocks (section, header, divider, context, actions, image) |
| `reflection` | `string` | Yes | Agent's self-check: is this helpful, accurate, appropriate? |
| `do_send` | `bool` | Yes | `true` to send, `false` to skip after reflection |
| `thread_ts` | `string` | No | Thread timestamp to reply in |
| `message_type` | `string` | No | `"regular"` or `"permission_request"` (adds Approve/Reject buttons) |
| `permission_request_draft_ids` | `list[string]` | No | Draft IDs for permission_request messages |
| `detailed_approval_context` | `string` | No | Context shown on approval |
| `replace_message_ts` | `string` | No | Update existing message instead of posting new |

**Response:**

```json
{"result": {"success": true, "message_ts": "1772125842.005209", "error": null, "modifications": null}}
```

### `coworker_slack_react`

Add an emoji reaction to a message.

```json
{"role": "coworker_slack_react", "arguments": {"channel_id": "C01ABC123", "message_ts": "1772007700.270919", "emoji": "eyes"}}
```

**Response:** `{"result": {"success": true}}`

### `coworker_delete_slack_message`

Delete a message sent by the bot.

```json
{"role": "coworker_delete_slack_message", "arguments": {"channel_id": "C01ABC123", "message_ts": "1772125842.005209"}}
```

**Response:** `{"result": {"success": true}}`

### `coworker_upload_to_slack`

Upload a local file to Slack's storage and get a permalink for use in messages.

```json
{"role": "coworker_upload_to_slack", "arguments": {"file_path": "/work/temp/report.pdf"}}
```

**Response:** `{"result": {"permalink": "https://files.slack.com/files-pri/T.../report.pdf", "info": null}}`

### `coworker_download_from_slack`

Download a Slack file to local storage.

```json
{"role": "coworker_download_from_slack", "arguments": {"slack_file_url": "https://files.slack.com/...", "filename": "budget.xlsx"}}
```

**Response:** `{"result": {"file_path": "/work/downloads/budget.xlsx"}}`

### `coworker_list_slack_channels`

List all Slack channels with bot access status.

```json
{"role": "coworker_list_slack_channels", "arguments": {}}
```

**Response:**

```json
{
  "result": {
    "info": "Found 12 channels",
    "channels": [
      {"id": "C01ABC123", "name": "general", "is_private": false, "bot_has_access": true},
      {"id": "C02DEF456", "name": "engineering", "is_private": true, "bot_has_access": false}
    ]
  }
}
```

### `coworker_list_slack_users`

List workspace users.

```json
{"role": "coworker_list_slack_users", "arguments": {"include_bots": false}}
```

**Response:**

```json
{
  "result": {
    "users": [
      {"id": "U01ABC", "name": "mateusz", "real_name": "Mateusz Jacniacki", "display_name": "Mateusz", "email": "...", "is_bot": false, "is_admin": true, "has_viktor_account": true}
    ]
  }
}
```

### `coworker_get_slack_reactions`

Get reactions for a specific message.

```json
{"role": "coworker_get_slack_reactions", "arguments": {"channel_id": "C01ABC123", "message_ts": "1772007700.270919"}}
```

**Response:**

```json
{"result": {"found": true, "reactions": [{"name": "thumbsup", "count": 3, "users": ["U01ABC"]}]}}
```

## API Reference — Slack Reader (SDK Utility)

Local utility that reads the workspace Slack mirror files directly — no gateway call needed.

**Source:** `sdk/utils/slack_reader.py`

### `get_new_slack_messages()`

```python
from sdk.utils.slack_reader import get_new_slack_messages

messages = get_new_slack_messages(
    since="2026-03-12T08:00:00",       # ISO datetime or date string
    channel_names=["general", "engineering"],  # None = all channels
    include_threads=True,                # Include thread replies
    max_messages=1000                    # Truncation limit
)
```

Returns a formatted string grouped by channel and thread:

```
## #general (3 new messages)

2026-03-12 09:15 (ts:1710234900.123456) @Mateusz: Can someone review the PR?

### Thread [old]: 2026-03-11 14:00 @Peter: Budget discussion...
  ... (2 older replies not shown)
  [old] 2026-03-11 16:30 (ts:1710148200.789012) @Anna: I'll check
  2026-03-12 08:45 (ts:1710230700.456789) @Mateusz: Updated numbers attached
```

### File Format

```
/work/slack/{channel_name}/{YYYY-MM}.log     — monthly channel messages
/work/slack/{channel_name}/threads/{ts}.log  — thread replies (parent + replies)
```

**Message line regex:** `r"^\[([0-9.]+)\] @([^:]+): (.*)$"`

**Metadata suffixes:** `[thread:{ts}]`, `[deleted:true]`, `[origin:coworker]`

### Environment

| Variable | Purpose |
|----------|---------|
| `SLACK_ROOT` | Path to Slack file mirror (default: `/work/slack`) |

---

*Sources: `sdk/tools/default_tools.py`, `sdk/tools/slack_admin_tools.py`, `sdk/utils/slack_reader.py`, `sdk/utils/heartbeat_logging.py`, agent run transcripts*
