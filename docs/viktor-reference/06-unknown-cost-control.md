# 06 — Condition Script Pattern & Cost Control

**Date:** 2026-03-12
**Method:** Static analysis of SDK source, skill definitions, cron task configs, example workflows, plans/pricing references, agent run logs, and web research.
**Sources:** `skills/scheduled_crons/SKILL.md`, `skills/viktor_account/SKILL.md`, `skills/viktor_account/references/plans.md`, `sdk/tools/scheduled_crons.py`, `sdk/tools/thread_orchestration_tools.py`, `skills/workflow_discovery/references/example_workflows.md`, `crons/*/task.json`, web search results from getviktor.com and third-party reviews.

---

## 1. The Credit/Pricing System

### 1.1 Credit-Based Economy

Viktor operates on a **credit-based abstraction layer** that sits between users and raw AI model costs. Every AI action consumes credits: messages, tool calls, cron executions, image generation, and web browsing.

**Confidence: VERY HIGH** — directly from `skills/viktor_account/SKILL.md` and `references/plans.md`.

Key properties:

| Property | Detail |
|----------|--------|
| **Billing Credits** | Monthly allocation tied to plan tier. Resets each billing cycle. |
| **Reward Credits** | Permanent pool from trial, referrals, promotions. Never expire, never reset. |
| **Consumption order** | Billing credits consumed first, then reward credits. |
| **Credit-to-cost ratio** | "One credit ~ a small fraction of a cent of AI model cost (exact ratio depends on the model used)" |
| **Base rate** | $0.00250 per credit at the $50/month tier |
| **Best rate** | $0.00208 per credit at the $5,000/month tier (16.7% discount) |

### 1.2 Plan Tiers

Twelve discrete plan tiers, per-workspace (not per-seat):

| Package ID | Monthly Price | Monthly Credits | Per-Credit Cost | Volume Discount |
|------------|--------------|-----------------|-----------------|-----------------|
| `credits_20000` | $50 | 20,000 | $0.00250 | — |
| `credits_30000` | $75 | 30,000 | $0.00250 | — |
| `credits_40000` | $100 | 40,000 | $0.00250 | — |
| `credits_80000` | $200 | 80,000 | $0.00250 | — |
| `credits_125000` | $300 | 125,000 | $0.00240 | 4.0% |
| `credits_170000` | $400 | 170,000 | $0.00235 | 5.9% |
| `credits_220000` | $500 | 220,000 | $0.00227 | 9.1% |
| `credits_335000` | $750 | 335,000 | $0.00224 | 10.4% |
| `credits_460000` | $1,000 | 460,000 | $0.00217 | 13.0% |
| `credits_700000` | $1,500 | 700,000 | $0.00214 | 14.3% |
| `credits_950000` | $2,000 | 950,000 | $0.00211 | 15.8% |
| `credits_2400000` | $5,000 | 2,400,000 | $0.00208 | 16.7% |

Plus enterprise tier with custom pricing (contact support@getviktor.com).

**Confidence: VERY HIGH** — exact data from `references/plans.md`, package IDs included.

### 1.3 Trial & Referral Credits

- **Trial**: 10,000 reward credits per seat (permanent pool, never expires).
- **Slack team bonus**: Currently paused.
- **Referral**: 10,000 reward credits per successful referral (~$25 equivalent).
- **Creator Program**: Post about Viktor on LinkedIn, submit after 7 days. Rewards in credits (50% more value than cash equivalent) or cash.

**Confidence: HIGH** — from `SKILL.md` and `plans.md`.

### 1.4 Credit Observability

Viktor exposes a full self-monitoring SDK for credit usage:

```python
# Subscription state
info = await get_subscription_info()
info.credits_balance          # remaining
info.credits_used             # consumed this period
info.burn_rate_credits_per_day  # daily burn rate
info.is_projected_to_run_out    # predictive warning

# Usage breakdown
usage = await get_usage_overview(period="this_month")
usage.total_credits / usage.avg_daily_credits / usage.daily_spend[]

# Per-thread cost attribution
threads = await get_usage_threads(
    period="this_month",
    order="most_credits",
    thread_type="cron"   # isolate cron costs
)
```

This means Viktor is self-aware of its own cost impact. The `burn_rate_credits_per_day` and `is_projected_to_run_out` fields form a built-in FinOps guardrail.

**Confidence: VERY HIGH** — exact SDK function signatures from `skills/viktor_account/SKILL.md`.

---

## 2. Model Selection per Cron — The Three-Tier Cost Hierarchy

### 2.1 Available Models

Viktor supports four AI models for agent crons, configured via the `model` parameter on `create_agent_cron`:

| Model String | Tier Name (in workflows) | Purpose | Relative Cost |
|-------------|-------------------------|---------|---------------|
| `claude-opus-4-6#ReasoningLevel:very_high` | **(default)** | Most agent crons. Complex reasoning. | **Highest** |
| `gpt-5.4` | — | Strongest OpenAI model for complex professional work. | **High** |
| `claude-sonnet-4-6` | "Balanced" | Lower-cost routine work. | **Medium** |
| `gemini-3-flash-preview` | "Fast" | Simple, high-volume tasks. Quality trade-offs acceptable. | **Lowest** |

**Confidence: VERY HIGH** — exact strings from `skills/scheduled_crons/SKILL.md` line 38 and `sdk/tools/scheduled_crons.py` line 19.

### 2.2 The `#ReasoningLevel:very_high` Suffix

The default model string `claude-opus-4-6#ReasoningLevel:very_high` uses a hash-fragment convention to encode inference parameters. The `#ReasoningLevel:very_high` suffix likely maps to Anthropic's extended thinking / reasoning mode, which increases token usage (and therefore cost) but produces higher-quality multi-step reasoning.

This is the **only model that carries a reasoning-level modifier** in the codebase. The other three models are used with their base configurations.

**Confidence: HIGH** — the syntax is visible in source; the exact cost multiplier is not documented but extended thinking is known to increase token consumption significantly.

### 2.3 Three-Tier Model Strategy in Practice

The `example_workflows.md` file (1,452+ lines of workflow templates) reveals a clear three-tier pattern that Viktor recommends for all customer workflows:

| Tier | Label in Workflows | Model | Count in Example Workflows | Use Cases |
|------|-------------------|-------|---------------------------|-----------|
| **Premium** | (default / unlabeled) | `claude-opus-4-6#ReasoningLevel:very_high` | Used when no model specified | Complex analysis, multi-step research, judgment-heavy tasks |
| **Balanced** | "Balanced model" | `claude-sonnet-4-6` | **~27 occurrences** | Bug triage, lead responses, content drafts, CRM updates, review summaries |
| **Fast** | "Fast model" | `gemini-3-flash-preview` | **~5 occurrences** | RSS forwarding, simple routing, link forwarding, reminders |

The overwhelming majority of example workflows recommend "Balanced model" — indicating Viktor's design philosophy favors cost optimization over maximum intelligence for recurring automated tasks.

**Confidence: HIGH** — pattern counts from grep across `example_workflows.md`.

---

## 3. The `condition_script_path` Mechanism

### 3.1 How It Works

The `condition_script_path` is Viktor's primary cost-avoidance mechanism. It is a **pre-execution gate** that prevents expensive agent cron runs when there is nothing to do.

**Architecture:**

```
Cron schedule fires
       │
       ▼
┌─────────────────────────┐
│  condition_script_path   │  ← Lightweight Python script
│  (runs BEFORE agent)     │     No AI tokens consumed
│                          │
│  exit code 0 → proceed   │
│  exit code ≠ 0 → SKIP   │
└─────────────────────────┘
       │ (exit 0 only)
       ▼
┌─────────────────────────┐
│  Agent cron executes     │  ← Full AI agent, consumes credits
│  (model + tools + prompt)│
└─────────────────────────┘
```

**Key properties:**

1. **Available on both cron types**: `create_agent_cron` and `create_script_cron` accept `condition_script_path`.
2. **Exit code semantics**: Exit 0 = run the cron. Any non-zero exit = skip this cycle entirely.
3. **No credit cost**: The condition script is a plain Python script execution — no AI agent is spun up, so no credits are consumed for the check.
4. **Script location**: Scripts live in the sandbox at paths like `/work/scripts/conditions/has_new_slack_messages.py`.

**Confidence: VERY HIGH** — documented in `skills/scheduled_crons/SKILL.md` lines 82-112, implemented in `sdk/tools/scheduled_crons.py`.

### 3.2 Example Condition Script

From the official documentation:

```python
# /work/scripts/conditions/has_new_slack_messages.py
import sys
from sdk.utils.slack_reader import get_new_slack_messages
from datetime import datetime, timedelta, timezone

since = datetime.now(timezone.utc) - timedelta(hours=1)
if not get_new_slack_messages(since=since, channel_names=["sales"]):
    sys.exit(1)  # No new messages → skip this run
# Implicit exit(0) → new messages found → run the agent
```

### 3.3 Condition Script Usage Patterns in Example Workflows

Analyzing `example_workflows.md`, condition scripts are recommended for virtually every high-frequency workflow:

| Pattern | Example | Frequency |
|---------|---------|-----------|
| **New Slack messages** | Check #sales for new leads | Every 15 min |
| **New Stripe events** | Check for new payments/signups | Every 15 min |
| **New files in Drive** | Check for uploaded documents | Every 15 min |
| **New bookings** | Check calendar for new entries | Every 15 min |
| **New emails** | Check inbox for new messages | Every 15 min |
| **New comments** | Check for new review comments | Every 1-2 hours |
| **New feedback** | Check for new survey responses | Every few hours |
| **Signed documents** | Check for newly signed contracts | Every 30 min |

Without condition scripts, a 15-minute cron would fire **96 times per day**. With a condition script that only finds new data 5-10 times, that drops to **5-10 agent runs per day** — a ~90% cost reduction.

**Confidence: VERY HIGH** — patterns directly from example_workflows.md.

### 3.4 The "6 Runs Per Day" Rule

Viktor's documentation enforces a clear threshold:

> "Agent crons are expensive — each execution runs a full AI agent. Scheduling agent crons more than ~6 times per day can get costly fast."

This threshold appears in **three separate locations**:
1. `skills/scheduled_crons/SKILL.md` line 84
2. `skills/workflow_discovery/references/example_workflows.md` line 11
3. `skills/workflow_discovery/SKILL.md` line 354

Viktor is instructed to **warn users** before creating high-frequency crons without condition scripts.

**Confidence: VERY HIGH** — triple-sourced.

---

## 4. The Complete Cost Control Architecture

### 4.1 Five Layers of Cost Control

Viktor implements cost control at five distinct layers:

```
Layer 1: PLAN CAPS
  └─ Monthly credit allocation hard-caps spending
  └─ Burn rate forecasting warns before exhaustion

Layer 2: CRON FREQUENCY CONTROL
  └─ Schedule expressions limit run frequency
  └─ Work-hours-only patterns (e.g., "0 9-17 * * 1-5")
  └─ 6-runs-per-day soft limit with user warnings

Layer 3: CONDITION SCRIPT GATING
  └─ condition_script_path pre-checks before agent execution
  └─ Exit code 0/non-zero gate → skip unnecessary runs
  └─ Zero credit cost for the check itself

Layer 4: EXECUTION TYPE SELECTION
  └─ script_cron (no AI, zero model cost) vs agent_cron
  └─ Deterministic tasks use script_cron entirely

Layer 5: MODEL TIER SELECTION
  └─ Premium: claude-opus-4-6#ReasoningLevel:very_high
  └─ Balanced: claude-sonnet-4-6
  └─ Fast: gemini-3-flash-preview
  └─ Match model to task complexity
```

### 4.2 Decision Tree for Cron Creation

Based on the documented guidance, Viktor follows this implicit decision tree when creating crons:

```
Does the task need AI reasoning?
├─ NO → create_script_cron (zero model cost)
│       Example: RSS forwarding, log cleanup, data sync
│
└─ YES → create_agent_cron
         │
         Is the task triggered by external data?
         ├─ YES → Add condition_script_path
         │       (check for new data before running)
         │
         └─ NO → Schedule conservatively
                 │
                 How complex is the reasoning needed?
                 ├─ Complex analysis/research → claude-opus-4-6#ReasoningLevel:very_high
                 ├─ Routine processing → claude-sonnet-4-6 (Balanced)
                 └─ Simple high-volume → gemini-3-flash-preview (Fast)
```

### 4.3 The `dependent_paths` Mechanism

In addition to condition scripts, crons support `dependent_paths` — a list of cron or thread paths that must complete before the current cron runs. This enables **pipeline orchestration** where expensive agent crons only run after cheaper script crons have verified data availability.

```python
await create_agent_cron(
    path="/reports/analysis",
    dependent_paths=["/data/fetch"],  # Wait for data fetch to complete
    ...
)
```

**Confidence: HIGH** — from `sdk/tools/scheduled_crons.py` and `thread_orchestration_tools.py`.

---

## 5. Cost Estimation for Running Viktor

### 5.1 Credit Consumption Model

The documentation states "complex tasks consume 500-900 credits each" (from web search). Using this and the plan pricing:

| Scenario | Monthly Cron Runs | Est. Credits/Run | Monthly Credits | Min Plan | Monthly Cost |
|----------|------------------|-------------------|-----------------|----------|-------------|
| **Light** (1 heartbeat + 1 weekly workflow) | ~130 heartbeats + 4 weekly | ~200-500 | ~30,000-70,000 | credits_40000 to credits_80000 | $100-$200 |
| **Medium** (heartbeat + 3 daily workflows + 1 weekly) | ~130 + 90 + 4 = ~224 | ~300-600 | ~70,000-135,000 | credits_80000 to credits_170000 | $200-$400 |
| **Heavy** (heartbeat + 10 high-freq workflows with conditions) | ~130 + 300+ = ~430+ | ~300-700 | ~130,000-300,000 | credits_170000 to credits_335000 | $400-$750 |
| **Enterprise** (dozens of workflows, multiple integrations) | 1,000+ | varies | 460,000+ | credits_460000+ | $1,000+ |

**Confidence: MEDIUM** — credit-per-run is inferred from web sources and is not precisely documented. The "500-900 per complex task" figure may vary significantly by model tier and task complexity.

### 5.2 Cost of the Observed Deployment

The analyzed workspace has two crons:

1. **Heartbeat**: `1 8,11,14,17 * * *` = 4 runs/day, ~120/month
2. **Workflow Discovery**: `1 9 * * 2,5` = 2 runs/week, ~8-9/month

Total: ~129 agent runs/month. At an estimated 300-600 credits per run, that is **39,000-77,000 credits/month**, suggesting a **$100-$200/month plan** for this workspace.

Neither cron has a `model` override in `task.json`, meaning both use the default `claude-opus-4-6#ReasoningLevel:very_high` — the most expensive option. Neither has a `condition_script_path`, though the heartbeat cron's prompt instructs it to check for new Slack messages via SDK (but this happens *after* the agent is already running and consuming credits).

**Confidence: MEDIUM** — the credit-per-run figure is estimated. The cron configs are exact.

### 5.3 Per-Credit Cost to Viktor (Margin Analysis)

The documentation states Viktor "keeps margins low so users won't pay much on top of API prices." At the base rate of $0.00250/credit:

- If 1 credit ~ 1 cent of underlying model cost, Viktor's margin is ~75%
- If 1 credit ~ 0.1 cent of model cost, Viktor's margin is ~60%
- The documentation says "a small fraction of a cent" which suggests the latter range

The exact credit-to-token mapping is not publicly documented, making precise margin analysis impossible.

**Confidence: LOW** — the relationship between credits and actual API token costs is deliberately opaque.

---

## 6. What We Still Don't Know

### 6.1 Unknown: Credit Cost Per Model

The single biggest unknown is **how many credits each model tier consumes per action**. We know:
- Different models have different costs ("exact ratio depends on the model used")
- The three-tier model system exists
- "Balanced" is recommended for most workflows

But we do NOT know:
- Does `claude-opus-4-6#ReasoningLevel:very_high` cost 2x? 5x? 10x more credits than `gemini-3-flash-preview`?
- Is the credit multiplier per-token or per-invocation?
- Does the `#ReasoningLevel:very_high` suffix add a fixed surcharge or a multiplicative factor?

**Confidence in gap: VERY HIGH** — this information is not in any analyzed file.

### 6.2 Unknown: Credit Consumption Per Tool Call

Each tool call (Slack, Linear, Notion, Google Sheets, web browsing) presumably has a different credit cost. Image generation is noted as "relatively expensive" and web browsing "consumes credits per step." But no per-tool credit schedule is documented.

**Confidence in gap: HIGH**.

### 6.3 Unknown: Condition Script Runtime Limits

Is there a timeout on condition scripts? Can a condition script itself make API calls that consume credits? The documentation only shows lightweight checks (Slack message existence, file checks). The boundary between "free condition check" and "billable action" is not defined.

**Confidence in gap: MEDIUM** — condition scripts use `sdk.utils` which may or may not be billable.

### 6.4 Unknown: Per-Cron Budget Caps

The web research suggests that AI agent platforms should implement "budget limits per agent" to prevent runaway costs. Viktor's documentation shows workspace-level credit caps (via plan tiers) and burn-rate forecasting, but there is **no evidence of per-cron or per-thread credit budgets** in the SDK or skill definitions.

**Confidence in gap: HIGH** — searched for "budget" across all files, found only references to user budgets in Google Sheets/Notion integrations, not cron-level budgets.

---

## 7. Architectural Insight: Viktor's Cost Philosophy

Viktor's cost control is notable for what it *isn't*: it is not a hard-enforcement system with per-agent budgets and automatic shutoffs. Instead, it is a **soft guidance system** embedded in the agent's own instructions:

1. **Agent self-awareness**: Viktor can query its own credit usage and burn rate.
2. **Instructional guardrails**: The scheduled_crons skill tells the agent to warn users about expensive patterns.
3. **Design patterns**: Condition scripts, model tiers, and script crons are presented as best practices, not enforced constraints.
4. **User-facing observability**: The `/usage` dashboard lets users see per-thread and per-cron costs.

This is a deliberate design choice: Viktor is an autonomous agent that must make cost/quality tradeoffs on behalf of its user, so it needs to *understand* costs rather than be blindly constrained by them.

The closest analogy is a human employee who has a corporate credit card with a monthly budget and is expected to use good judgment — not an employee who needs approval for every purchase.

---

## 8. Summary Table

| Finding | Confidence | Source |
|---------|-----------|--------|
| Credit-based pricing with 12 tiers ($50-$5,000/mo) | VERY HIGH | `plans.md`, `SKILL.md` |
| Base rate: $0.00250/credit, best: $0.00208/credit | VERY HIGH | `plans.md` |
| Two credit types: billing (resets) + reward (permanent) | VERY HIGH | `plans.md` |
| Four model tiers: opus+reasoning, gpt-5.4, sonnet, gemini-flash | VERY HIGH | `scheduled_crons/SKILL.md`, `scheduled_crons.py` |
| Default model: `claude-opus-4-6#ReasoningLevel:very_high` | VERY HIGH | `scheduled_crons/SKILL.md` |
| `condition_script_path`: exit 0 = run, non-zero = skip | VERY HIGH | `scheduled_crons/SKILL.md`, `scheduled_crons.py` |
| 6-runs-per-day soft limit with user warnings | VERY HIGH | Triple-sourced across skills |
| `dependent_paths` for pipeline orchestration | HIGH | `scheduled_crons.py`, `thread_orchestration_tools.py` |
| ~27 "Balanced model" recommendations in example workflows | HIGH | `example_workflows.md` |
| Script crons (no AI) vs agent crons (full AI) | VERY HIGH | `scheduled_crons/SKILL.md` |
| Self-monitoring via `get_subscription_info()` burn rate | VERY HIGH | `viktor_account/SKILL.md` |
| Estimated 300-600 credits per agent cron run | MEDIUM | Web sources, inferred |
| No per-cron budget caps in SDK | HIGH (gap) | Exhaustive search |
| Credit-to-token ratio per model unknown | VERY HIGH (gap) | Not documented anywhere |

---

*Sources: Internal analysis of `/home/mjacniacki/Downloads/viktor-analysis/` codebase. Web sources: [Viktor homepage](https://getviktor.com/), [Viktor on Product Hunt](https://www.producthunt.com/products/viktor), [Viktor vs Devin vs Manus comparison](https://getviktor.com/blog/viktor-vs-devin-vs-manus), [Futurepedia review](https://www.futurepedia.io/tool/viktor), [AI agent cost optimization patterns](https://datagrid.com/blog/8-strategies-cut-ai-agent-costs).*
