# Contributing to OpenViktor

Thank you for your interest in contributing to OpenViktor! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.2
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Git](https://git-scm.com/)

### Development Setup

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/openviktor.git
cd openviktor

# Install dependencies
bun install

# Start infrastructure (PostgreSQL + Redis)
docker compose -f docker/docker-compose.yml up -d

# Generate Prisma client
bun run db:generate

# Run database migrations
bun run db:migrate

# Verify everything works
bun run lint
bun run typecheck
bun run test
```

## Development Workflow

We use [Linear](https://linear.app) for issue tracking. All work should be tied to a Linear issue.

### 1. Pick or Create an Issue

- Check existing issues in the OpenViktor Linear project
- If your change doesn't have an issue, create one first

### 2. Create a Branch

Use the branch name suggested by Linear, or follow this convention:

```bash
git checkout -b feat/short-description   # new feature
git checkout -b fix/short-description    # bug fix
git checkout -b chore/short-description  # maintenance
```

### 3. Make Your Changes

- Follow the coding standards below
- Write tests for new functionality
- Update documentation if needed

### 4. Run Checks

```bash
bun run lint        # Biome linting
bun run typecheck   # TypeScript strict mode
bun run test        # All tests
```

### 5. Submit a Pull Request

- Fill out the PR template
- Link the Linear issue
- Ensure CI passes

## Coding Standards

### TypeScript

- Strict mode is enforced (`strict: true` in tsconfig)
- No `any` types (warning in Biome)
- Use explicit return types for exported functions

### Formatting & Linting

We use [Biome](https://biomejs.dev/) for both formatting and linting:

```bash
bun run lint        # Check for issues
bun run lint:fix    # Auto-fix issues
bun run format      # Format all files
```

### Code Style

- Follow clean code principles: no unnecessary comments
- Only write doc-strings for public APIs and non-obvious interfaces
- The code should be self-explanatory
- No inline comments explaining what the code does

### Testing

- Unit tests go next to the source file: `foo.ts` → `foo.test.ts`
- Integration tests go in `__tests__/` directories
- Unit tests must run without external services (mock everything)
- Use `vitest` for all tests
- Aim for 80% coverage on core packages, 60% on integration packages

### Database Changes

After modifying `packages/db/prisma/schema.prisma`:

1. Generate the Prisma client: `bun run db:generate`
2. Create a migration: `cd packages/db && bunx prisma migrate dev --name describe-change`
3. Run type check: `bun run typecheck`

## Project Structure

```
openviktor/
├── apps/
│   ├── bot/              # Slack bot + agent runtime
│   └── web/              # Admin dashboard
├── packages/
│   ├── db/               # Database schema + client
│   ├── shared/           # Shared types, config, utilities
│   ├── tools/            # Tool definitions + executors
│   └── integrations/     # External service clients
├── docker/               # Docker Compose configuration
├── scripts/              # Utility scripts
└── docs/                 # Documentation
```

## Viktor Reference Cross-Validation

OpenViktor is a reimplementation of [getviktor.com](https://getviktor.com). We maintain reverse-engineering reference docs in `docs/viktor-reference/` that describe Viktor's actual behavior.

**Before implementing any feature**, check the relevant reference docs to ensure your implementation matches Viktor's known patterns. Intentional deviations are fine but must be documented in the PR description with a rationale.

Key references:
- `architecture.md` — System design overview
- `tool-gateway.md` — Tool execution model
- `thread-orchestrator.md` — Thread lifecycle and concurrency
- `conversational-style.md` — Response tone and formatting
- `memory.md` — Knowledge persistence

## Commit Messages

Use conventional commits:

```
feat: add heartbeat monitoring system
fix: handle Slack event retries correctly
chore: update dependencies
docs: add self-hosting guide for Phase 1
test: add integration tests for agent runner
```

## Questions?

Open a GitHub issue or discussion if you have questions about contributing.
