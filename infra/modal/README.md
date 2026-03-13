# Modal.com Tool Backend

Optional deployment backend that runs tool execution on [Modal.com](https://modal.com) containers.

## Architecture

When `TOOL_BACKEND=modal`, the bot delegates tool execution to a Modal web endpoint instead of running tools in-process. Each tool call is handled by an isolated container with a persistent workspace volume mounted at `/data/workspaces`.

```text
Bot (Slack + Agent loop) → Tool Gateway → ModalToolBackend → HTTP → Modal Web Endpoint → Python tool executors
```

## Setup

1. Install Modal CLI:
   ```bash
   pip install -r requirements.txt
   modal token new
   ```

2. Create a Modal secret with your tool auth token:
   ```bash
   modal secret create openviktor-tools TOOL_TOKEN=your-secret-token
   ```

3. Deploy the app:
   ```bash
   modal deploy infra/modal/app.py
   ```

4. Configure the bot:
   ```bash
   TOOL_BACKEND=modal
   MODAL_ENDPOINT_URL=https://your-workspace--openviktor-tools-execute.modal.run
   MODAL_AUTH_TOKEN=your-secret-token
   ```

## Local Development

For local development, use `TOOL_BACKEND=local` (the default). The Modal backend is only needed for production deployments that require container isolation per tool call.
