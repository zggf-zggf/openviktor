# Viktor AI Coworker — Reverse Engineering

Comprehensive reverse engineering of [Viktor](https://getviktor.com) (by Zeta Labs), a Slack AI coworker platform, from two backup archives extracted on 2026-03-12.

## Reports

| # | File | Content |
|---|------|---------|
| 01 | [Heartbeat System](01-heartbeat-system.md) | 4x/day monitoring engine: system prompt rules, 12 learned "mistakes to avoid", decision tree, engagement thresholds, SDK/API quirks |
| 02 | [Workflow Discovery](02-workflow-discovery.md) | Tue/Fri engagement system: per-person profiling, channel intro lifecycle, conservative engagement strategy, success/failure tracking |
| 03 | [Prompt & Communication Systems](03-conversational-style.md) | Reflection mechanism, personalization pipeline, onboarding system, permission requests, thread management, error handling prompt rules |
| 04 | [Self-Learning System](04-behavioral-evolution.md) | LEARNINGS.md growth mechanics, self-correction feedback loop, engagement threshold system, proactive→reactive transition, emergent patterns, system limitations |
| 05 | [Synthesis: Known vs Unknown](05-synthesis-what-we-know-vs-dont.md) | What we reverse-engineered (~80%) vs 8 critical infrastructure unknowns blocking reimplementation |
| 06 | [Deep Research: 8 Unknowns](06-deep-research-unknowns.md) | Unknown-by-unknown investigation resolving all 8 blockers: skill routing (LLM-native), sandbox (Modal), thread orchestrator, tool gateway, cost control, Slack sync, agent lifecycle, engagement tuning |

## Key Numbers

- **166 tools** across 16 auto-generated Python modules
- **3 integration types**: Native, MCP, Pipedream
- **58 heartbeat runs** analyzed (89.7% resulted in silence)
- **76 agent run transcripts** analyzed for lifecycle reconstruction
- **51KB LEARNINGS.md** accumulated across 16 days
- **5 proposals sent, 0 responses** — drove the reactive-only pivot
- **8 critical unknowns** identified → **0 blockers** remaining (all resolved to 80-97% confidence)

## Source Data

Extracted from:
- `viktor-workspace-backup-2026-03-12.tar.gz` — 164 files
- `viktor-backup-extra-2026-03-12.tar.gz` — 102 files (sdk + agent_runs)

Analysis workspace: `/home/mjacniacki/Downloads/viktor-analysis/`
