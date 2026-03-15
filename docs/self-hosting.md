# Self-Hosting OpenViktor

## Quick Start (5 minutes)

### Prerequisites

- Docker and Docker Compose
- A Slack workspace (admin permissions)
- An Anthropic API key

### 1. Create Slack App (one-click)

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From an app manifest**
3. Select your workspace
4. Paste the contents of `slack-app-manifest.yml` from this repo
5. Click **Create**
6. Go to **Install App** and install to your workspace

### 2. Collect Credentials

| Credential | Where to find it |
|------------|-----------------|
| Bot Token (`xoxb-...`) | **OAuth & Permissions** > Bot User OAuth Token |
| App Token (`xapp-...`) | **Basic Information** > App-Level Tokens > Generate (scope: `connections:write`) |
| Signing Secret | **Basic Information** > App Credentials > Signing Secret |

### 3. Run Setup

```bash
git clone https://github.com/zggf-zggf/openviktor.git
cd openviktor

# Interactive setup wizard
bun run setup

# Or manually create .env and start
docker compose -f docker/docker-compose.selfhosted.yml up -d
```

### 4. Verify

1. Go to your Slack workspace
2. Invite the bot: `/invite @OpenViktor`
3. Mention: `@OpenViktor hello!`
4. The bot should reply within seconds

---

## Full Setup (detailed)

### Create a Slack App Manually

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Name it "OpenViktor" and select your workspace

#### Enable Socket Mode

1. Go to **Settings > Socket Mode** and enable it
2. Generate an **App-Level Token** with `connections:write` scope
3. Save the token (starts with `xapp-`)

#### Configure Bot Permissions

Go to **OAuth & Permissions > Scopes > Bot Token Scopes** and add:

- `app_mentions:read` — receive @mention events
- `channels:history` — read channel messages
- `channels:read` — list channels
- `chat:write` — send messages
- `files:read` — read file uploads
- `files:write` — upload files
- `groups:history` — read private channel messages
- `groups:read` — list private channels
- `im:history` — read DMs
- `im:read` — list DMs
- `im:write` — open DMs
- `reactions:read` — read reactions
- `reactions:write` — add emoji reactions
- `users:read` — read user info
- `team:read` — read workspace info

#### Enable Events

Go to **Event Subscriptions** and enable:

- `app_mention` — when someone @mentions the bot
- `message.im` — when someone DMs the bot

#### Enable Direct Messages

1. Go to **App Home** > **Show Tabs**
2. Enable **Messages Tab**
3. Check **Allow users to send Slash commands and messages from the messages tab**

#### Install to Workspace

1. Go to **Install App** and click **Install to Workspace**
2. Authorize the app
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
4. Go to **Basic Information** and copy the **Signing Secret**

### Environment Configuration

```bash
cp docker/.env.example .env
```

Required variables:

```env
# Deployment
DEPLOYMENT_MODE=selfhosted

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# Dashboard
DASHBOARD_PASSWORD=your-secure-password
```

Optional variables:

```env
OPENAI_API_KEY=sk-...           # For OpenAI model access
GOOGLE_AI_API_KEY=...           # For Google AI model access
GITHUB_TOKEN=ghp_...            # For GitHub integration tools
LOG_LEVEL=info                  # debug, info, warn, error
ENABLE_DASHBOARD=true           # Set to false to disable dashboard
```

### Deploy

```bash
docker compose -f docker/docker-compose.selfhosted.yml up -d
```

Check logs:
```bash
docker compose -f docker/docker-compose.selfhosted.yml logs -f bot
```

### Dashboard Access

The dashboard is available at `http://your-server:3001`.

- **Username**: `admin` (configurable via `DASHBOARD_USERNAME`)
- **Password**: set via `DASHBOARD_PASSWORD`

---

## Hardware Requirements

| Usage | CPU | RAM | Storage |
|-------|-----|-----|---------|
| Light (< 5 conversations/day) | 1 core | 1 GB | 5 GB |
| Medium (5-50 conversations/day) | 2 cores | 2 GB | 10 GB |
| Heavy (50+ conversations/day) | 4 cores | 4 GB | 20 GB |

---

## Updating

```bash
cd openviktor
git pull
docker compose -f docker/docker-compose.selfhosted.yml up -d --build
```

Database migrations run automatically on startup.

---

## Backup & Restore

### Backup

```bash
# Backup PostgreSQL
docker compose -f docker/docker-compose.selfhosted.yml exec postgres \
  pg_dump -U openviktor openviktor > backup_$(date +%Y%m%d).sql

# Backup .env
cp .env .env.backup
```

### Restore

```bash
# Stop services
docker compose -f docker/docker-compose.selfhosted.yml down

# Restore database
docker compose -f docker/docker-compose.selfhosted.yml up -d postgres
docker compose -f docker/docker-compose.selfhosted.yml exec -T postgres \
  psql -U openviktor openviktor < backup_20260315.sql

# Start all services
docker compose -f docker/docker-compose.selfhosted.yml up -d
```

---

## Troubleshooting

### Bot not responding

1. Check logs: `docker compose -f docker/docker-compose.selfhosted.yml logs bot`
2. Verify Slack tokens in `.env`
3. Ensure the bot is invited to the channel
4. Confirm Socket Mode is enabled in Slack app settings

### Database connection errors

1. Verify PostgreSQL is running: `docker compose -f docker/docker-compose.selfhosted.yml ps`
2. Check `DATABASE_URL` in `.env`

### LLM errors

1. Verify `ANTHROPIC_API_KEY` is valid
2. Check API usage limits at [console.anthropic.com](https://console.anthropic.com)

### Dashboard login issues

1. Verify `DASHBOARD_PASSWORD` is set in `.env`
2. Clear browser cookies and try again
3. Check bot logs for auth errors

### Health check

```bash
curl http://localhost:3001/api/health
```

Returns deployment status, connected workspaces, and database health.
