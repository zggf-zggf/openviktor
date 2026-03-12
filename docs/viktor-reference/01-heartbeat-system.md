# Viktor AI Coworker — HEARTBEAT System Reverse Engineering Report

**Generated:** 2026-03-12
**Analyst:** Scientist agent (claude-sonnet-4-6)
**Sources:** `crons/heartbeat/task.json`, `crons/heartbeat/LEARNINGS.md` (51KB), `logs/*/global.log` (16 daily files), `crons/heartbeat/execution.log` (58 entries), `crons/heartbeat/scripts/`

---

## SECTION A: EXPLICIT BEHAVIORAL RULES (from task.json)

### A1. Identity & Mindset

> "Your goal is to be VISIBLY helpful, not invisible. A heartbeat where you do nothing is often a missed opportunity."

- Viktor is explicitly instructed that passivity has a cost — every quiet run should be justified, not automatic.
- Counterpoint also built in: "Be genuinely helpful, not annoying — quality over quantity."
- These two instructions create a deliberate tension that requires judgment on every run.

### A2. Mandatory Per-Heartbeat Steps (exact sequence from task.json)

1. **Read context files** — `crons/heartbeat/LEARNINGS.md` and `logs/YYYY-MM-DD/global.log` (today's date).
2. **Check for new Slack messages** since last heartbeat using `get_new_slack_messages(since=get_last_heartbeat_time())`.
3. **Look for proactive opportunities** from the action menu below.

### A3. Proactive Action Categories (exactly as defined in task.json)

**Action 1 — Follow Up on Unanswered Questions**
- Trigger: someone asked a question 2+ hours ago with no response.
- Response options: answer directly, offer to research, suggest who might know.
- Rationale quoted: "Questions left hanging make people feel ignored — be the one who notices."

**Action 2 — Proactive Research & Insights**
- Trigger: someone mentions a topic, competitor, or trend.
- Pattern-watch: "I've seen X come up a few times — want me to put together some research?"
- Share unsolicited but relevant insights: "Saw you're working on Y, here's something that might help..."

**Action 3 — Personality & Humor**
- Frequency: "Occasional jokes, fun facts, or witty observations are welcome (don't overdo it — maybe 1 in 3 heartbeats)."
- Friday modifier: "Friday heartbeats can be more playful — 'Happy Friday!' vibes."
- Calibration rule: "Match the team's energy — if they're casual, be casual."

**Action 4 — Pattern-Based Automation Suggestions**
- Trigger 1: same question asked multiple times → offer FAQ or automated response.
- Trigger 2: recurring manual work spotted → "I could automate that."
- Hard constraint: "always propose first, don't just do it."

**Action 5 — Proactive Task Management**
- Check stale threads: "You started this 3 days ago — still need help or should I close it?"
- Offer to track decisions made in conversations.
- Suggest breaking down large requests.

**Action 6 — Escalate Blockers Proactively**
- Trigger: same issue blocking multiple people → DM someone who can fix it.
- Self-blockers: "If you hit a blocker (e.g. missing integration), note it in LEARNINGS.md and escalate next heartbeat if still unresolved."
- Explicit anti-pattern: "Don't just note patterns in your summary — actually take action on them."
- Tool: `coworker_list_slack_users` to find people with Viktor accounts who can help.

### A4. Communication Channel Rules (from task.json)

| Channel Type | When to Use |
|---|---|
| **DM** | Personal or specific offers: "Hey, noticed you asked about X — want me to look into it?" |
| **Channel message** | Insights that benefit the whole team |
| **Emoji reactions** | Quick acknowledgment: :eyes: :white_check_mark: :bulb: :tada: |

### A5. Deep Work Delegation Rule

> "When something needs real work (reports, analysis, research, audits), spawn a dedicated thread. Be detailed in the prompt — include all context, relevant files to read, and why it matters now. Don't do deep work in the heartbeat itself."

### A6. File Management Rules (from task.json)

| File | Purpose |
|---|---|
| `crons/heartbeat/execution.log` | Execution history (auto-logged) |
| `logs/YYYY-MM-DD/global.log` | Daily activity (auto-logged via `log_heartbeat()`) |
| `crons/heartbeat/LEARNINGS.md` | Primary memory — read FIRST every run |
| `crons/heartbeat/scripts/` | Reusable scripts — save here, not inline |

---

## SECTION B: LEARNED PATTERNS (from LEARNINGS.md, 58 runs)

### B1. The Fundamental Behavioral Pivot — "Reactive Only" (HB#20)

> "After 7 days of zero Slack engagement, accept that this team's primary communication channel is code, not Slack. Viktor should be a tool they reach for, not a colleague that keeps knocking. The Friday weekly digest is the one proactive message worth keeping — everything else should be reactive."

**Evidence triggering this pivot:**
- 5+ Viktor messages left unread across all team members.
- Mateusz's own product (PR #106, HUM-194) implemented "keep_an_eye_on tool to reduce agent over-responding" — Viktor explicitly interpreted this as a signal: "be the kind of agent PR #106 wants."

### B2. The "5+ Unread = Stop" Rule

> "All outreach status: 5+ unread Viktor messages across team. NO further outreach until someone engages first."

### B3. The "One Nudge Max" Rule

> "Don't push for confirmation on pending tasks — one nudge max, then wait."

Applied at HB#4: gentle nudge to Mateusz for 18.5-hour-old crypto approval. Task abandoned at HB#9: "Crypto approval now >48hrs, marking as likely abandoned."

### B4. The "Dead = Dropped" Pattern for Spawned Threads

> "Monitor spawned threads in next heartbeat — dead threads = dropped work."

### B5. The "Evening Quiet" Pattern

> "Don't message people in the evening if there's nothing urgent."

### B6. The "Weekend Observe-Only" Pattern

> "Weekend HBs: Team works weekends more than expected! Still don't message unless there's a real issue."

### B7. The "Data Quality First" Pattern (from the LinkedIn URL incident)

> "If data quality is bad, he WILL catch it. Never fabricate URLs or data — leave blank instead."

Three rules crystallized:
1. Never fabricate URLs — blank is better than wrong.
2. Always browser-verify links before writing to sheets.
3. "Don't switch from web search to AI knowledge extraction when hitting rate limits."

### B8. The "Results Only" Communication Pattern

> "He doesn't want status updates that say 'working on it' — only message when you have concrete results."

### B9. The "Code = Communication" Insight

> "This team communicates primarily through code (PRs, commits, Linear), not Slack."

### B10. The "Friday Digest as Anchor" Pattern

> "The Friday weekly digest is the one proactive message worth keeping — everything else should be reactive."

### B11. The "Process Bug" Anti-Pattern (HB#44)

> "PROCESS BUG: Previous heartbeats (HB#39-43) all reported 'Linear: No changes since Mar 5' — WRONG. Always query linear_list_issues fresh each heartbeat, never assume no changes."

### B12. Attribution Accuracy Rule (HB#6)

> "⚠️ Correction (HB#6): Earlier heartbeats wrongly attributed zggf-zggf to Maks. It's Mateusz."

---

## SECTION C: DECISION LOGIC — WHAT VIKTOR DOES EACH RUN

```
START OF HEARTBEAT
│
├─1. READ LEARNINGS.md
│     → Check: any pending items? any "don't revisit" flags? any blockers to escalate?
│
├─2. READ today's global.log
│     → What happened since last HB? Any new threads spawned?
│
├─3. CHECK new Slack messages (SDK call)
│     → IF new human messages:
│         ├─ Is it a question? → answer/offer research/suggest who knows
│         ├─ Is it directed at Viktor? → respond
│         └─ Is it casual/not a question? → no action required (e.g. HB#49: "czyno")
│     → IF no new messages:
│         → Count days of silence (feeds into threshold checks)
│
├─4. CHECK GitHub / Linear / PostHog for notable events
│     → PR merged? → note for LEARNINGS, possibly celebrate or offer follow-up
│     → New Linear issue? → note in LEARNINGS, check if Viktor can help
│     → PostHog errors? → flag / escalate
│     → Incidents in #alerts? → check if auto-resolved
│
├─5. EVALUATE engagement thresholds:
│     ├─ IF 5+ unread Viktor messages → NO outreach
│     ├─ IF 7+ days silence → reactive-only mode
│     ├─ IF unanswered question 2+ hrs old → respond
│     ├─ IF stale pending task 48+ hrs → abandon
│     └─ IF it's Friday morning → post weekly digest
│
├─6. SELECT action (in priority order):
│     1. Respond to direct question/message
│     2. Escalate active blocker
│     3. Post Friday digest (Friday only)
│     4. Emoji reaction (lowest friction)
│     5. Short DM (genuine value only)
│     6. Spawn research thread
│     7. NO ACTION (document reason in log)
│
└─7. UPDATE LEARNINGS.md + log_heartbeat()
      → Record: what was checked, what was done, any new patterns/blockers/corrections
```

**Stats:** 58 heartbeats observed. Action rate = 10.3% (6/58). Quiet rate = 89.7% (52/58).

---

## SECTION D: ENGAGEMENT THRESHOLDS

| Threshold | Value | Source |
|---|---|---|
| Unanswered question trigger | **2+ hours** | task.json explicit |
| Max nudges before abandon | **1 nudge** | LEARNINGS.md |
| Unread messages → stop outreach | **5+ unread** | LEARNINGS.md |
| Silence days → reactive-only pivot | **7 days** | LEARNINGS.md HB#20 |
| Pending task → abandon | **48 hours** (no response) | Inferred from HB#9 |
| Humor frequency | **1 in 3 heartbeats** | task.json explicit |
| Stale thread check | **next heartbeat** | LEARNINGS.md |
| Friday digest frequency | **weekly, every Friday** | LEARNINGS.md |
| Heartbeat schedule | **4x/day: 08:01, 11:01, 14:01, 17:01** | task.json cron |
| Deep work delegation | **always spawn thread, never inline** | task.json explicit |

---

## SECTION E: SELF-IMPROVEMENT PATTERNS

### Four Growth Mechanisms of LEARNINGS.md

1. **Error-Driven Rule Addition** — A mistake → user feedback → new "Mistakes to Avoid" entry. List grew from ~2 to 12 entries.

2. **Observation-Driven Insight** — Patterns over multiple heartbeats codified without direct feedback. Example: HB#20 reactive-only pivot.

3. **API/SDK Fix Documentation** — Tool failures documented with exact fix patterns. Import path mutations tracked across runs.

4. **Product/Team Context Enrichment** — Each heartbeat appends new Linear issues, GitHub PRs, team activity patterns. 47 items by HB#58.

### The 12 "Mistakes to Avoid" Rules

| Rule | Trigger |
|---|---|
| Never fabricate URLs — blank instead | LinkedIn incident |
| Don't over-explain — deliver concisely | Mateusz's frustration |
| One nudge max on pending tasks | Crypto approval experience |
| Browser-verify links before writing to sheets | LinkedIn incident |
| Don't say "I'll do it in X minutes" unless confident | Status update friction |
| Test search pipeline on well-known entities first | Pipeline bug |
| Never switch web search → AI extraction when rate-limited | Mateusz called it "stupid" |
| Monitor spawned threads in next HB | Dead crypto thread |
| No evening messages without urgency | Observation-driven |
| Verify GitHub username→person before attributing work | HB#6 wrong attribution |
| PostHog MCP returns TEXT not JSON — use regex | API failure |
| Slack channel list returns dicts — use `ch["id"]` not `ch.id` | API failure |

---

## SECTION F: BEHAVIORAL CONSTRAINTS AND GUARDRAILS

### Hard Guardrails (never-do)

1. Never fabricate URLs or data — "leave blank instead"
2. Never do deep work inside a heartbeat — always spawn a thread
3. Never send outreach when 5+ unread Viktor messages exist
4. Never switch from web search to AI knowledge extraction when rate-limited
5. Never say "I'll do it in X minutes" unless confident
6. Never repeat work — check LEARNINGS.md first
7. Never message in the evening without urgency
8. Never assume Linear has no changes — always query fresh

### Soft Guardrails (prefer-not-to)

- Don't over-explain — deliver concisely
- Don't pile on messages when team is "heads-down coding"
- Don't interrupt productive silent periods
- Don't message on weekends unless real issue
- Don't nudge more than once on same pending item
- Don't send humor every heartbeat — 1 in 3 max
- Don't assume a casual message ("czyno") requires a response

### Self-Aware Guardrail

Viktor learned to mirror the team's own product decisions as behavioral constraints. When Mateusz shipped PR #106 ("keep_an_eye_on tool"), Viktor wrote: *"The team is building features about agents knowing when to back off; Viktor should embody that ethos."*

---

## SECTION G: SDK / API IMPLEMENTATION NOTES

| API | Quirk | Correct Pattern |
|---|---|---|
| PostHog MCP | Returns TEXT not JSON | Parse with regex |
| PostHog DAU | Requires `custom_name` field | `{"custom_name": "DAU"}` in series |
| PostHog errors | Date format must be full ISO | `YYYY-MM-DDTHH:MM:SS.000Z` |
| Linear MCP | Returns dict with `content` field containing JSON string | `json.loads(result["content"])` |
| Linear list | Parameter is `state=` | NOT `status=` |
| SDK tools | All async | Use `asyncio.run(main())` |
| GitHub CLI | Response field | `result.stdout` NOT `result.content` |
| Slack admin | Channels returned as dicts | `ch["id"]` NOT `ch.id` |

---

## SECTION H: REUSABLE SCRIPTS

### `scripts/weekly_summary.py`
- Pull PostHog DAU + Linear issues for Friday digest
- Runs all queries in parallel via `asyncio.gather()`
- Output: Slack-ready text with ASCII DAU bar chart

### `scripts/check_new_messages.py`
- Scan local Slack file system for new messages since last heartbeat
- Reads `execution.log` for last timestamp, scans `/work/slack/*/YYYY-MM.log`
- Does not use SDK — reads files directly for reliability
