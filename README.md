<p align="center">
  <img src="docs/assets/banner.svg" alt="OpenViktor — Open-source AI coworker for Slack" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/zggf-zggf/openviktor/actions/workflows/ci.yml"><img src="https://github.com/zggf-zggf/openviktor/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/zggf-zggf/openviktor?color=6366f1" alt="MIT License"></a>
  <a href="https://github.com/zggf-zggf/openviktor/issues"><img src="https://img.shields.io/github/issues/zggf-zggf/openviktor?color=8b5cf6" alt="Issues"></a>
  <a href="https://github.com/zggf-zggf/openviktor/stargazers"><img src="https://img.shields.io/github/stars/zggf-zggf/openviktor?style=flat&color=6366f1" alt="Stars"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9a8d4" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript Strict">
  <img src="https://img.shields.io/badge/self--hosted-Docker%20Compose-2496ed?logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  An autonomous AI agent that lives in your Slack workspace as a team member.<br/>
  Open-source alternative to <a href="https://getviktor.com">getviktor.com</a> — self-hostable, extensible, MIT-licensed.
</p>

---

## Features

- **Conversational AI** — responds to mentions and DMs with contextually relevant, LLM-powered messages
- **Persistent Memory** — learns from your team's interactions and accumulates knowledge over time
- **Tool Execution** — extensible tool system with native tools and MCP protocol support
- **Proactive Monitoring** — scheduled heartbeats, cron jobs, and workflow discovery
- **Integrations** — connects to GitHub, Linear, and other tools your team already uses
- **Self-Hosted** — runs on your infrastructure with Docker Compose, no vendor lock-in

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.2
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [Slack app](https://api.slack.com/apps) with Socket Mode enabled
- An [Anthropic API key](https://console.anthropic.com/)

### One-Command Setup

```bash
git clone https://github.com/zggf-zggf/openviktor.git
cd openviktor
./scripts/setup.sh
```

<details>
<summary><strong>Manual setup</strong></summary>

```bash
bun install
cp docker/.env.example .env
# Edit .env with your Slack and Anthropic credentials
docker compose -f docker/docker-compose.yml up -d
bun run db:generate
bun run db:migrate
bun run dev
```

</details>

> For production deployment, see [Self-Hosting Guide](docs/self-hosting.md).

## Architecture

```
openviktor/
├── apps/
│   ├── bot/              # Slack bot + agent runtime
│   └── web/              # Admin dashboard (Phase 12)
├── packages/
│   ├── db/               # PostgreSQL schema (Prisma)
│   ├── shared/           # Types, config, logger, errors
│   ├── tools/            # Tool registry + executors
│   └── integrations/     # External service clients
└── docker/               # Docker Compose for self-hosting
```

### Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | **Bun** | Fast, native TS, workspace support |
| Language | **TypeScript** (strict) | Type safety across the stack |
| Database | **PostgreSQL 16** + Prisma | Self-hostable, no vendor lock-in |
| Cache | **Redis 7** (optional) | Concurrency control, rate limiting |
| LLM | **Claude** primary | GPT and Gemini as future fallbacks |
| Slack | **Bolt SDK** (Socket Mode) | No public URL needed |
| Build | **Turborepo** | Cached parallel builds |
| Lint | **Biome** | Fast, opinionated, single tool |
| Test | **Vitest** + Playwright | Unit/integration + E2E |
| Deploy | **Docker Compose** | Single command self-hosting |

## Development

```bash
bun install                # Install dependencies
docker compose -f docker/docker-compose.yml up -d  # Start PostgreSQL + Redis
bun run db:generate        # Generate Prisma client
bun run db:migrate         # Run migrations
bun run dev                # Start dev server
bun run test               # Run tests
bun run lint               # Lint with Biome
bun run typecheck          # TypeScript strict check
```

## Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Repository foundation — monorepo, CI, tooling | ✅ Done |
| 1 | Slack Gateway — receive & log events | ✅ Done |
| 2 | Tool registry & executors | Planned |
| 3 | Memory & knowledge persistence | Planned |
| 4 | GitHub integration | Planned |
| 5 | Linear integration | Planned |
| 6 | Heartbeat & proactive monitoring | Planned |
| 7 | Admin dashboard | Planned |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Every implementation change is cross-validated against our [Viktor reverse-engineering docs](docs/viktor-reference/) to ensure behavioral fidelity.

## License

[MIT](LICENSE) — use it however you want.
