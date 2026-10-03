# DashView AI Service (Python)

FastAPI service that turns the dashboard's AI Assistant into a real **Odoo-aware agent**:

```
ai.html ──►  /v1/chat  ──►  model router ──►  Claude / GPT / Grok / Groq / Gemini
                │                                   │  (tool calls)
                │                                   ▼
                └──────────── guard ◄──── Odoo tools ──► Odoo JSON-RPC (read-only)
```

The model doesn't get a pre-stuffed text dump of Odoo rows (what the browser-side
`ai-company-context.js` did). It **asks Odoo questions itself** — schema lookup,
`read_group` totals, filtered searches, a KPI snapshot — and answers only from what came back.
Roman Urdu / Urdu / English questions are answered in the language they were asked.

## What's inside

| Area | Detail |
|---|---|
| Models | Anthropic (native) + one adapter for every OpenAI-compatible API (OpenAI, xAI Grok, Groq, Gemini). Tiers `fast` / `smart` / `deep`; `auto` picks by question complexity; automatic **fail-over** to the next configured model. Catalog is editable (`MODEL_CATALOG_FILE`). |
| Odoo tools | `odoo_metric` (verified KPIs), `odoo_installed_apps`, `odoo_business_snapshot`, `odoo_list_models`, `odoo_get_fields`, `odoo_search_read`, `odoo_count`, `odoo_aggregate`, `odoo_get_record` |
| Safety | Read-only by construction (only `search_read/search_count/read/read_group/fields_get/name_search` can be sent). Security/infra models (`res.users`, `ir.*`, payment, mail…) blocked; secret-looking fields hidden; domains/groupby/order strictly validated; row caps; prompt-injection rule in the system prompt. Optional hard allow-list `ODOO_ALLOWED_MODELS`. |
| Scale | Async end-to-end, shared HTTP pool, bounded in-flight chats, per-host Odoo concurrency with bounded queue wait, result + schema + uid caching, optional Redis (shared across replicas), rate limit per user, stateless → add replicas freely. |
| Auth | Accepts the same JWT the Node `server/` issues (`JWT_SECRET`, HS256; role must be in `ALLOWED_ROLES`) or `X-API-Key`. |
| API | `POST /v1/chat` (SSE stream by default, `"stream": false` for JSON), `GET /v1/models`, `GET /v1/metrics`, `POST /v1/feedback`, `POST /v1/odoo/test`, `GET /health` |

## Run locally

```bash
cd ai-service
cp .env.example .env        # fill ODOO_* and at least one LLM key
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Docker (with Redis): `docker compose up --build`.
Tests (no network or keys needed): `pip install -r requirements-dev.txt && pytest -q`

`MAX_CHAT_CONCURRENCY` bounds active chat generations per worker (`32` by default);
requests that cannot enter within `CHAT_QUEUE_TIMEOUT_S` (`0.05` seconds) receive
HTTP 503 with `Retry-After`. Odoo calls are independently capped per host and
return a retryable 503 after `ODOO_QUEUE_TIMEOUT_S` (`2` seconds) waiting for a
slot. Keep worker/process counts in mind: these limits are per process, not
cluster-wide. Request and response `X-Request-ID` values are logged and included
in chat JSON/SSE events for correlation.

Chat input is capped at 40 messages, 8,000 characters per message and 32,000
combined characters. Odoo row limits are bounded by `MAX_ROWS` (1,000 maximum);
search, aggregate and metric report tools accept an `offset` (maximum 100,000)
and return page-boundary metadata (`has_more` / `next_offset` or their
`groups_*` equivalents). Aggregate reports include full-domain `records` and
`totals`; metric `total` and `records` remain server-side aggregates across the
full matching set, independent of the displayed group page.

## Connect the dashboard

1. Deploy `ai-service/` anywhere that runs Docker (Render, Railway, Fly.io, a VPS) behind HTTPS.
2. In `.env` set `CORS_ORIGINS` to your dashboard origin (e.g. `https://YOU.github.io`) and the same `JWT_SECRET` as `server/.env`.
3. Dashboard → **Settings → AI Assistant** → Provider **DashView AI** → paste the backend URL → Save.

No LLM key and no Odoo key ever reaches the browser in this mode.

## Odoo credentials: two modes

* **Server-side (recommended):** `ODOO_URL/DB/USERNAME/API_KEY` in `.env`. Create a dedicated **read-only Odoo user** for it — the guard is a second line of defence, Odoo's own access rights should be the first.
* **Per request (like the Cloudflare Worker):** set `ODOO_ALLOW_CLIENT_CREDENTIALS=true` and **also** `ODOO_ALLOWED_HOSTS`. Without an allow-list the service refuses private/loopback addresses (SSRF guard), but DNS-rebinding can't be fully excluded, so use the allow-list in production.

## Example SSE stream

```
event: model        data: {"model":"claude-sonnet-5","provider":"anthropic"}
event: tool_start   data: {"name":"odoo_aggregate","args":{"model":"sale.order","groupby":["partner_id"],...}}
event: tool_result  data: {"name":"odoo_aggregate","summary":"5 groups"}
event: final        data: {"text":"Top customers this month: ...","usage":{...}}
event: done         data: {}
```

## Accuracy: how it is kept correct (and how to improve it)

A hosted LLM can't be "trained" on your database in any useful way — Odoo data changes every minute and fine-tuning
would only memorise old numbers. Accuracy comes from grounding, so that is what this service does:

1. **Verified metrics (semantic layer)** — `app/odoo/metrics.py`. Sales, invoiced revenue, receivables/overdue, payables,
   purchases, CRM pipeline, stock, headcount, new customers each have ONE fixed definition (model, states, date field,
   sign, currency). The model calls `odoo_metric` instead of improvising domains. **Edit or add your own definitions in
   `knowledge/metrics.json`** (`METRICS_FILE`) — see `knowledge/metrics.example.json`.
2. **Server-side dates** — "this month / last quarter / YTD" are resolved in `TIMEZONE`, weeks start Monday, datetimes are
   converted to UTC boundaries. The model never does date maths.
3. **Server-side totals** — `total` covers all records even when only the top N groups are shown; nothing is summed from samples.
4. **Prompt rules** — must state definition + exact period + currency, cross-check odd results, retry on tool errors,
   never invent numbers; business vocabulary (bikri, udhaar, wasooli…) mapped to metrics; worked examples.
5. **Accuracy floor** — `AUTO_MIN_TIER=smart`: `auto` never uses the cheapest tier for questions.
6. **Audit + feedback** — set `AUDIT_LOG_FILE`; every question, tool call (with args) and answer is logged.
   `POST /v1/feedback {request_id, rating, expected}` attaches a thumbs-down and the correct answer to that record.
7. **Evals** — the improvement loop:
   ```bash
   cp evals/golden.example.json evals/golden.json     # add your real questions
   python -m app.evals.run evals/golden.json --tier smart
   ```
   Ground truth is computed from Odoo directly with the same metric, then the model's answer is checked for the right
   totals, group names and values. Every wrong answer you find → fix a metric definition / prompt rule → add it to
   `golden.json` → it can never silently regress.

## Things to verify before going live

* **Model IDs** in `app/llm/registry.py` change often — confirm them in each vendor's docs (or override via `MODEL_CATALOG_FILE`).
* The provider adapters are covered by unit tests for the wire format, but not exercised against live APIs in CI. Do one real question per provider you enable. Gemini's OpenAI-compat endpoint is the least-proven path for multi-step tool use.
* Written for Odoo's JSON-RPC (`/jsonrpc`). `read_group` has a best-effort fallback to `formatted_read_group` for newer versions; test your Odoo version.
* Sensitive business data (payroll, contracts) is *not* blocked by default — add it to `ODOO_BLOCKED_MODELS` / `ODOO_BLOCKED_FIELDS` or use `ODOO_ALLOWED_MODELS`.

## Next steps (not built yet)

Token-level streaming of the final answer, per-user Odoo permission passthrough (OAuth instead of one service user), scheduled pre-aggregation into Postgres for very large databases, audit log of every tool call.
