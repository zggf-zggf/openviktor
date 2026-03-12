# Prompt & Communication Systems

**Generated:** 2026-03-12
**Sources:** 5 DM thread transcripts, 3 channel intro runs, 15 heartbeat runs, onboarding run, SDK source (`coworker_send_slack_message`)

---

## A) THE REFLECTION SYSTEM

Every outbound Slack message passes through a private pre-send self-review before delivery. This is implemented as a `reflection` field on the `coworker_send_slack_message` tool call.

### How It Works

```
Agent drafts message
    │
    ├─ reflection: "Mateusz is direct and hates fluff. Keep it short."
    ├─ do_send: true/false
    │
    └─ Final message sent (or suppressed)
```

The `reflection` field is a free-text string (~44 words mean) where the LLM evaluates its own draft against learned user preferences before sending. `do_send` acts as a gate — though in all 24 observed messages it was `true`, meaning reflection calibrates tone rather than censoring.

### What the Reflection Evaluates

| Dimension | Frequency |
|---|---|
| Audience awareness (who is this for?) | 100% |
| Length justification (is this too long?) | 46% |
| Honesty/transparency framing | 33% |
| Tone calibration | 29% |

### Implementation Detail

The reflection happens at the LLM level — the system prompt instructs Viktor to reflect before sending. The `coworker_send_slack_message` SDK function accepts these fields:

```python
async def coworker_send_slack_message(
    channel_id: str,
    text: str,
    reflection: str,          # Private pre-send self-review
    do_send: bool,            # Gate: actually send?
    message_type: str = "regular",  # or "permission_request"
    thread_ts: str = None,
    ...
)
```

---

## B) THE PERSONALIZATION PIPELINE

Viktor reads user context files **before every reply** — even for trivial responses.

### File Loading Sequence

```
1. skills/users/{user_id}/SKILL.md    → Per-user memory (provisioned but remained empty)
2. team/SKILL.md                       → Team member profiles with roles, styles
3. company/SKILL.md                    → Company context, product, integrations
4. crons/heartbeat/LEARNINGS.md        → Accumulated behavioral rules and preferences
```

### Per-User SKILL.md Template

```yaml
---
name: user_mateusz
description: >
  Personal preferences and context for Mateusz Jacniacki.
---
# Empty — all per-user knowledge accumulated in LEARNINGS.md instead
```

In practice, Viktor never populated the per-user SKILL.md files. All user-specific knowledge (communication preferences, working hours, frustration triggers) accumulated in the heartbeat's `LEARNINGS.md` as unstructured text.

### team/SKILL.md Structure

Contains per-member profiles with fields: role, communication style, working patterns, DM channel ID, GitHub username. Updated by both heartbeat and workflow discovery crons.

---

## C) THE ONBOARDING SYSTEM

Fires automatically on first installation. All background work completes **before** the first user-facing message.

### Execution Sequence

```
1. Web research: company name, product, industry
2. SDK integration inventory: list all connected tools
3. Slack user enumeration: coworker_list_slack_users()
4. DM channel ID discovery: per-user channel lookups
5. Knowledge base creation:
   ├─ company/SKILL.md  (company context)
   └─ team/SKILL.md     (team member profiles)
6. First message sent to installer's DM
```

### First Message Design Rules (from system prompt)

- Reference their actual connected tools by name (proves value immediately)
- Include copy-pasteable example prompts scoped to their domain
- End with trust-building statement, not a CTA
- No "I am Viktor, an AI assistant" self-introduction — peer framing

### Channel Introduction Lifecycle

A separate self-deleting cron introduces Viktor to each Slack channel:

| Run | Channel | Action |
|-----|---------|--------|
| #1 | Primary channel | Professional + integrations list |
| #2 | Secondary channel | Tone-matched to channel purpose |
| #3 | Tertiary channel | Post intro → **self-delete cron** |

Template rules from the system prompt:
1. Lead with connected integrations (immediate practical value)
2. List 4-5 concrete capabilities (not vague platitudes)
3. End with a "try this now" example using their actual tools
4. Tailor tone and examples to the channel's purpose

---

## D) THE PERMISSION REQUEST SYSTEM

Mutating operations on user data use a distinct `message_type` that renders Slack action buttons.

### Two Message Types

| Type | Usage | Behavior |
|---|---|---|
| `message_type: "regular"` | 73% of messages | Standard Slack message |
| `message_type: "permission_request"` | 27% of messages | Renders [Approve] / [Reject] buttons |

### When Permission Is Required

Permission requests are triggered for write operations on external systems:
- Writing to Google Sheets
- Creating/modifying Linear issues on behalf of user
- Any operation with side effects the user didn't explicitly request

Read operations (PostHog queries, Linear lookups, web research) execute autonomously.

### Integration with Draft/Approval Flow

For external tool calls, this combines with the Tool Gateway's draft system:

```
Agent calls mutating tool
  → Gateway returns draft_id
  → Agent sends permission_request to Slack
  → User clicks [Approve]
  → Agent submits draft with approval_code
  → Gateway executes
```

---

## E) THREAD MANAGEMENT RULES

From the system prompt — these are hard-coded behavioral instructions, not learned patterns.

### Routing Rules

| Scenario | Action |
|---|---|
| Proactive outreach | New top-level message in appropriate channel/DM |
| Reactive response | Reply in originating thread |
| Multi-turn conversation | Stay in same thread |
| Cross-referencing another thread | `send_message_to_thread` with forwarded context |
| Deep work needed | `create_thread` — never do deep work inline |

### Thread Spawning

The `create_thread` tool spawns a new agent run with its own context. The system prompt explicitly instructs: "When something needs real work (reports, analysis, research), spawn a dedicated thread. Be detailed in the prompt — include all context, relevant files to read, and why it matters now."

In 59 observed heartbeat runs, `create_thread` was called exactly once (HB#2), suggesting the threshold for spawning is high.

---

## F) ERROR HANDLING PROMPT RULES

The system prompt establishes a specific error admission pattern. From `task.json`:

> "If data quality is bad, he WILL catch it. Never fabricate URLs or data — leave blank instead."

### Prompt-Driven Rules

1. **Immediate ownership** — no blame on tools, APIs, or users
2. **Root cause in same message** — explain what went wrong technically
3. **Fix in same breath** — offer corrected output or retry plan
4. **No defensive language** — the system prompt explicitly discourages hedging

### Learned Error Rules (accumulated in LEARNINGS.md)

These emerged from specific incidents and were written back as permanent rules:

| Rule | Origin |
|---|---|
| Never fabricate URLs — blank instead | User caught constructed LinkedIn URLs |
| Browser-verify links before writing to sheets | Same incident, additional safeguard |
| Don't switch web search → AI extraction when rate-limited | User called the approach "stupid" |
| Test search pipeline on known entities first | Pipeline bug returned 0 results from 2700+ entries |
| Always query Linear fresh — never assume no changes | 5 heartbeats missed a 20-issue sprint |

These rules persist in `LEARNINGS.md` and are loaded at the start of every agent run, creating a durable self-correction mechanism.
