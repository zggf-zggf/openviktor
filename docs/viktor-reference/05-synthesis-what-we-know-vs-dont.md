# Synthesis: What We Know vs. What We Don't

**Generated:** 2026-03-12
**Context:** Comprehensive reverse engineering of Viktor AI Coworker (getviktor.com by Zeta Labs) from two backup archives containing 164 workspace files + 102 SDK/agent_run files.

---

## WHAT WE KNOW (Exhaustively)

### Platform Architecture
- **166 tools across 16 auto-generated Python modules** in sdk/tools/
- **Tool Gateway:** All tools route through `POST {API_URL}/v1/tools/call` with `{"role":"tool_name","arguments":{}}`, Bearer token auth, 600s timeout
- **Three integration types:** Native (`coworker_*`), MCP (`mcp_*` — PostHog/Linear/Notion), Pipedream (`mcp_pd_*` — GSheets/Lemlist)
- **LLM:** Anthropic Claude primary (785/785 reasoning events), also GPT-5.4, Sonnet 4.6, Gemini 3 Flash
- **Sandbox:** Isolated `/work/` workspace per team, Python 3.13+, 42 dependencies, zero LLM client libs
- **SDK auto-generation:** `"""Auto-generated tool module for {name}."""` marker

### Memory & Learning System
- **Stateless agent** — no memory between runs
- **File-based memory** via SKILL.md files with YAML frontmatter
- **Semantic routing** by `description` field in SKILL.md
- **LEARNINGS.md** as append-only knowledge accumulation (grew to 51KB/503 lines in 16 days)
- **Three-phase file operation evolution:** full rewrite → surgical append → paginated reading
- **Self-correction loop:** error feedback → LEARNINGS.md rule → loaded every run → behavior change
- **No pruning mechanism** — file only grows, creating long-term scalability concern

### Thread & Communication System
- **Hierarchical paths:** `/slack/{user}/{ts}`, `/{cron}/threads/{ts}`
- **Tools:** `create_thread`, `send_message_to_thread`, `wait_for_paths`, `thread_lock`
- **Draft/approval pattern:** Mutating ops return draft_id, require Slack button approval
- **Reflection system:** Every `coworker_send_slack_message` has a private `reflection` field + `do_send` gate
- **Permission request pattern:** `message_type: "permission_request"` for write ops, renders Slack action buttons

### Cron System
- **POSIX cron expressions** in task.json
- **Heartbeat:** 4x/day (`1 8,11,14,17 * * *`) — monitoring + weekly digest
- **Workflow Discovery:** 2x/week (`1 9 * * 2,5`) — strategic engagement
- **Channel Introductions:** Self-deleting after 3 runs
- **Model selection per cron:** e.g., `claude-opus-4-6#ReasoningLevel:very_high`
- **Engagement threshold system:** numeric gates (silence counter, unread counter) controlling outreach

### Prompt Engineering
- **System prompt drives identity tension:** "Be VISIBLY helpful" vs. "Don't be annoying" — deliberate conflict requiring LLM judgment
- **Six proactive action categories** in heartbeat task.json with explicit triggers and anti-patterns
- **Onboarding sequence:** 5-step background work before first message, peer framing (no "I am an AI assistant")
- **Channel intro template rules:** tone-matched to channel purpose, 3-run self-deleting lifecycle
- **Error handling rules:** immediate ownership, root cause + fix in same message, no blame on tools/APIs

### Viktor Spaces (Full-Stack App Platform)
- **Stack:** Convex (real-time DB) + React 19 + Vite + Vercel hosting
- **Domain system:** `*.viktor.space` with format `{project}-{hex_id}.viktor.space`
- **6 SDK tools** for app lifecycle: `init_app_project`, `deploy_app`, `list_apps`, `get_app_status`, `query_app_database`, `delete_app_project`
- **Viktor Spaces API:** Dedicated endpoints allowing deployed apps to call Viktor SDK tools at runtime
- **Per-project secrets** and environment separation (dev/prod)

### Blog-Derived Insights
- "Treat context window like RAM"
- One-line skill summaries with lazy loading (~68 lines for 50 integrations)
- Code-based tool calling (Python scripts)
- Three-tier cron cost hierarchy

---

## WHAT WE DON'T KNOW (8 Critical Unknowns)

### 1. The Skill Routing Algorithm
- Is it semantic similarity (embeddings)? Keyword matching? LLM-based routing?
- What happens when multiple skills match? Priority system? Confidence threshold?
- How does the agent decide to load a skill vs. use base prompt?
- **Impact:** Core architectural decision for reimplementation

### 2. The Thread Orchestrator's Internal State Machine
- How does `wait_for_paths` work? Polling? Webhooks? Event bus?
- Timeout/retry logic for failed spawned threads?
- How does heartbeat "monitor spawned threads" — is there a thread registry?
- Hierarchical path state transitions are visible but opaque

### 3. The Sandbox Orchestration Layer
- Container? VM? Firefly microVM?
- How does `/work/` persist between runs?
- Concurrent execution handling (heartbeat + user thread simultaneously)?
- Resource limits (CPU, memory, time)?

### 4. The Tool Gateway Server
- How does gateway route to MCP servers vs. Pipedream vs. native tools?
- Rate limiting? Retry logic? Error handling at gateway level?
- OAuth token refresh for integrations?
- Execution queue or fire-and-forget?

### 5. The "Condition Script" Pattern for Cost Control
- `condition_script_path` mentioned in docs — lightweight Python exit 0/non-zero gate
- Zero examples in backup. Is it actually implemented?
- How does credit tracking work?

### 6. The Slack Sync Pipeline
- Messages as flat files at `$SLACK_ROOT/{channel}/{YYYY-MM}.log`
- Real-time sync or batch? How fresh is data?
- Who writes these files — Viktor platform or external integration?
- Schema of a `.log` entry?

### 7. The Agent Run Lifecycle
- What triggers an agent run from a Slack message?
- How is the system prompt assembled per-run?
- Run scheduler for concurrency?
- Run timeout (we see 600s tool timeout but not run timeout)?

### 8. Engagement Tuning Parameters
- Are engagement thresholds hard-coded per deployment or learned from scratch?
- Should the silence counter threshold (7 days) be a configurable parameter?
- Is the proactive→reactive transition universal or team-specific?
- What's the right starting configuration for the proactive/reactive tension?

---

## THE BOTTOM LINE

We understand **~80% of Viktor's systems** — every prompt rule, tool pipeline, memory mechanism, learning loop, and infrastructure component. What's missing is the **platform internals**: skill routing algorithm, thread orchestration state machine, sandbox isolation details, tool gateway routing logic. These are the hard engineering problems that prompts and logs can't reveal.

**For reimplementation:** The prompt engineering and learning systems are fully documented. The hard part is building the platform infrastructure underneath.

---

## SOURCE FILES INDEX

### Backup Archives
- `viktor-workspace-backup-2026-03-12.tar.gz` — 164 files (skills, company, team, crons, logs, scripts, data)
- `viktor-backup-extra-2026-03-12.tar.gz` — sdk/ (26 files) + agent_runs/ (76 files)
- `viktor-full-backup-2026-03-12.tar.gz` — full backup including Viktor Spaces apps

### Key Files
| File | Content |
|---|---|
| `sdk/internal/client.py` | Core ToolClient singleton, HTTP gateway |
| `sdk/tools/__init__.py` | 15 module lazy imports |
| `sdk/tools/default_tools.py` | 15 core tools (bash, file ops, Slack, threads) |
| `sdk/tools/mcp_posthog.py` | 43 PostHog tools with draft/approval |
| `sdk/tools/pd_google_sheets.py` | 28 Google Sheets tools via Pipedream |
| `sdk/tools/scheduled_crons.py` | Cron creation with model selection |
| `sdk/tools/viktor_spaces_tools.py` | 6 Viktor Spaces app lifecycle tools |
| `sdk/utils/slack_reader.py` | Flat file Slack message reader |
| `crons/heartbeat/task.json` | Full heartbeat system prompt |
| `crons/heartbeat/LEARNINGS.md` | 51KB accumulated knowledge |
| `skills/skill_creation/SKILL.md` | Meta-skill defining SKILL.md format |
| `skills/viktor_spaces_dev/SKILL.md` | 203-line Spaces development guide |
| `team/SKILL.md` | 4 team member profiles |
| `company/SKILL.md` | Company context |
