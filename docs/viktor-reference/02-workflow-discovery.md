# Viktor AI Coworker — Workflow Discovery Behavioral Analysis

**Generated:** 2026-03-12
**Sources:** `crons/workflow_discovery/task.json`, `crons/flow_discovery/discovery.md`, `crons/flow_discovery/LEARNINGS.md`, `crons/flow_discovery/execution.log`, `crons/flow_discovery/scripts/check_engagement.py`, `crons/channel_introductions/LEARNINGS.md`

---

## A) WORKFLOW DISCOVERY ALGORITHM

### Invocation
- **Cron:** `1 9 * * 2,5` — 09:01 UTC every Tuesday and Friday
- **State file:** `crons/flow_discovery/discovery.md`

### Five Phases Per Run

**Phase 1 — Data Gathering:**
1. `crons/heartbeat/LEARNINGS.md` — "heartbeat LEARNINGS.md is gold"
2. All Slack message history (`$SLACK_ROOT/{person_name}/` and `$SLACK_ROOT/{channel_name}/`)
3. Linear issues: open, in-progress, recently completed/created
4. Integration status check
5. `check_engagement.py` script output

**Phase 2 — Per-Person Profiling:**
For each team member: Slack history, Linear assignments, communication style, prior Viktor interactions, DM channel ID.

**Phase 3 — Opportunity Identification:**
Scan for tasks where Viktor has comparative advantage: research, writing, monitoring, data analysis, logistics. Each tagged as "proposed" or "tracked, not pitched."

**Phase 4 — Engagement Decision (see Section F)**

**Phase 5 — Documentation Update:**
Updates `discovery.md`, `LEARNINGS.md`, `team/SKILL.md`, `check_engagement.py`.

---

## B) PER-PERSON ENGAGEMENT SCRIPTS

### Mateusz Jacniacki (Co-founder)
- DM channel: `D0AH4490KJ8`
- Profile: "Very direct, impatient with bad data quality, wants fast results"
- Proposals (Feb 27): Daily metric watchdog + Weekly competitor intel
- Response: Zero
- Key insight: "Mateusz's crypto research remains the ONLY engagement pattern: he initiates, he assigns, he pushes back on quality"

### Ignacio Borrell (Developer)
- DM channel: `D0AHUPLV41T`
- Contacted by heartbeat cron (Feb 26), not workflow_discovery
- Proposal: WhatsApp prospect research — Zero response
- HUM-191 completed by Ignacio himself without Viktor (negative signal)

### Maks Bilski (Developer)
- DM channel: `D0AHUPX6BEC`
- Proposals (Feb 27): On-call alert investigation + MoviePick landing page
- Response: Zero
- HUM-178 (landing page) built by Maks himself (PR #10) — negative signal

### MTK / Martí (Co-founder)
- Never contacted across all 3 runs — inactive since Feb 4
- Reactivation trigger: "MTK returns — hasn't been proposed to yet"

---

## C) CHANNEL INTRODUCTION SYSTEM

### Lifecycle (3-run, self-deleting)

| Run | Date | Channel | Tone | Action |
|-----|---------|---------------|-------------------------------|-------------|
| #1 | Feb 25 | #all-humalike | Professional + integrations | Continue |
| #2 | Feb 26 | #alerts | Incident-response focused | Continue |
| #3 | Feb 27 | #social | Casual/fun | SELF-DELETE |

### Message Template Rules
1. "Lead with connected integrations (shows immediate practical value)"
2. "List 4-5 concrete things Viktor can do (not vague platitudes)"
3. "End with a 'try this now' example using their actual tools"
4. "Keep tone friendly but direct — technical team appreciates brevity"
5. "Tailor examples to the channel's purpose"

### Per-Channel Content
- **#all-humalike:** Connected integrations + "try it now" example
- **#alerts:** PostHog error investigation, Linear issue filing, GitHub root cause
- **#social:** Image generation, web search, fun lookups, "pixel art RPG party"

---

## D) TIMING STRATEGY

- **Cron:** `1 9 * * 2,5` = Tuesday + Friday at 09:01
- Tuesday: catches Monday work, in-progress issues
- Friday: aligns with weekly digest — combined review moment
- After 3 zero-engagement runs: recommended reducing to weekly (Fridays only)
- Heartbeat (3x/day) handles real-time monitoring; discovery focuses on strategic weekly assessment

---

## E) SUCCESS/FAILURE TRACKING

### Primary Signal: Slack Reactions
`coworker_get_slack_reactions(channel_id, message_ts)` called on every tracked proposal and weekly report.

### Tracked Messages (from check_engagement.py)
- Mateusz: `D0AH4490KJ8`, ts `1772183424.536519`
- Maks: `D0AHUPX6BEC`, ts `1772183436.898099`
- Ignacio: `D0AHUPLV41T`, ts `1772125842.005209`
- Weekly Feb 27: `C0AEKVD4QP9`, ts `1772179693.711169`
- Weekly Mar 6: `C0AEKVD4QP9`, ts `1772784477.378529`

### Secondary Signal: Linear Task Completion
Cross-references proposals against Linear issue completions. If proposed task completed independently = NEGATIVE signal.

### Results Across 3 Runs

| Metric | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Days of Slack silence | 0 | 8+ | 13+ |
| Reactions on proposals | 0 | 0 | 0 |
| Tasks completed independently | N/A | 2 of 2 | N/A |
| Strategic decision | Outreach | STOP outreach | Stay quiet |

---

## F) THE CONSERVATIVE ENGAGEMENT STRATEGY

### Core Principle
> "Be the tool they reach for, not the colleague that keeps knocking."

### Initial Outreach Rules (Run 1)
1. Select 2-3 people per run via DM
2. Personalize based on observed Slack/Linear behavior
3. Ask about pain points — don't just offer
4. Skip already-contacted people with no reply
5. Skip inactive members

### When to STOP (all must be true)
1. Zero Slack engagement for 8+ days
2. Zero emoji reactions on any message
3. At least one proposed task completed independently
4. Meta-signal: team's own product decisions about agents being less pushy

### Post-Stop Rules
- Continue weekly digest as ONE proactive touch
- Respond instantly if anyone @mentions or DMs
- Track opportunities but don't pitch unprompted
- Do NOT send more proposal DMs
- Do NOT post channel proposals

### Conditions That Restart Outreach
1. Any human Slack message — even a reaction emoji
2. Someone @mentioning Viktor
3. New team member joins
4. MTK returns
5. Mateusz DMs Viktor directly

---

## G) RUN-BY-RUN EVOLUTION

| Aspect | Run 1 (Feb 27) | Run 2 (Mar 3) | Run 3 (Mar 6) |
|---|---|---|---|
| Messages in JSONL | 198 | 176 | 167 |
| People investigated | 4 | 4 (status check) | 4 (status check) |
| DMs sent | 2 (Mateusz, Maks) | 0 | 0 |
| Proposals made | 4 (2 per person) | 0 | 0 |
| Engagement found | N/A (first contact) | Zero | Zero |
| Strategic decision | Propose | STOP outreach | Stay quiet + reduce frequency |
