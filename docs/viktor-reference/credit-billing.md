# Credit & Billing System

![architecture-10](diagrams/architecture-10.svg)

---

## Five-Layer Cost Control

1. **Plan caps** — monthly credit allocation
2. **Cron frequency** — schedule expressions, work-hours-only, 6x/day soft limit
3. **Condition scripts** — pre-execution Python gate (exit 0 = run, non-zero = skip)
4. **Execution type** — script_cron (free) vs agent_cron (expensive)
5. **Model selection** — Opus ($$$) vs Sonnet ($$) vs Gemini Flash ($)

---

## API Reference — Cost-Relevant Tools

These tools have explicit cost implications visible in their API responses.

**Source:** `sdk/tools/utils_tools.py`

### `ai_structured_output`

Call an AI model for structured JSON extraction. Three intelligence tiers at different cost levels.

```json
{
  "role": "ai_structured_output",
  "arguments": {
    "prompt": "Extract the company name, role, and start date from this text",
    "output_schema": {
      "type": "object",
      "properties": {
        "company": {"type": "string"},
        "role": {"type": "string"},
        "start_date": {"type": "string"}
      },
      "required": ["company", "role"]
    },
    "input_text": "I joined Acme Corp as a Senior Engineer in January 2024",
    "intelligence_level": "fast"
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Instructions for extraction/generation |
| `output_schema` | `dict` | Yes | JSON Schema defining expected output structure |
| `input_text` | `string` | No | Text to analyze |
| `intelligence_level` | `string` | No | `"fast"` (Gemini Flash Lite — cheap, no thinking), `"balanced"` (Gemini Flash 3), `"smart"` (Gemini Flash 3 + thinking) |

**Response:**

```json
{"result": {"result": {"company": "Acme Corp", "role": "Senior Engineer", "start_date": "2024-01"}, "error": null}}
```

### `coworker_text2im`

Generate images from prompts. Response includes USD cost estimate for billing tracking.

```json
{
  "role": "coworker_text2im",
  "arguments": {
    "prompt": "Modern SaaS dashboard with warm orange #fe871e accents on light gray #f8f9f8 background",
    "image_paths": null,
    "aspect_ratio": "16:9"
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | `string` | Yes | Image description |
| `image_paths` | `list[string]` | No | Local images to edit (if provided, prompt edits these instead) |
| `aspect_ratio` | `string` | No | `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:2"`, `"21:9"`, etc. |

**Response:**

```json
{
  "result": {
    "response_text": "Image generated successfully",
    "image_url": "https://cdn.getviktor.com/images/abc123.png",
    "file_uri": "viktor://images/abc123.png",
    "local_path": "/work/temp/generated_abc123.png",
    "error": null,
    "usd_cost_estimate": 0.04
  }
}
```

### `quick_ai_search`

One Google search + top ~3 results summarized. Lightweight alternative to browser automation.

```json
{"role": "quick_ai_search", "arguments": {"search_question": "Viktor AI coworker pricing 2026"}}
```

**Response:**

```json
{"result": {"search_response": "Based on search results:\n- Viktor offers credit-based pricing starting at...\n- Sources: [getviktor.com](...)..."}}
```

### `create_custom_api_integration`

Register a custom REST API with the platform. Returns a secure credential form link for the user.

```json
{
  "role": "create_custom_api_integration",
  "arguments": {
    "name": "Internal CRM",
    "base_url": "https://api.internal-crm.com/v2",
    "auth_config": {"type": "bearer", "token_field_label": "API Key"},
    "methods": ["GET", "POST"],
    "docs_url": "https://docs.internal-crm.com"
  }
}
```

**Response:**

```json
{
  "result": {
    "integration_id": "int_abc123",
    "service_name": "internal-crm",
    "connect_url": "https://app.getviktor.com/integrations/internal-crm?team=xxx",
    "status": "pending_credentials",
    "expires_at": "2026-03-13T14:00:00Z"
  }
}
```

---

*Sources: `sdk/tools/utils_tools.py`, `skills/viktor_account/SKILL.md`, `skills/viktor_account/references/plans.md`, [Viktor blog](https://getviktor.com/blog/how-to-optimize-viktor-credits)*
