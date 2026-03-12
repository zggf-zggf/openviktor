# Self-Learning System

**Generated:** 2026-03-12
**Period:** 2026-02-25 to 2026-03-12 (16 days, 59 heartbeat runs)
**Sources:** 59 heartbeat transcripts, execution.log, LEARNINGS.md (49,192 chars / 503 lines)

---

## A) THE LEARNINGS.MD GROWTH MECHANISM

Viktor is **stateless** — each agent run starts with zero memory. All cross-run knowledge persists through `LEARNINGS.md`, a plain text file read at the start of every run. Over 16 days it grew 16.6x: 2,968 → 49,192 characters.

### Three Phases of File Operations

The agent's strategy for updating LEARNINGS.md evolved as the file grew:

| Phase | Runs | Method | Avg chars/run | Description |
|---|---|---|---|---|
| **Full Rewrite** | HB#1-4 | `file_write` | ~1-2k | Complete replacement each run. Simple but destructive — early content was overwritten. |
| **Surgical Append** | HB#5-34 | `file_edit` | ~920 | Switched to targeted edits. 2-6 insertions/modifications per run. Prior content preserved. |
| **Paginated Growth** | HB#35+ | `file_read` (chunked) + `file_edit` | ~600 | File exceeded 32k char read limit. Viktor reads in 100-200 line chunks, prioritizing permanent sections first. |

### File Structure (emergent, not prescribed)

The system prompt says only "read LEARNINGS.md first every run" and "update LEARNINGS.md at the end." The internal structure emerged organically:

```
LEARNINGS.md
├── Team Context           ← Always read first (permanent)
│   ├── Per-person profiles
│   └── Communication preferences
├── Communication Style    ← Always read first (permanent)
│   ├── Engagement rules
│   └── "Mistakes to Avoid" list
├── Tool/API Notes         ← Reference section
│   └── SDK quirks with fix patterns
├── Current State          ← Updated every run
│   ├── Active threads
│   ├── Pending items
│   └── Silence counter
└── Per-Run Notes          ← Append-only log
    └── HB#N: date, observations, actions
```

**No pruning occurred in 59 runs.** The file only grew. This is a design limitation — eventually the file will exceed context window capacity.

---

## B) THE SELF-CORRECTION FEEDBACK LOOP

Viktor's behavioral rules come from two sources that can conflict:

```
┌─────────────────┐     ┌──────────────────────┐
│  System Prompt   │     │   LEARNINGS.md        │
│  (task.json)     │     │   (accumulated)       │
│                  │     │                        │
│  "Be VISIBLY     │  vs │  "STOP proactive       │
│   helpful"       │     │   outreach. Be         │
│                  │     │   reactive only."       │
│  "Passivity has  │     │                        │
│   a cost"        │     │  "5+ unread = stop"    │
└─────────────────┘     └──────────────────────┘
        │                         │
        └──── LLM resolves ───────┘
              conflict at
              runtime
```

### How Rules Are Created

Four mechanisms drive rule creation in LEARNINGS.md:

**1. Error-Driven Addition** — User gives negative feedback → agent writes a "Mistakes to Avoid" entry.

| Trigger | Rule Written |
|---|---|
| User caught fabricated URLs | "Never fabricate URLs — blank instead" |
| User called extraction approach "stupid" | "Don't switch web→AI when rate-limited" |
| Wrong GitHub attribution | "Verify username→person before attributing" |

**2. Observation-Driven Codification** — Agent detects a pattern across multiple runs and writes it as a rule without direct user feedback. Example: after 7 days of zero Slack engagement, Viktor wrote the reactive-only doctrine at HB#20.

**3. Process Bug Discovery** — Agent detects its own flawed logic. At HB#44, Viktor noticed 5 consecutive heartbeats reported "Linear: no changes since Mar 5" — which was wrong. Fix: "Always query linear_list_issues fresh each heartbeat, never assume no changes."

**4. API/SDK Fix Documentation** — Tool failures documented with exact fix patterns (e.g., PostHog returns TEXT not JSON → parse with regex). These persist as reference material for future runs.

### The "Mistakes to Avoid" List

This list grew from ~2 entries (day 1) to 12 entries (day 16). It functions as a durable negative constraint system — once a mistake is recorded, it's checked every run.

---

## C) THE ENGAGEMENT THRESHOLD SYSTEM

Viktor maintains numeric thresholds that gate its outreach behavior. Some come from the system prompt; most were learned.

| Threshold | Value | Source | Mechanism |
|---|---|---|---|
| Unanswered question trigger | 2+ hours | task.json (hard-coded) | Respond to questions left hanging |
| Max nudges before abandon | 1 nudge | LEARNINGS.md (learned) | Don't re-ask after one attempt |
| Unread messages → stop outreach | 5+ unread | LEARNINGS.md (learned) | Integer counter checked each run |
| Silence days → reactive-only | 7 days | LEARNINGS.md (learned HB#20) | Silence counter gates all proactive action |
| Pending task → abandon | 48 hours | LEARNINGS.md (inferred HB#9) | Stop tracking unresponded proposals |
| Humor frequency | 1 in 3 heartbeats | task.json (hard-coded) | Rate limiter for personality content |

### The Silence Counter

An integer maintained in LEARNINGS.md's "Current State" section. Incremented each heartbeat when no human Slack messages are found. Functions as a behavioral gate:

```
silence_days = 0  → Full proactive mode (system prompt default)
silence_days < 7  → Reduced outreach, still send proposals
silence_days >= 7 → Reactive-only mode (learned override)
```

This counter is the mechanism by which learned behavior overrides the system prompt's "be proactive" instruction.

---

## D) THE PROACTIVE-TO-REACTIVE TRANSITION

The system prompt (task.json) explicitly instructs proactive behavior. The agent learned to override this through environmental feedback. This is the core self-modification pattern.

### The Override Mechanism

```
System prompt: "Be VISIBLY helpful. Passivity has a cost."
                          │
                          ▼
         Agent sends proactive messages (days 1-3)
                          │
                          ▼
         Zero responses, zero reactions (days 1-7)
                          │
                          ▼
         Agent writes to LEARNINGS.md:
         "This team communicates through code, not Slack.
          Viktor should be a tool they reach for, not a
          colleague that keeps knocking."
                          │
                          ▼
         LEARNINGS.md loaded before system prompt is evaluated
                          │
                          ▼
         Learned rule overrides system prompt instruction
```

### Meta-Signal Detection

Viktor also incorporated signals from the team's own product decisions. When Mateusz shipped PR #106 ("keep_an_eye_on tool to reduce agent over-responding"), Viktor wrote: *"The team is building features about agents knowing when to back off; Viktor should embody that ethos."*

This represents the system reading its environment at a meta level — not just tracking direct feedback, but interpreting the team's product roadmap as behavioral guidance.

---

## E) EMERGENT SYSTEM PATTERNS

These patterns were not specified in the system prompt but emerged from the LLM's behavior over multiple runs:

| Pattern | First Appeared | Description |
|---|---|---|
| Per-run structured notes | HB#8 | Consistent schema for each heartbeat's observations (emerged without instruction) |
| todo.md lifecycle | HB#1 | Create at start, delete at end, every single run — self-imposed ritual |
| Silence counter as gate | HB#9 | Integer tracking mechanism for engagement thresholds |
| Paginated file reading | HB#35 | Adapted to 32k read limit by chunking LEARNINGS.md reads |
| Product meta-observation | HB#26 | Interpreting team's product decisions as behavioral signals |

### The todo.md Ritual

Every heartbeat run creates a `todo.md` file at the start listing planned actions, then deletes it at the end. This was never instructed — the LLM adopted it as a self-organizing mechanism. It functions as an ephemeral working memory within a single run, complementing the persistent LEARNINGS.md.

---

## F) SYSTEM LIMITATIONS

### No Pruning Mechanism

LEARNINGS.md only grows. At 49KB after 16 days, linear extrapolation suggests it would exceed typical context windows within months. No summarization, archival, or pruning system exists.

### Empty Per-User Files

The platform provisions `skills/users/{id}/SKILL.md` templates for per-user memory, but Viktor never populated them. All user-specific knowledge accumulated in the monolithic LEARNINGS.md. This suggests the per-user memory architecture was designed but the agent's learned behavior bypassed it.

### No Cross-Cron Knowledge Sharing

Each cron job (heartbeat, workflow_discovery, channel_introductions) maintains its own LEARNINGS.md. There's no mechanism for one cron's learnings to propagate to another — the heartbeat cron learned "be reactive" but the workflow_discovery cron had to learn this independently.

### Phase 1 Data Loss

The full-rewrite phase (HB#1-4) using `file_write` destroyed earlier content on each run. The transition to `file_edit` at HB#5 was critical for knowledge accumulation. This transition was not prompted — the LLM independently shifted strategy.
