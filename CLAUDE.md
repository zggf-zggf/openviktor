# CLAUDE.md

Project-specific instructions for Claude Code.

## Project Structure

TypeScript monorepo with Bun workspaces and Turborepo:
- `apps/bot/` — Slack bot + agent runtime (main entry point)
- `apps/web/` — Admin dashboard (Phase 7, React + Vite)
- `packages/db/` — PostgreSQL schema with Prisma ORM
- `packages/shared/` — Shared types, config (zod), logger (pino), errors
- `packages/tools/` — Tool registry + executors
- `packages/integrations/` — External service clients (GitHub, Linear, etc.)

## Common Commands

```bash
# Install
bun install

# Development
bun run dev                    # Start all dev servers
bun run --filter @openviktor/bot dev  # Start bot only

# Database
bun run db:generate            # Regenerate Prisma client
bun run db:migrate             # Run migrations (dev)
bun run --filter @openviktor/db db:migrate:deploy  # Run migrations (prod)
bun run --filter @openviktor/db db:studio          # Database GUI

# Quality
bun run lint                   # Biome check
bun run lint:fix               # Biome auto-fix
bun run typecheck              # TypeScript strict check
bun run test                   # Run all tests
bun run test:coverage          # Tests with coverage

# Infrastructure
docker compose -f docker/docker-compose.yml up -d     # Start PostgreSQL + Redis
docker compose -f docker/docker-compose.yml down       # Stop infrastructure
```

## Type Checking After Schema Changes

After modifying `packages/db/prisma/schema.prisma`:

1. Regenerate Prisma client: `bun run db:generate`
2. Create migration: `cd packages/db && bunx prisma migrate dev --name describe-change`
3. Run type check: `bun run typecheck`

## Code Style

- Follow clean code principles: no unnecessary comments
- Only write doc-strings for public APIs, exported functions, and non-obvious interfaces
- Do not add inline comments explaining what the code does
- TypeScript strict mode is enforced
- Biome handles formatting and linting

## Database

- PostgreSQL 16 with Prisma ORM
- Schema: `packages/db/prisma/schema.prisma`
- Migrations: `packages/db/prisma/migrations/`
- Uses `prisma migrate deploy` in Docker (not `db push`)

## Development Workflow (Linear Integration)

We use Linear for issue tracking (OpenViktor project). Follow this workflow:

### 1. Get or Create Linear Issue
- Find existing issue or create a new one in the OpenViktor project
- Move the issue to "In Progress"

### 2. Explore the Codebase
- Read relevant files until you understand the issue
- Understand the current implementation

### 3. Ask Clarifying Questions
- Ask 5-10 questions about scope, expected behavior, edge cases

### 4. Document Q&A in Linear
- Add a comment with the full Q&A

### 5. Create Specification
- Plan the implementation: files to touch, schema changes, pitfalls
- Post as a Linear comment with `#SPECIFICATION` header

### 5.5. Checkpoint
- Ask: "Ready to start implementation? Clear context first if needed"

### 6. Implementation
- Create branch (use Linear's suggested branch name)
- Implement according to specification
- Create pull request and link to Linear issue

## Viktor Reference Cross-Validation

Every implementation change must be cross-validated against our reverse-engineering knowledge in `docs/viktor-reference/`. Before implementing any feature:

1. Check relevant reference docs (e.g., `thread-orchestrator.md` for thread handling, `tool-gateway.md` for tool execution)
2. Ensure behavior matches Viktor's known patterns — deviations must be intentional and documented
3. Key reference files:
   - `architecture.md` — Overall system design and subsystem interactions
   - `conversational-style.md` — Tone, formatting, response patterns
   - `thread-orchestrator.md` — Thread lifecycle, concurrency (16 thread limit)
   - `tool-gateway.md` — Tool execution, timeouts (600s tool, 120s bash)
   - `heartbeat.md` — Proactive check-in system (4x/day)
   - `memory.md` — Knowledge persistence and retrieval
   - `skill-routing.md` — How Viktor routes to capabilities
   - `cost-control.md` — Token budgets and tier system

## Key Patterns

- Slack connection via Socket Mode (no public URL needed)
- LLM calls through provider abstraction (`apps/bot/src/agent/llm.ts`)
- All agent work tracked as `AgentRun` rows in PostgreSQL
- Structured logging with pino (JSON in production, pretty in dev)
- Environment config validated with zod at startup
