# Tool Gateway

The gateway is the single choke point — every tool call from every agent routes through one HTTP endpoint.

![architecture-03](diagrams/architecture-03.svg)

---

## Gateway Wire Protocol

```python
# Every tool call — no exceptions:
POST {TOOL_GATEWAY_URL}/call
Authorization: Bearer {TOOL_TOKEN}
Content-Type: application/json

{"role": "tool_name", "arguments": {...kwargs}}

# Response:
{"result": {...}}  # or {"error": "..."}
```

---

## Integration Catalog: 3,142 Total

![architecture-04](diagrams/architecture-04.svg)

---

## Draft/Approval State Machine

Mutating operations on external tools go through a 5-step approval flow:

![architecture-05](diagrams/architecture-05.svg)

---

## API Reference

### Gateway Endpoint

All tool invocations are HTTP POST requests to a single endpoint. There are no other routes.

```
POST {TOOL_GATEWAY_URL}/call
```

**Source:** `sdk/internal/client.py`

#### URL Resolution

The gateway URL is resolved from environment variables in this order:

1. `TOOL_GATEWAY_URL` — used directly if set (normalized to end with `/v1/tools`)
2. `API_URL` + `/v1/tools` — fallback

#### Request

```http
POST {TOOL_GATEWAY_URL}/call HTTP/1.1
Authorization: Bearer {TOOL_TOKEN}
Content-Type: application/json

{
  "role": "<tool_name>",
  "arguments": {
    "<param1>": "<value1>",
    "<param2>": "<value2>"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Tool identifier (e.g. `"bash"`, `"coworker_send_slack_message"`, `"mcp_posthog_query-run"`) |
| `arguments` | `object` | Keyword arguments matching the tool's Python signature |

#### Response — Success

```json
{
  "result": { ... }
}
```

#### Response — Error

```json
{
  "error": "Tool error: <message>"
}
```

Gateway-level errors return HTTP status codes other than 200:

```
Gateway error: {status_code} - {response_body}
```

#### Client Configuration

| Parameter | Value |
|-----------|-------|
| HTTP client | `httpx.AsyncClient` |
| Timeout | **600 seconds** (10 minutes) |
| Auth | `Bearer {TOOL_TOKEN}` |
| Content-Type | `application/json` |

### Complete Tool Catalog (166 tools across 16 modules)

| Module | Tool Count | Role Prefix | Tools |
|--------|-----------|-------------|-------|
| `default_tools` | 12 | *(none)* | `bash`, `file_edit`, `file_read`, `file_write`, `glob`, `grep`, `view_image`, `coworker_slack_history`, `coworker_send_slack_message`, `coworker_slack_react`, `coworker_delete_slack_message`, `coworker_upload_to_slack`, `coworker_download_from_slack`, `create_thread`, `send_message_to_thread`, `wait_for_paths` |
| `thread_orchestration_tools` | 2 | *(none)* | `list_running_paths`, `get_path_info` |
| `scheduled_crons` | 4 | *(none)* | `create_agent_cron`, `create_script_cron`, `delete_cron`, `trigger_cron` |
| `slack_admin_tools` | 8 | `coworker_` | `coworker_list_slack_channels`, `coworker_join_slack_channels`, `coworker_open_slack_conversation`, `coworker_leave_slack_channels`, `coworker_list_slack_users`, `coworker_invite_slack_user_to_team`, `coworker_get_slack_reactions`, `coworker_report_issue` |
| `email_tools` | 2 | `coworker_` | `coworker_send_email`, `coworker_get_attachment` |
| `browser_tools` | 3 | `browser_` | `browser_create_session`, `browser_download_files`, `browser_close_session` |
| `github_tools` | 2 | `coworker_` | `coworker_git`, `coworker_github_cli` |
| `viktor_spaces_tools` | 6 | *(none)* | `init_app_project`, `deploy_app`, `list_apps`, `get_app_status`, `query_app_database`, `delete_app_project` |
| `docs_tools` | 2 | *(none)* | `resolve_library_id`, `query_library_docs` |
| `utils_tools` | 5 | *(varies)* | `file_to_markdown`, `ai_structured_output`, `coworker_text2im`, `create_custom_api_integration`, `quick_ai_search` |
| `mcp_posthog` | 40+ | `mcp_posthog_` | PostHog analytics — insights, dashboards, experiments, feature flags, surveys, actions, logs, queries |
| `mcp_linear` | 25+ | `mcp_linear_` | Linear project management — issues, projects, documents, milestones, comments, labels, teams, users |
| `mcp_notion` | 12+ | `mcp_notion-` | Notion — pages, databases, search, comments, data sources, users, teams |
| `pd_google_sheets` | 10+ | `mcp_pd_google_sheets_` | Google Sheets via Pipedream — rows, columns, worksheets |
| `pd_lemlist` | 15+ | `mcp_pd_lemlist_` | Lemlist outreach via Pipedream — leads, campaigns, unsubscribes, proxy requests |

### Draft/Approval Protocol

Tools that mutate external state return a draft instead of executing immediately:

```json
// Request (same wire format)
{"role": "coworker_join_slack_channels", "arguments": {"channel_ids": ["C01ABC123"]}}

// Response — draft created (not yet executed)
{"result": {"content": "draft_id: dft_abc123..."}}
```

**Draft lifecycle:**

1. Tool returns `draft_id` + human-readable description
2. Agent sends Slack `permission_request` message with Approve/Reject buttons
3. User clicks Approve → `button_click` event with `approval_code`
4. Agent calls `submit_draft(draft_id, approval_code)` → action executes
5. If user clicks Reject → draft is discarded

Tools that create drafts (observed): `coworker_join_slack_channels`, `coworker_leave_slack_channels`, `coworker_report_issue`, and all MCP tools with `NOTE: Creates a draft` in their docstring.

---

*Sources: `sdk/internal/client.py`, `sdk/tools/__init__.py`, 2,530 tool calls across 76 agent run transcripts*
