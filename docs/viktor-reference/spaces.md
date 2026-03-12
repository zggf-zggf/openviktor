# Viktor Spaces

Reverse-engineered from backup archive: SDK source (`viktor_spaces_tools.py`), SKILL.md (`skills/viktor_spaces_dev/`), a live app (`neonrain-hooks`), agent run transcripts, and global logs.

---

## Overview

**Viktor Spaces** is Viktor's full-stack app hosting platform. It allows the agent to create, develop, test, and deploy complete web applications — all from within a Slack conversation. Each app gets a real-time database, authentication, frontend hosting, and a custom subdomain on `*.viktor.space`.

This is not a toy feature — the apps are production-grade, with separate dev/prod environments, email-based auth with OTP verification, 53 pre-installed UI components, and E2E testing built in.

![spaces-01](diagrams/spaces-01.svg)

---

## Architecture

### Tech Stack (per app)

| Layer | Technology | Details |
|-------|-----------|---------|
| **Backend** | [Convex](https://convex.dev) | Real-time database, queries, mutations, actions, ACID transactions, scheduled functions, HTTP endpoints |
| **Frontend** | React 19 + Vite 7 | TypeScript, Tailwind CSS v4, 53 shadcn/ui components |
| **Auth** | Convex Auth | Email/password with OTP verification, password reset |
| **Hosting** | Vercel | Static builds, SPA rewrites, preview + production deploys |
| **Domain** | `*.viktor.space` | Format: `{project}-{id}.viktor.space` (e.g., `neonrain-hooks-65437c51.viktor.space`) |
| **Package Manager** | Bun | Fast installs and runtime |
| **Linting** | Biome | Replaces ESLint + Prettier |
| **Testing** | Playwright | E2E tests with auto-login test user |

### Environment Separation

Each app gets **two completely isolated Convex deployments**:

![spaces-02](diagrams/spaces-02.svg)

- **Preview** uses the dev Convex database — data persists between preview deploys
- **Production** uses the prod Convex database — completely isolated from dev
- Preview deployments show a "Continue as Test User" button for quick testing

---

## SDK Tools (6 total)

All tool calls route through the standard Tool Gateway (`POST /v1/tools/call`).

![spaces-03](diagrams/spaces-03.svg)

### Tool Signatures

```python
# Create a new app (takes 2-3 min)
init_app_project(
    project_name: str,           # lowercase, alphanumeric, hyphens
    description: str | None
) -> {success, project_name, sandbox_path, convex_url_dev, convex_url_prod}

# Deploy to preview or production
deploy_app(
    project_name: str,
    environment: "preview" | "production",
    commit_message: str | None   # auto-generated if omitted
) -> {success, environment, url, vercel_url, convex_deployment}

# List all apps
list_apps() -> {apps: [{preview_url, production_url, ...}]}

# Get app status
get_app_status(project_name: str) -> {
    project_name, sandbox_path,
    convex_url_dev, convex_url_prod,
    preview_url, production_url,
    last_deployed_at
}

# Query app database (dev or prod)
query_app_database(
    project_name: str,
    function_name: str,          # e.g., "users:list"
    args: dict | None,
    environment: "dev" | "prod"
) -> {success, data}

# Delete app and all resources
delete_app_project(project_name: str) -> {success, deleted_resources}
```

---

## Viktor Spaces API

The platform exposes a dedicated API that **apps call back into** — separate from the main Tool Gateway. This enables deployed Convex apps to use Viktor's tools (AI search, image generation, Slack messaging, etc.) at runtime.

![spaces-04](diagrams/spaces-04.svg)

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/viktor-spaces/tools/call` | POST | Proxy any Viktor SDK tool from a deployed app |
| `/api/viktor-spaces/send-email` | POST | Send OTP/verification emails (rate-limited: 100/hour/project) |

### Authentication

Each app gets three environment variables set automatically during `init_app_project`:

```typescript
VIKTOR_SPACES_API_URL    // Viktor API base URL
VIKTOR_SPACES_PROJECT_NAME    // Project identifier
VIKTOR_SPACES_PROJECT_SECRET  // Per-project auth token
```

### Wire Protocol (Tools Proxy)

```typescript
// From Convex action → Viktor Spaces API
POST {VIKTOR_SPACES_API_URL}/api/viktor-spaces/tools/call
Content-Type: application/json

{
  "project_name": "neonrain-hooks",
  "project_secret": "secret_...",
  "role": "quick_ai_search",           // Any Viktor SDK tool
  "arguments": { "search_question": "..." }
}

// Response
{ "success": true, "result": { "search_response": "..." } }
// or
{ "success": false, "error": "..." }
```

### Email Service

```typescript
// OTP email sending
POST {VIKTOR_SPACES_API_URL}/api/viktor-spaces/send-email
Content-Type: application/json

{
  "project_name": "neonrain-hooks",
  "project_secret": "secret_...",
  "to_email": "user@example.com",
  "subject": "Verify your email - My App",
  "html_content": "<div>...</div>",
  "text_content": "Your code is: 123456",
  "email_type": "otp"
}
```

Rate limit: **100 emails/hour per project**. Uses Resend on the backend.

---

## App Template

When `init_app_project` runs, it clones a pre-configured template into `/work/viktor-spaces/{project_name}/`:

![spaces-05](diagrams/spaces-05.svg)

### Pre-installed Components (53 shadcn/ui)

Accordion, Alert, Alert Dialog, Aspect Ratio, Avatar, Badge, Breadcrumb, Button, Button Group, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Command, Context Menu, Dialog, Drawer, Dropdown Menu, Empty, Field, Form, Hover Card, Input, Input Group, Input OTP, Item, Kbd, Label, Menubar, Navigation Menu, Pagination, Popover, Progress, Radio Group, Resizable, Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner (toasts), Spinner, Switch, Table, Tabs, Textarea, Toggle, Toggle Group, Tooltip.

### Auth Flows

![spaces-06](diagrams/spaces-06.svg)

OTP codes expire after **15 minutes**. Emails sent via Viktor Spaces API → Resend.

---

## Development Workflow

The SKILL.md prescribes a **10-step development workflow** that the agent follows:

![spaces-07](diagrams/spaces-07.svg)

### Agent Build Commands

| Command | Purpose |
|---------|---------|
| `bun run sync` | Push Convex functions once (no watching) |
| `bun run sync:build` | Push Convex + build frontend |
| `bun run test scripts/test.ts` | Start Vite preview, run Playwright test, stop server |
| `bun run screenshot [path] [name]` | Capture page screenshot |
| `bun run logs:fetch` | Fetch recent Convex backend logs |
| `bun run check` | Lint with Biome |

### Test User (built-in)

| Field | Value |
|-------|-------|
| Email | `agent@test.local` |
| Password | `TestAgent123!` |

Playwright tests use `runTest()` which auto-logs in as the test user and provides helpers for navigation, screenshots, and debug info on failure.

---

## Real-World Example: neonrain-hooks

The only Spaces app found in the backup is **neonrain-hooks** — a GitHub PR merge → Slack notification pipeline built on 2026-03-12.

### What It Does

1. Receives GitHub PR merge events via Convex HTTP endpoint
2. Generates a business-friendly summary (strips technical jargon)
3. Creates a branded illustration using Viktor's `text2im` tool
4. Posts the update to Slack `#all-humalike` with the image

![spaces-08](diagrams/spaces-08.svg)

### Key Details

| Property | Value |
|----------|-------|
| Project name | `neonrain-hooks` |
| Production URL | `https://neonrain-hooks-65437c51.viktor.space` |
| Vercel URL | `https://app-neonrain-hooks-q4ui8k162-viktorspaces.vercel.app` |
| Dev Convex | `https://uncommon-dotterel-337.convex.cloud` |
| Prod Convex | `https://third-corgi-353.convex.cloud` |
| GitHub repo | `Humalike/neonrain` |
| Target Slack channel | `#all-humalike` (`C0AEKVD4QP9`) |

### Evolution During Build

The agent's approach evolved during the conversation:

1. **First attempt**: Cron-based (`*/20 * * * *`) polling for new PRs with condition script
2. **Problem**: 20-minute delay, wasteful credit usage
3. **Pivot**: Event-driven via GitHub webhook → Convex HTTP endpoint → Viktor Spaces app
4. **Problem**: GitHub App lacked admin permission to create webhooks via API
5. **Solution**: Agent created a GitHub Action (`.github/workflows/pr-notify.yml`) that `curl`s the Convex endpoint on PR close

The cron `/neonrain/pr-updates` was created and deleted within 12 minutes as the agent iterated.

### Branding System

The app includes a prompt-engineering system for image generation that maps PR topics to branded visual concepts:

| PR Topic | Visual Concept |
|----------|---------------|
| docker, deploy, CI/CD | Cloud deployment with containers and rocket |
| search, autocomplete | Smart search with AI sparkle effects |
| analytics, dashboard | Floating chart cards with data visualization |
| security, proxy | Shield icon with rotating refresh symbol |
| data, pipeline, BigQuery | Flowing data blocks through pipeline |
| discord, chat, message | Modern chat bubbles with AI assistant |
| monitoring, traces, logs | Dashboard with heartbeat lines and status indicators |
| Default | Package opening with light rays and UI elements |

All images use: warm orange `#fe871e` accent, light gray `#f8f9f8` background, clean minimal SaaS style.

---

## Domain System

```
Format:  {project_name}-{hex_id}.viktor.space
Example: neonrain-hooks-65437c51.viktor.space

Preview: preview-{project_name}-{hex_id}.viktor.space
```

- `{hex_id}` is auto-generated (8 hex chars)
- Preview deployments have a `preview-` prefix
- Vercel handles the actual hosting; `*.viktor.space` is a custom domain mapping
- The Vercel URL is also accessible: `app-{project}-{hash}-viktorspaces.vercel.app`

---

## Security Model

### App-Level Authentication

- Each app gets its own `VIKTOR_SPACES_PROJECT_SECRET` — never exposed to the frontend
- The secret is stored as a Convex environment variable (server-side only)
- All Viktor API calls are authenticated with `{project_name, project_secret}`

### User-Level Authentication

- Email/password with OTP verification (6-digit code, 15-minute expiry)
- JWT signing with RSA private key (`AUTH_PRIVATE_KEY`)
- Test user available in preview mode only (`VITE_IS_PREVIEW=true`)
- Domain restriction support for internal apps (whitelist Slack email domains)

### Email Rate Limiting

- 100 emails per hour per project (enforced server-side)
- Emails sent from project-specific addresses via Resend

---

## Key Numbers

| Metric | Value |
|--------|-------|
| SDK tools | 6 (`init_app_project`, `deploy_app`, `list_apps`, `get_app_status`, `query_app_database`, `delete_app_project`) |
| Template components | 53 (shadcn/ui) |
| Init time | ~30 seconds (observed: 29s for neonrain-hooks) |
| Deploy time | ~27 seconds (observed: from tool call to response) |
| Frontend build | ~3.7 seconds (Vite, 1,911 modules) |
| Bundle size | 544 KB JS + 128 KB CSS (gzipped: 165 KB + 19 KB) |
| Email rate limit | 100/hour/project |
| OTP expiry | 15 minutes |
| Vercel organization | `viktorspaces` |

---

## API Reference — Spaces Tools

All Spaces tools route through the Tool Gateway: `POST {TOOL_GATEWAY_URL}/call`.

**Source:** `sdk/tools/viktor_spaces_tools.py`

### `init_app_project`

Creates a new app with Convex backend + Vercel hosting. Clones template, provisions databases, sets environment variables. Takes ~30 seconds.

```json
{
  "role": "init_app_project",
  "arguments": {
    "project_name": "neonrain-hooks",
    "description": "GitHub PR merge notifications for Slack"
  }
}
```

**Response:**

```json
{
  "result": {
    "success": true,
    "project_name": "neonrain-hooks",
    "sandbox_path": "/work/viktor-spaces/neonrain-hooks",
    "convex_url_dev": "https://uncommon-dotterel-337.convex.cloud",
    "convex_url_prod": "https://third-corgi-353.convex.cloud",
    "error": null
  }
}
```

### `deploy_app`

Deploy to preview (dev database) or production (prod database). Takes ~27 seconds.

```json
{
  "role": "deploy_app",
  "arguments": {
    "project_name": "neonrain-hooks",
    "environment": "production",
    "commit_message": "Add PR notification webhook handler"
  }
}
```

**Response:**

```json
{
  "result": {
    "success": true,
    "environment": "production",
    "url": "https://neonrain-hooks-65437c51.viktor.space",
    "vercel_url": "https://app-neonrain-hooks-q4ui8k162-viktorspaces.vercel.app",
    "convex_deployment": "third-corgi-353",
    "error": null
  }
}
```

### `list_apps`

```json
{"role": "list_apps", "arguments": {}}
```

**Response:**

```json
{
  "result": {
    "apps": [
      {
        "project_name": "neonrain-hooks",
        "preview_url": "https://preview-neonrain-hooks-65437c51.viktor.space",
        "production_url": "https://neonrain-hooks-65437c51.viktor.space"
      }
    ]
  }
}
```

### `get_app_status`

```json
{"role": "get_app_status", "arguments": {"project_name": "neonrain-hooks"}}
```

**Response:**

```json
{
  "result": {
    "project_name": "neonrain-hooks",
    "sandbox_path": "/work/viktor-spaces/neonrain-hooks",
    "convex_url_dev": "https://uncommon-dotterel-337.convex.cloud",
    "convex_url_prod": "https://third-corgi-353.convex.cloud",
    "preview_url": "https://preview-neonrain-hooks-65437c51.viktor.space",
    "production_url": "https://neonrain-hooks-65437c51.viktor.space",
    "last_deployed_at": "2026-03-12T15:42:00Z"
  }
}
```

### `query_app_database`

Query Convex database functions against dev or prod.

```json
{
  "role": "query_app_database",
  "arguments": {
    "project_name": "neonrain-hooks",
    "function_name": "notifications:list",
    "args": {"limit": 10},
    "environment": "prod"
  }
}
```

**Response:**

```json
{"result": {"success": true, "data": [{"_id": "...", "repo": "Humalike/neonrain", "title": "..."}]}}
```

### `delete_app_project`

Deletes app and all resources (Convex deployments, Vercel project, sandbox files).

```json
{"role": "delete_app_project", "arguments": {"project_name": "neonrain-hooks"}}
```

**Response:**

```json
{"result": {"success": true, "project_name": "neonrain-hooks", "deleted_resources": ["convex_dev", "convex_prod", "vercel_project", "sandbox_files"]}}
```

---

*Sources: `sdk/tools/viktor_spaces_tools.py`, `skills/viktor_spaces_dev/SKILL.md`, `viktor-spaces/neonrain-hooks/` (full app source), agent run transcript `1773311095_838109` (566 messages), global log `2026-03-12`*
