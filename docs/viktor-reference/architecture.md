# System Architecture

Reverse-engineered from backup archives (266 files), 76 agent run transcripts, SDK source code, Viktor blog posts, and web research.

---

## High-Level Platform Overview

![architecture-01](diagrams/architecture-01.svg)

### Components

| Component | Page | Summary |
|-----------|------|---------|
| [Sandbox](sandbox.md) | Runtime | Modal Firecracker microVM, persistent `/work/` volume, per-run env vars |
| [Tool Gateway](tool-gateway.md) | Integration layer | Single HTTP endpoint routing 166 tools across 3 integration types |
| [Skill Routing](skill-routing.md) | Discovery | LLM-native routing via one-line descriptions + lazy SKILL.md loading |
| [Cron & Scheduling](cron-scheduling.md) | Automation | POSIX cron, 3-tier cost hierarchy, model selection per cron |
| [Slack Sync](slack-sync.md) | Communication | Real-time webhook sync to flat `.log` files on the shared volume |
| [Memory](memory.md) | Persistence | Stateless agents, file-based memory via LEARNINGS.md and SKILL.md |
| [Credit & Billing](credit-billing.md) | Cost control | 5-layer cost architecture, credit-based pricing, self-monitoring SDK |
| [Thread Orchestrator](thread-orchestrator.md) | Coordination | HTTP-based thread spawning, file-based coordination, 8-phase lifecycle |
| [Viktor Spaces](spaces.md) | App platform | Full-stack app hosting on Convex + React + Vercel |

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Total tools | 166 across 16 Python modules |
| Integration catalog | 3,142 (28 native + 3,114 Pipedream) |
| Tool gateway timeout | 600s (bash: 120s default) |
| Agent run duration | Median 3.7 min (heartbeat), max 353 min (Slack DM) |
| Concurrent runs observed | 16 pairs, max 83.5 min overlap |
| Scheduler precision | Median 11.4s lag (95% CI: 8-19s) |
| LEARNINGS.md growth | 2,968 → 49,192 chars in 16 days (16.6x) |
| Modal volume ID | `vo-TEysOZUOKO7aDnJFbNcvLv` |
| Error rate | 0.26% (27 errors / 10,584 messages) |
| Credit base rate | $0.0025/credit |

---

## API Reference — Additional Tool Groups

Tools documented on their respective pages are cross-referenced above. The following tool groups don't have dedicated pages but are part of the SDK.

### Browser Tools

**Source:** `sdk/tools/browser_tools.py` — Browserbase-powered browser automation sessions.

| Role | Description | Key Parameters |
|------|-------------|---------------|
| `browser_create_session` | Create a Browserbase session, returns CDP connect URL | `starting_url`, `viewport_width` (1024), `viewport_height` (768), `enable_proxies`, `timeout_seconds` (300) |
| `browser_download_files` | Download files from session to sandbox | `session_id`, `target_directory` (`"/work/downloads"`) |
| `browser_close_session` | Release session resources | `session_id` |

```json
// Create session
{"role": "browser_create_session", "arguments": {"starting_url": "https://example.com", "viewport_width": 1024, "viewport_height": 768}}

// Response
{"result": {"session_id": "sess_abc", "connect_url": "wss://connect.browserbase.com/...", "live_view_url": "https://...", "recording_url": "https://..."}}
```

The SDK also provides a high-level `BrowserSession` wrapper (`sdk/utils/browser.py`) with Playwright-based helpers: `click(x, y)`, `type_text(text)`, `press_key(key)`, `scroll(direction)`, `snapshot()` (screenshot + accessibility tree), `goto(url)`, `take_screenshot(path)`. Sessions are cached in `/work/.browsers/` and auto-reconnected across script runs.

### Email Tools

**Source:** `sdk/tools/email_tools.py`

| Role | Description | Key Parameters |
|------|-------------|---------------|
| `coworker_send_email` | Send email (saved to `/work/emails/sent/`) | `to`, `subject`, `body` (markdown), `cc`, `bcc`, `reply_to_email_id`, `attachments` |
| `coworker_get_attachment` | Download email attachment via internal URL | `internal_url`, `filename`, `save_path` |

```json
// Send email
{"role": "coworker_send_email", "arguments": {
  "to": ["user@example.com"],
  "subject": "Weekly Report",
  "body": "# Summary\n\nHere are this week's highlights...",
  "attachments": ["/work/temp/report.pdf"]
}}

// Response
{"result": {"success": true, "email_id": "email_abc123"}}
```

### GitHub Tools

**Source:** `sdk/tools/github_tools.py` — Git and GitHub CLI with automatic authentication.

| Role | Description | Key Parameters |
|------|-------------|---------------|
| `coworker_git` | Run any git command | `args` (list), `working_dir` |
| `coworker_github_cli` | Run any `gh` CLI command | `args` (list), `working_dir` |

```json
// Clone and push
{"role": "coworker_git", "arguments": {"args": ["clone", "https://github.com/owner/repo", "/work/repos/myrepo"]}}
{"role": "coworker_git", "arguments": {"args": ["push", "origin", "main"], "working_dir": "/work/repos/myrepo"}}

// Create PR via gh CLI
{"role": "coworker_github_cli", "arguments": {"args": ["pr", "create", "--title", "Fix bug", "--body", "Description"], "working_dir": "/work/repos/myrepo"}}

// Response (both tools)
{"result": {"success": true, "stdout": "...", "stderr": "", "exit_code": 0}}
```

### Pipedream Integration Tools (Google Sheets, Lemlist)

**Source:** `sdk/tools/pd_google_sheets.py`, `sdk/tools/pd_lemlist.py`

These tools use the **Pipedream proxy** pattern: each has a `configure` tool for discovering options (sheet IDs, campaign IDs), typed action tools, and raw `proxy_get`/`proxy_post`/`proxy_put`/`proxy_patch`/`proxy_delete` for anything the built-in actions don't cover.

| Module | Role Pattern | Example |
|--------|-------------|---------|
| Google Sheets | `mcp_pd_google_sheets_*` | `add_single_row`, `update_row`, `get_values_in_range`, `clear_cell`, `clear_row`, `create_spreadsheet`, `create_worksheet` |
| Lemlist | `mcp_pd_lemlist_*` | `add_lead_to_campaign`, `update_lead_in_a_campaign`, `mark_lead_from_one_campaigns_as_interested`, `proxy_get`, `proxy_post` |

```json
// Configure: discover available spreadsheets
{"role": "mcp_pd_google_sheets_configure", "arguments": {"action": "google_sheets-add-single-row", "prop_name": "sheetId"}}

// Add a row
{"role": "mcp_pd_google_sheets_add_single_row", "arguments": {
  "info": "Adding lead data",
  "sheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  "worksheetId": 0,
  "hasHeaders": true,
  "myColumnData": ["John Doe", "john@example.com", "Acme Corp"]
}}
```

### MCP Integration Tools (PostHog, Linear, Notion)

**Source:** `sdk/tools/mcp_posthog.py`, `sdk/tools/mcp_linear.py`, `sdk/tools/mcp_notion.py`

These are full MCP server proxies routed through the Tool Gateway. Each has 12-40+ tools. Key tools per integration:

| Integration | Key Tools | Draft Required? |
|-------------|-----------|----------------|
| **PostHog** | `query-run`, `insights-get-all`, `insight-create-from-query`, `experiment-create`, `feature-flag-get-definition`, `event-definitions-list`, `logs-query` | Yes (mutations) |
| **Linear** | `list_issues`, `save_issue`, `list_projects`, `save_project`, `create_document`, `list_teams` | Yes (mutations) |
| **Notion** | `search`, `fetch`, `create-pages`, `update-page`, `create-database`, `get-comments` | Yes (mutations) |

All MCP mutation tools follow the draft/approval pattern — they return a `draft_id` that must be approved by the user before execution.

---

*Sources: backup archives (266 files), 76 JSONL transcripts (10,584 messages, 2,530 tool calls), SDK source, [Viktor blog](https://getviktor.com/blog/what-breaks-when-your-agent-has-100000-tools), [Product Hunt](https://www.producthunt.com/products/viktor)*
