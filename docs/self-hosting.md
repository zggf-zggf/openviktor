# Self-Hosting OpenViktor

This guide walks you through setting up OpenViktor on your own infrastructure.

## Prerequisites

- A server with Docker and Docker Compose installed
- A Slack workspace where you have admin permissions
- An Anthropic API key

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch** and name it "OpenViktor" (or your preferred name)
3. Select your workspace

### Enable Socket Mode

1. Go to **Settings → Socket Mode** and enable it
2. Generate an **App-Level Token** with `connections:write` scope
3. Save the token (starts with `xapp-`)

### Configure Bot Permissions

Go to **OAuth & Permissions → Scopes → Bot Token Scopes** and add:

- `app_mentions:read` — receive @mention events
- `channels:history` — read channel messages
- `channels:read` — list channels
- `chat:write` — send messages
- `groups:history` — read private channel messages
- `groups:read` — list private channels
- `im:history` — read DMs
- `im:read` — list DMs
- `im:write` — open DMs
- `reactions:write` — add emoji reactions
- `users:read` — read user info

### Enable Events

Go to **Event Subscriptions** and enable:

- `app_mention` — when someone @mentions the bot
- `message.im` — when someone DMs the bot

### Enable Direct Messages

1. Go to **App Home** (in the sidebar under Features)
2. Scroll to **Show Tabs** and enable **Messages Tab**
3. Check **Allow users to send Slash commands and messages from the messages tab**

### Install to Workspace

1. Go to **Install App** (in the sidebar under Settings — this is its own page, not inside OAuth & Permissions)
2. Click **Install to Workspace** and authorize the app
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
4. Go to **Basic Information** (sidebar) and copy the **Signing Secret**

## 2. Deploy with Docker Compose

```bash
# Clone the repo
git clone https://github.com/zggf-zggf/openviktor.git
cd openviktor

# Copy and edit environment variables
cp docker/.env.example .env

# Edit .env with your credentials:
# - SLACK_BOT_TOKEN=xoxb-...
# - SLACK_APP_TOKEN=xapp-...
# - SLACK_SIGNING_SECRET=...
# - ANTHROPIC_API_KEY=sk-ant-...

# Build and start all services (postgres, redis, bot)
docker compose -f docker/docker-compose.yml up -d --build

# Check bot logs (structured JSON)
docker compose -f docker/docker-compose.yml logs -f bot
```

## 3. Verify

The bot connects to Slack via Socket Mode — no public URL or port forwarding needed. It starts automatically with `docker compose up`.

1. Go to your Slack workspace
2. Invite the bot to a channel: `/invite @OpenViktor`
3. Mention the bot: `@OpenViktor hello!`
4. The bot should reply in the thread within a few seconds with an AI-generated response
5. Send a DM to the bot — it should reply in conversation
6. Check structured JSON logs: `docker compose -f docker/docker-compose.yml logs -f bot`
7. You should see agent run entries with `status: "COMPLETED"`, token counts, and cost

## Hardware Requirements

| Usage | CPU | RAM | Storage |
|-------|-----|-----|---------|
| Light (< 5 conversations) | 1 core | 1 GB | 5 GB |
| Medium (5-50 conversations) | 2 cores | 2 GB | 10 GB |
| Heavy (50+ conversations) | 4 cores | 4 GB | 20 GB |

## Updating

```bash
cd openviktor
git pull
docker compose -f docker/docker-compose.yml pull
docker compose -f docker/docker-compose.yml up -d
```

Database migrations run automatically on startup.

## Troubleshooting

### Bot not responding

1. Check logs: `docker compose -f docker/docker-compose.yml logs bot`
2. Verify Slack tokens are correct in `.env`
3. Ensure the bot is invited to the channel
4. Check that Socket Mode is enabled in Slack app settings

### Database connection errors

1. Verify PostgreSQL is running: `docker compose -f docker/docker-compose.yml ps`
2. Check `DATABASE_URL` in `.env` matches the PostgreSQL credentials

### LLM errors

1. Verify `ANTHROPIC_API_KEY` is valid
2. Check your API usage limits at [console.anthropic.com](https://console.anthropic.com)
