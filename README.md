# Insightful — Text to Insight

Ask a question in plain English and get back a visual answer: a headline, KPI cards with sparklines, charts, key findings, the underlying data and sources.

Five curated analysis use cases use a deterministic engine and real statistics, without LLM calls. **HKEX Short-Selling Research** and **HK Equities Analyst** use the database research agent (AI SDK) with your saved model and PostgreSQL connections.

### Export and query preview

Research workspaces fill the available viewport height. The conversation scrolls
independently while the header and message composer remain visible, including
below the mobile navigation. Thinking panels always start collapsed (while
streaming and after completion); expanding one renders Markdown (including
lists, tables, links and code blocks) in its own fixed-height scroll.
Active thinking labels, running tool labels and loading status text shimmer
in both research workspaces and optional explanations. Completed, failed and
cancelled activity stops shimmering. Reduced-motion preferences, forced-color
mode and print use static readable text instead.

Choose **Export PDF** in any research conversation, then **Save as PDF** in the
browser print dialog. The print-ready snapshot includes the current session's
questions, answers, reports, charts, complete data tables, sources, thinking,
tool activity, SQL and parameters, plus any completed explanations. Collapsed
thinking and closed details are expanded in the export without changing the
conversation. Curated report data, SQL and calculation steps are included even
if their tabs have not been opened. Incomplete answers retain their warning.
Wait for responses and report reveals to finish before exporting. Allow pop-ups
if prompted; the preview also has a **Print / Save as PDF** button for reprinting.
Export runs locally in the browser, with no additional model or database calls.

HKEX answers offer **View SQL** to inspect the queries and bound parameters
already used for that answer, including available queries while research is
running. Curated reports retain their **SQL** tab. Previewing does not execute
queries or make another model request.

Public research screens focus on questions and answers, while retaining live
thinking blocks, expandable tool activity with SQL/parameters, and per-answer
execution traces and SQL/method controls for curated reports. They omit the
static explanations of system architecture, token budgets, model-call counts
and connection setup. Failure messages use plain language, with a collapsed
**Error details** section showing the underlying client/server-returned message
for failed research and optional explanations. Details render as plain text,
without stack traces or raw provider response bodies; existing server-side
credential protection remains in place. Retrying or starting a new chat clears
the previous error details. Charts, KPI cards,
findings, underlying data, sources and material data limitations remain
available. Configuration keeps its administrator diagnostics.

## Features

- **Seven use cases** with a persona, a scenario and curated questions:
  - HKEX Database Research (public, read-only AI agent)
  - HK Equities Analyst (the default; database agent scoped to the HK datasets and HKEX short selling)
  - Macro Economist
  - Climate Analyst
  - EV Market Strategist
  - Equity Research: Big Tech
  - Open Exploration
- **Nine analysis types:**
  - Trend
  - Ranking
  - Share or breakdown
  - Comparison (time series rebased to 100, or cross-sectional radar charts)
  - Correlation, including lead/lag detection
  - Forecast: linear, exponential or logistic, picked by R², with a 90% interval
  - Anomaly detection with z-scores and event annotations
  - Growth (CAGR)
  - Company snapshot
- **Chart types:** line, area, bar, horizontal bar, stacked bar, donut, composed (forecast band), scatter with regression line, radar, treemap and radial.
- **Workspace:**
  - Autocomplete in the ask bar
  - Suggestion chips and follow-up questions
  - An HKEX market strip
  - CSV export and shareable links (`/?uc=hk&q=...` runs the question automatically)
  - History kept in localStorage
  - Saved history and pins restore after each consumer hydrates, including
    delayed Suspense navigation, without changing its initial server-rendered UI.
- **Dashboard:** pin any answer to build a board.
- **Data catalog:** every dataset with its metrics, a preview chart, sample rows and its source.
- **API:** `POST /api/insight` with `{ "question": "...", "useCaseId": "hk" }`, or `GET /api/insight?q=...&uc=hk`.

## Connection configuration

### Environment-first connections

Copy `.env.example` to `.env.local` for a new setup (do not overwrite an existing
env file). The LLM and database groups independently take precedence over saved
configuration. Set `LLM_BASE_URL` (including `/v1` where applicable), `LLM_MODEL`,
and optionally `LLM_API_KEY`, `LLM_REASONING_EFFORT`,
`LLM_PLANNING_OUTPUT_TOKENS`, `LLM_CHART_OUTPUT_TOKENS` and
`LLM_EXPLANATION_OUTPUT_TOKENS`. Token limits accept whole numbers from 256 to
32,768; blank limits use the existing defaults.

For PostgreSQL, set `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, and optionally
`DB_PASSWORD`, `DB_PORT` (default 5432), `DB_SSL` (`true` by default, or `false`)
and `DB_CA_CERTIFICATE` (PEM; quoted multiline values are supported by Next.js).
Environment connection groups are complete replacements, not field-by-field
merges: omitted credentials are empty, never inherited from a different endpoint.
Leave every variable in a group unset or blank to use that group's existing
JSON/PostgreSQL configuration. Partial or invalid environment groups fail
explicitly; they do not fall back. A complete environment LLM group avoids
reading the PostgreSQL settings table.

Next.js loads `.env.local` server-side. On deployment, set these same variables
in the host's environment settings. Do not use `NEXT_PUBLIC_` for credentials.
Restart/redeploy after editing variables. The Configuration page displays and
tests effective connections; saving an environment-managed group is rejected
with instructions to edit the environment instead. Other groups retain normal
saving behavior. Environment values are not migrated to configuration storage,
and existing saved connections remain available when env groups are removed.
`AI_GATEWAY_API_KEY` retains its Gateway-only precedence over `LLM_API_KEY`.

Open **Configuration** (`/config`) from the desktop or mobile navigation to save
and test an OpenAI-compatible model API and a direct PostgreSQL connection
(including PlanetScale Postgres). This is **not** a PostgREST HTTP connection.
Existing curated analysis continues to use the deterministic engine.
The separate HKEX agent uses saved server connections without an administrator
unlock. Configuring connections alone does not import data or trigger model calls.

Known values are prefilled for a new setup: the Vercel AI Gateway base URL
(`https://ai-gateway.vercel.sh/v1`), a starter model (`openai/gpt-4.1-mini`),
PostgreSQL port `5432`, and verified TLS. Saved settings always take precedence.
The starter model is an editable suggestion, not a verified connection.
Unknown database host, database name, username and credentials remain blank.

Before starting the server, set `CONFIG_ADMIN_TOKEN` to a random secret of at
least 32 characters in `.env.local` or your deployment's secret manager. Generate
one with `openssl rand -hex 32`, or use **Generate secure token** on the locked
configuration page. The browser generator uses Web Crypto to generate 32 random
bytes (256 bits), encoded as 64 hex characters, with show/hide and copy controls.
It does not transmit or persist the generated secret. Copy it to your password
manager and set it as `CONFIG_ADMIN_TOKEN` in Vercel's project **Settings >
Environment Variables**, then redeploy; locally, set it in `.env.local` and
restart. Generating a token does not change the server environment or create
an AI Gateway API key. Clipboard copying requires HTTPS or localhost and
permission; if unavailable, show and manually copy the token.
Enter that token to unlock the page. It is held
in page memory only, not localStorage. Use HTTPS and restrict access to trusted
administrators: authorized users can initiate outbound connections, including
to private IPs reachable by the server.

- **API:** enter the base URL (including `/v1` when applicable), exact model ID
  and optional API key. The model dropdown loads the endpoint's live
  `GET /models` catalog automatically when unlocking and after editing the URL
  or API key (with a short typing debounce). Superseded requests are cancelled
  so stale results cannot overwrite the current endpoint's models. Catalog
  loading does not block editing other fields. **Load models** and **Refresh
  models** can also retry manually. A single native **Model** combobox combines
  search, catalog selection and custom ID entry. Clear it to browse all models.
  It includes every returned model (no provider or capability exclusions);
  suggestion filtering and keyboard navigation use the browser's native
  datalist behavior. Vercel AI Gateway includes Qwen under `alibaba/`.
  Set its base URL to `https://ai-gateway.vercel.sh/v1` and use a Gateway API key.
  If `AI_GATEWAY_API_KEY` is nonempty in the server environment (for example,
  `.env.local`), it takes precedence over the configured API key for this
  Gateway endpoint only. Catalog loading, connection tests and streamed chat
  all use it. Other endpoints continue using their configured keys; the
  environment key is never sent to custom hosts, returned to the browser or
  written to the settings file. The form indicates when the environment key
  is active. Use **Test connection** to verify provider acceptance: presence
  alone does not prove validity. A rejected environment key reports an error
  without silently falling back to a configured key. An absent or blank
  environment variable leaves configured-key behavior unchanged.
  `CONFIG_ADMIN_TOKEN` remains separate and is still required to unlock settings.
  Catalog loading does not require a selected model or save. Model IDs can also
  be entered manually if an endpoint does not support listing. Catalog errors
  are shown explicitly; loading a list does not test model access.
  Image, audio and embedding models remain selectable but may not support chat.
  **Test connection** sends one strict JSON-schema compatibility probe and
  requires a normally finished, schema-valid assistant response; plain chat
  feedback alone no longer passes. It uses the planning output-token budget
  and the existing 15-second connection-test timeout, and may incur provider
  charges. A passing probe is a basic compatibility check, not a guarantee
  that every research plan will succeed; plans remain strictly validated.
  **Thinking effort** appears when the selected model's live catalog includes
  `reasoning_options` with an `effort` entry. Only advertised levels supported
  by this Chat Completions integration are offered (`none`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`); no model-name heuristics are used.
  **Provider default** omits the override. Save to apply it to chat; connection
  tests use the current form selection. Changing model or endpoint resets the
  selection. Models with only a toggle or token budget do not get an invented
  effort control. Custom providers need compatible catalog metadata to expose it.
  Explicit efforts are rechecked against the catalog before generation and sent
  as `reasoning_effort` (through SDK provider options for streaming).
  Unknown or unsupported selections fail explicitly; saved settings with no
  effort continue to work without an additional catalog request.
  Higher effort can increase latency and cost, and does not change the existing
  token budget or timeout. Provider acceptance does not guarantee a particular
  amount of reasoning or visible thinking text.
  After saving, use **Chat with your saved model** to send a real multi-turn
  conversation. Chat generation uses AI SDK 7 `streamText` and
  `@ai-sdk/openai-compatible`, with the saved model ID and base URL explicitly
  supplied (including Vercel AI Gateway and local compatible providers).
  Credentials come from saved server settings or the explicit Gateway-only
  environment override above, not an implicit SDK fallback.
  Replies stream progressively over the SDK's UI-message SSE protocol,
  read by its client transport. Retries are disabled to preserve the existing
  one-request-per-send behavior. Preflight errors use JSON; failures after
  streaming starts are reported in the stream. Interrupted replies are not
  added to conversation history, and the draft remains available for retry.
  Streamed and completed assistant replies render Markdown, including headings,
  lists, tables, links and fenced code blocks. User prompts and thinking remain
  plain text. Raw HTML is displayed as text, unsafe link protocols are blocked,
  and images appear as descriptions instead of loading remote resources.
  When the provider returns reasoning text, a separate **Thinking** block
  streams alongside the reply. Its expanded panel has a fixed 14rem (224px)
  height with an independently scrollable body. It starts open and never
  auto-collapses as output grows. New text follows the latest thinking;
  scrolling up pauses that follow behavior until the reader returns to the
  bottom. The header can still manually collapse or reopen the panel.
  This same presentation is used for HKEX research and optional explanations.
  The chat panel has a fixed 52rem height with the composer anchored below an
  independently scrolling conversation. New thinking and reply chunks
  automatically scroll the conversation to the latest output.
  Completed thinking remains viewable in this page's conversation, but is not
  sent back as context on later turns. Models that do not return reasoning
  show only the reply; this does not enable or request hidden model reasoning.
  The read-only catalog and short connection probe continue
  to use their existing HTTP implementation.
  This administrator-only playground always reads the saved
  endpoint, key and model server-side, ignoring unsaved form changes. Saving
  API settings resets the chat. Messages are held only in page memory (not
  localStorage or the settings file) and sent to the configured provider with
  conversation context; provider retention policies and charges apply.
  Replies have a 60-second timeout and a 1,024-token output budget.
  Provider streams are capped at 1 MB; reply and thinking text are each limited
  to 16,000 characters. Credentials reflected in either channel are redacted
  even across chunk boundaries.
  Cancel stops waiting and keeps the draft for retry; it cannot guarantee the
  provider stops processing or billing. **New chat** clears the conversation.
  The playground allows 11 exchanges, 16,000 characters per message and 64,000
  characters of request context; limits are explicit, never silently truncated.
  The existing curated deterministic analyses remain unchanged.
  The test makes a real `POST /chat/completions`, with a
  small token budget and a 15-second timeout. It only passes for a successful
  JSON response containing non-empty assistant text, which is shown as feedback.
  HTTP 200 alone is not success. Provider charges may apply. Redirects are not
  followed; API keys require HTTPS except on loopback endpoints.
- **PostgreSQL:** enter a hostname or bare IPv4/IPv6 address, port (default
  5432), database, username and password. TLS with certificate verification is
  enabled by default; optionally supply a PEM CA certificate. For PlanetScale,
  use the supplied hostname and TLS. The test opens a real connection and
  executes `SELECT current_database(), current_user, 1`, then closes it.
  It does not create tables, write data or validate application schema.
- **Test versus save:** tests use current form values without saving. Saving
  does not imply the connection passed a test. Editing invalidates displayed
  test feedback. Untouched secret fields retain stored secrets; Remove clears
  them on save. Saved credentials are never returned by configuration endpoints.

### Initialize and seed PostgreSQL

After saving the database connection, use **Initialize database** below the
connection form. Review the displayed saved target and tick the confirmation
checkbox. Initialization never runs automatically during a connection test,
save, page load or chat. Unsaved database edits must be saved first.

The initializer creates only these missing tables in the `public` schema:

| Table | Seed data |
| --- | --- |
| `insightful_datasets` | The 13 curated dataset IDs and JSONB metadata, including metrics, entities, provenance, as-of date and source row count |
| `insightful_dataset_rows` | Every curated observation as JSONB, keyed by `(dataset_id, row_index)` with a foreign key to the dataset catalog; decimal-year periods are preserved |
| `insightful_hkex_short_selling` | All 34,077 bundled HKEX records, keyed by `(trading_date, stock_code)`; stock codes remain text, share counts use bigint, and monetary values use exact numeric with a separate trading currency |
| `insightful_table_catalog` | Searchable descriptions of every agent-queryable table and sample dataset: purpose, column meanings and units, query notes, sample rows, coverage, source and example SQL, with a full-text `tsvector` index. Refreshed on every initialization (see [Table catalog](#table-catalog-and-agent-sql)) |
| `insightful_configuration` | API endpoint, model, thinking effort and configured API key as JSONB, keyed by `kind = 'api'`, with an update timestamp; imports existing file-based API settings without overwriting a saved database value |

Existing dataset relations are **skipped entirely**, even if empty or incomplete.
The table catalog is the exception among data tables: it only documents the
other tables, so each run upserts its managed entries from the current code and
the stored HKEX coverage/sample rows (reported as `seeded`), and removes stale
`dataset:*` entries. Other catalog rows are left untouched.
Initialization does not migrate schemas, update existing rows or backfill
existing dataset tables. The configuration table is the exception: initialization
imports a legacy API settings row if missing, using `ON CONFLICT DO NOTHING`.
No API settings row is invented when no legacy API configuration was saved.
After commit, legacy API settings are removed from the bootstrap file. A cleanup
failure explicitly reports that the database committed; retrying is safe and
does not overwrite database settings. If the dataset catalog exists but cannot support a newly
created observations table (for example, required IDs are absent), the
operation fails explicitly rather than changing that catalog. Use a deliberate
migration/import workflow to repair or update existing tables.

DDL and batch inserts run in one transaction, under a database-scoped advisory
lock. Repeated runs do not duplicate data, and overlapping initializers are
rejected. An import or permission failure rolls back newly created tables and
rows; if rollback cannot be confirmed, the error explicitly asks you to check
the database state. The saved role needs `CREATE` on schema `public` and
permission to reference an existing dataset catalog. After setup, use a
least-privilege account for routine queries.

The server validates CSV structure, dates, currencies, share counts, monetary
values, unique keys and coverage row count/date bounds before importing HKEX.
It preserves quoted names, leading zeros and exact decimals, uses parameterized
1,000-row batches, and verifies each inserted batch count. Only available
records from 24 August through 20 October 2026 are seeded; missing dates are
not filled with zeros. HKD, CNY and USD values must not be summed together.
Confirm applicable HKEX data-usage rights before importing.

Allow up to two minutes and keep the page open. A lost/timeout HTTP response
does not establish whether the transaction committed: check database state
before retrying. Results report each table's created/skipped status and inserted
row count only after commit. The initializer reads the saved server connection,
never browser-supplied connection overrides.

Both `data/hkex/hkex-short-selling.csv` and `data/hkex/hkex-coverage.json` must
exist at runtime; the Next.js route's output tracing includes them. A missing
file is an explicit failure, not an empty successful seed. Database seeding does
not change the current deterministic analysis engine or automatically expose
HKEX in the in-memory data catalog.

## HKEX database research agent

It is the default workspace: `/` (or an unknown `uc`) opens **HKEX Short-Selling Research**, which can also be
chosen from the desktop/mobile use-case navigation
(`/?uc=hkex-db`). Save a model that supports JSON-schema structured output and a PostgreSQL
connection in Configuration. Explicitly initialize missing tables if needed;
the agent never seeds, migrates or modifies your database.

Choose an example question or type your own, then send. The use case is public:
visitors do not enter an administrator token or access Configuration to chat.
Opening it and selecting an example do not generate a reply or fetch private
configuration. Requests use only saved server connections and the existing
Gateway environment-key precedence; browser connection overrides are ignored.
Each actual turn sends its question, conversation context and database metadata
to your configured AI provider and can incur charges. New query results are
rendered by the server; requesting an explanation explicitly sends their bounded
evidence to the provider. Later questions include prior textual results in
conversation context. Chat and tool activity remain in page memory,
not localStorage, history or dashboard pins. **New chat** clears the conversation.
Database hostnames, credentials and the configured API base URL are not exposed
by this workspace. Connection editing, configuration chat and initialization
remain administrator-protected.

The public research route rejects cross-origin browser requests and shares a
limit of two concurrent turns and ten starts per minute per Node.js process.
These are basic single-instance cost safeguards, not authentication or a
distributed abuse-prevention system. Any visitor can query the permitted HKEX
data and incur charges against the server's provider account. For an
internet-facing or multi-instance deployment, add shared rate limits/WAF rules
and provider spending limits appropriate to your audience.

Implementation:

- [hkex-agent.ts](./src/lib/server/hkex-agent.ts) uses AI SDK 7
  `streamText` with `Output.object` for one validated research plan. When the
  table catalog exists, its workspace descriptions are preloaded and the model
  may check one SQL draft before returning its plan
  (see [Table catalog and agent SQL](#table-catalog-and-agent-sql)).
- [hkex-skills.ts](./src/lib/server/hkex-skills.ts) holds the system instructions
  and the runtime `hkex-short-selling` research skill. These are application
  skills loaded by the agent, not editor/Copilot customization files.
- [hkex-database.ts](./src/lib/server/hkex-database.ts) implements the bounded,
  parameterized queries.
- [The public route](./src/app/api/hkex/chat/route.ts) applies request limits and
  inspects the saved database before any model calls. Missing tables,
  empty tables, incompatible schemas and permission errors fail explicitly.

Server setup (no model round trips):

- `loadResearchSkill` preloads the fixed research instructions.
- `inspectDatabase` reuses the current turn's real database preflight metadata.

Both are recorded in internal research activity and are not model-callable tools.
The public conversation displays this activity in an expandable tool log.
The initial model request already contains the skill, table schema and coverage.

Server-executed research steps (no additional model calls):

| Tool | Purpose |
| --- | --- |
| `findStocks` | Resolve names or short codes to five-digit stock codes; at most 20 matches |
| `queryHkex` | Rank stocks or query stock/market trends; one currency, up to five stock codes and 100 result rows |
| `renderChart` | Validate the plan's preferred shadcn chart, or select an eligible automatic default, against actual results; at most three charts |
| `computeInsights` | Calculate a headline, KPIs and findings from the returned rows of each HKEX or chartable SQL result |
| `chooseChart` | After the answer has streamed, ask the chart agent whether SQL results need a chart (the only step here that calls the model; see [Charts for SQL results](#charts-for-sql-results)) |

The server loads the skill and inspects metadata before the model request.
The model produces only a structured plan: a clarification, or up to three
queries with filters, stock lookups and preferred chart components. The saved
model/endpoint must support JSON-schema structured output.
The provider receives a strict JSON schema for the plan's shape; the server
separately validates business rules (clarification or queries, never both, and
at most five stock-name lookups across the plan). Missing output, malformed JSON
or schema/business-rule failures after a normally completed generation trigger
at most **three automatic plan repairs** (four planning attempts total) using the same model, question and
workspace metadata. The correction request receives safe validation reasons,
not the raw invalid output, and has no tools. Only a fully validated plan may
execute final queries; a previously checked read-only SQL draft may already
have run. Failed repair reports the specific category and bounded field
paths/reasons in **Error details**, without model values, unknown field names,
credentials or raw provider responses.
Root-type failures identify whether the model returned null, an array or a
primitive instead of a plan object, without exposing its content. The planner
uses a named schema and explicitly forbids JSON-encoded strings and wrappers.
Cancellation, timeouts, filtered/refused
finishes, truncated output, transport and authentication failures do not trigger
plan repair. Repair remains within the turn's existing deadline and can incur
up to three additional generation charges (up to five model steps including a draft
check). The separate single pre-stream HTTP 503 retry remains unchanged.
HKEX planning and optional explanations use **low thinking effort** when the
model catalog advertises it, without overwriting the saved model settings.
Explicit saved `none`/`minimal` efforts are preserved rather than increased.
If `low` is not advertised, the saved supported effort (or provider default)
remains in use. Research checks the model catalog before generation; catalog
failures are reported explicitly, and this metadata request is not a generation
round trip. Configuration tests and the playground retain their saved effort.
The server validates it, resolves names, queries the saved database and builds
factual Markdown tables/charts from returned values. No second narrative call
or chart-selection round trip is made. Query and chart requests normally
use **one generation call**, or two when checking a SQL draft, excluding the
existing single 503 retry.
Invalid plans may also incur up to three correction calls as described above.
Independent stock lookups run concurrently and identical search strings are
resolved once per turn. After all stock filters are resolved and validated,
up to three independent queries run concurrently; answer sections retain plan
order. Each read still uses a separate read-only transaction with the existing
timeouts and evidence limits, but its transaction setup uses one database
round trip instead of three. Explicit end dates skip the latest-date scan.
Preflight schema and coverage remain fresh on every turn; no cross-turn result
cache is used. Completed chat messages are memoized so typing and subsequent
streaming updates do not repeatedly parse their Markdown or rebuild charts.
Up to five stock-name lookups are allowed per plan; ambiguous matches ask
the user to specify a five-digit code rather than guessing or looping.
Unsupported requests receive a planner clarification, not fabricated data.
Internal activity records status, SQL templates, parameters and row counts.
The public conversation shows live provider reasoning in a collapsed Thinking
block and an expandable tool log alongside the answer, findings and charts.
The answer streams as soon as the plan is validated: the results heading first,
then each query's section in plan order as it completes (queries still run in
parallel). Raw plan JSON
is not shown. The surrounding interface does not include instructional copy
about token limits, architecture or generation counts. Public errors explain
what the user can do next without provider/configuration setup instructions.

### Table catalog and agent SQL

Use cases with `execution: "database-agent"` open the agent chat and send their
`useCaseId` to `/api/hkex/chat` (other use cases are rejected there, and
`/api/insight` rejects agent use cases). **HKEX Short-Selling Research**
(`agentDatasets: "all"`) can use every catalogued dataset. **HK Equities
Analyst** is scoped to its `datasetIds` (`hk-indices`, `hk-valuations`,
`hk-prices`, `hk-financials`) plus the HKEX table: catalog listing, search and
describe only return those entries, and every reference to
`insightful_dataset_rows`/`insightful_datasets` in its SQL is rewritten on the
server into a subquery filtered to those dataset ids. Both workspaces use the
same agent flow: the preflight loads their permitted full catalog descriptions
(columns, JSON keys, units, notes, sample rows and example SQL) into the
planner prompt. The model writes SQL directly without `searchTables` or
`describeTable`. It may check one draft with `runSql` (at most 2 model steps),
so a typical question needs one planning request (plus one chart request when
a SQL result can be charted; see [Charts for SQL results](#charts-for-sql-results)).
Data access remains scoped independently of this shared planning flow. The HK
workspace keeps its brief, example questions and market strip; it no longer
produces the engine's forecast/anomaly reports.

[table-catalog.ts](./src/lib/server/table-catalog.ts) defines one catalog entry
for the HKEX table, one for the sample dataset registry and one per curated
sample dataset (`dataset:<id>`, e.g. `dataset:us-macro`). Each entry stores the
physical relation, description, column meanings/units (dataset metrics map to
JSON keys in `insightful_dataset_rows.data`), query notes, up to five sample
rows, coverage, source and runnable example SQL. Metric labels, aliases,
entities and keywords are folded into the search text, so plain-language terms
such as "jobless", "carbon emissions" or "short turnover" find the right entry.

When the catalog is present, both planners receive the list of permitted catalog
ids and their full descriptions, including sample rows and example SQL.
Preflight metadata has a separate 128,000-character limit to accommodate the
full catalog; query evidence retains its 32,000-character limit. Oversized or
incomplete metadata fails explicitly rather than silently dropping descriptions.
The only model-callable tool is `runSql` (at most one call and two model steps
per turn; the final step has no tools so it always returns a plan):

| Tool | Purpose |
| --- | --- |
| `runSql` | Optionally check one draft query (20 rows); errors return to the model so it can correct the final plan |

The final plan may contain up to three `sqlQueries` alongside the templated HKEX
queries. The server re-validates and runs them (100-row cap), renders a Markdown
table with the tables used, and exposes the SQL through **View SQL**. Templated
HKEX queries are still preferred for HKEX rankings/trends because their charts
are chosen in the plan and validated against HKEX evidence. SQL results get
their own insight cards and charts (below). Without a catalog (not yet re-initialized) the
agent keeps its original single-request behaviour and cannot write SQL.

Model-written SQL is parsed with the real PostgreSQL parser
([libpg-query](https://www.npmjs.com/package/libpg-query)) in
[agent-sql.ts](./src/lib/server/agent-sql.ts) and must be exactly one `SELECT`
(CTEs allowed) that references only `insightful_hkex_short_selling`,
`insightful_dataset_rows` and `insightful_datasets` in `public`. CTE scoping is
resolved so a CTE cannot shadow another table. Node types, functions
(common aggregate, window, math, date, text and JSON functions) and cast types
are allow-listed; system catalogs, `insightful_configuration`, SQL-executing or
file functions, `SELECT INTO` and row locks are rejected. Accepted SQL runs
wrapped in a row limit, in a `READ ONLY` transaction with `search_path = public`
and the existing 5-second statement timeout. Database syntax/data errors are
returned to the model for correction; other failures stay sanitized. A turn is
limited to 24 database reads. For defence in depth, also point the saved
connection at a role that can only `SELECT` from these tables.

### Factual insight cards

Every executed HKEX query also produces a headline, KPI cards and findings,
using the same presentation components as curated use cases. These are
calculated on the server from **returned rows**, without another model call,
database read or automatic AI explanation. Each query keeps its own currency,
filters and stored-date scope; findings remain visible with their research turn.

- Rankings show the highest returned stock(s), exact additive totals and,
  when valid, concentration within the returned stocks—not whole-market share.
- Trends compare the first and last returned observation, show the latest
  returned value and identify observed peaks. Multiple stocks are evaluated
  separately. Percentage changes use the first returned value; a zero baseline
  or missing endpoint makes that change unavailable.
- Turnover-ratio changes use **percentage points**, not percent changes.
  Ratios are never added or averaged across rows.
- Exact decimal arithmetic preserves large database values. Derived shares and
  percentage changes are rounded to two decimal places. Nulls remain unavailable;
  additive totals are withheld if a returned metric value is missing.
- Ties, row-limit truncation, empty results and non-continuous stored coverage
  are explicit. An increase in short selling is not labeled good/bad and does
  not establish a cause, forecast or investment recommendation.

The [calculation helper](./src/lib/server/hkex-insights.ts) validates the
evidence before producing insight activity. The
[shared presentation](./src/components/insight-summary.tsx) renders KPIs and
findings without loading the curated chart engine. A failed turn may retain
already-calculated findings under **Incomplete research** for inspection;
they are not treated as a completed answer.

Catalogue SQL results get the same card, from
[sql-insights.ts](./src/lib/server/sql-insights.ts), when the rows have a clear
axis (a date, a `year`-like column or a text category with unique values) and a
numeric measure (the first numeric column that is not the axis, a year, an id or
a code). Ordered axes show the latest value, change over the period, peak, low
and the largest single move; categories show the leader, lowest value, spread,
a returned-row total (or average when values can be negative) and concentration
within the returned rows. Missing values and truncated results are flagged.
Results with repeated axis values (several series mixed together), a single row
or no numeric measure get no card. No model call is made.

### Charts for SQL results

SQL answers are streamed first. After every section has been sent, a separate
chart agent ([sql-chart.ts](./src/lib/server/sql-chart.ts)) decides whether a
chart would help. This is one additional structured-output model request, made
only when at least one SQL result has two or more rows and a numeric column;
HKEX template answers never trigger it. The agent sees the question, each
result's title, column profiles (number/date/text, distinct and null counts)
and up to 12 sample rows, and returns either no chart or, per result, a chart
type (`bar`, `horizontal-bar`, `line`, `area`), an axis column, one to four
value columns and an optional series column.

The server then builds the chart from the **returned rows**, never from
model-written values. A choice is rejected if a column does not exist, a value
column is not numeric, a line/area axis is not a date or number, an area chart
has more than one series, the axis repeats within a series, or the chart would
exceed 100 points or 8 series. Time axes are sorted; bar charts keep the SQL
order; missing values stay missing. Charts appear below the answer text. While
the chart step runs, a chart-sized placeholder with a shimmering "Preparing
chart..." caption holds that spot and is replaced by the chart (or removed if
no chart is added). A
declined, invalid or failed chart request never affects the completed answer;
the tool log records the outcome.

**Explain these results** is an optional explicit action, not automatic.
It is available in every database-agent workspace (HKEX Short-Selling Research
and HK Equities Analyst) whenever an answer returned rows: HKEX template results
and catalogue SQL results are both kept. The explainer also receives the
workspace name and persona, plus the catalog documentation of the tables used
(column meanings, units, notes, coverage/as-of date and source). It applies
general rules (direct answer first, patterns/outliers, units, limitations, no
recommendations or predictions), and adds HKEX-specific rules only when HKEX
evidence is present.
It makes one separate streaming model call using the server-held evidence,
without planning or querying again. Additional provider charges apply.
Explanations are shown separately and do not enter future research context.
Opaque result references live in a bounded, process-local memory cache
(32 entries, 15 minutes). They act as bearer references: do not share them
unless sharing the results is intended. A server restart, eviction, expiry or
routing to another instance may invalidate a reference; the UI reports this
explicitly and asks the visitor to run research again. Use a shared private
TTL store if deploying multiple instances. No client-supplied evidence is
accepted by the explanation action.

### Inline charts in the live HKEX use case

Ask **"Chart the top 10 HKD stocks by short-selling value on the latest stored
day"** or **"Plot the daily short-selling value for stock 00700 over the latest
30 stored calendar days."** An example chart prompt is available in the chat.
Choosing it only fills the draft; **Send message** starts research.

An upstream **HTTP 503** means the Gateway/model service reported unavailability;
it does not by itself establish an invalid key or URL. Wait briefly and resend.
If it persists, check provider status and model availability; an administrator
can choose another structured-output-capable model. The live HKEX planner allows **one** delayed
retry per turn, only for an HTTP 503 received before that model call starts
streaming. It waits one second, reuses the failed call's request,
and stays within the same 290-second deadline and cancellation
signal. It does not restart the whole research turn, retry a broken stream,
retry other HTTP statuses, or silently switch models. The retry can incur
additional provider charges. Configuration tests/playground keep retries disabled.
HTTP 429 indicates a provider rate/quota
limit; check usage and account credits if waiting does not help.

The previous agent made several model calls per turn. Research now makes one
planning call, plus one chart call after the answer when a SQL result can be
charted; explanations are separate, explicit requests. On a failed live turn,
partial thinking, tool activity, text, findings and charts stay visible under
**Incomplete research**.
They are not a completed answer and are excluded from future model context.
Interrupted tools are marked as errors, and the original draft remains available
to resend. Starting another request or choosing **New chat** clears that partial view.

The server evaluates each query result's category/value schema,
metric, currency, series/point counts, null/truncation flags, eligible catalog
components and a recommended default. The planner selects a preferred
component based on the intended schema and user intent (or requests `auto`);
the server validates it against the actual data and assembles a
validated [json-render](https://json-render.dev) specification from actual query
results, not model-supplied numbers. [The catalog](./src/lib/hkex-chart.ts)
contains five allowlisted components, and
[the React registry](./src/components/hkex-chart.tsx) dispatches each to
[shadcn chart primitives](./src/components/ui/chart.tsx), which use Recharts
underneath. The official shadcn chart component is adapted to the app's
existing light/dark tokens and `data-theme` attribute, without a global
theme reset or changing charts in curated use cases. No generated JavaScript,
HTML, actions, dynamic bindings or arbitrary component trees are accepted.
This integration is scoped to HKEX research, not the configuration playground
or existing curated dashboards.

| Catalog component | Suitable data |
| --- | --- |
| `HKEXBarChart` | Small categorical stock rankings |
| `HKEXHorizontalBarChart` | Many ranked stocks or long category names |
| `HKEXLineChart` | Chronological trends, including multiple stock series |
| `HKEXAreaChart` | One time series with at least two stored dates; unstacked magnitude |
| `HKEXDonutChart` | Complete 2-8-stock additive composition, without nulls and with at least two positive values |

The server rejects schema-incompatible choices even if requested by the model.
Donut slices cannot represent turnover ratios, truncated results or an invented
market total; they are explicitly labeled as composition of returned stocks.
Area charts cannot silently stack multiple stock series. Unsupported views
such as scatter plots require an appropriate paired-metric dataset and are
not exposed in this catalog.

Charts appear as research tools complete, always below the answer text (HKEX
charts first, then any SQL charts), and
stay with that completed turn. Each chart labels its metric, currency, actual
stored dates, representative HKEX sources and any row-limit truncation.
Rankings use bars or eligible composition charts; trends use lines or a
single-series area chart. Multiple stocks remain separate series.
Plotting converts decimals to approximate JavaScript numbers; an expandable
table preserves exact database values, five-digit codes and unavailable/null
ratios. Missing values are never changed to zero. Lines connect stored
observations, not a guaranteed complete daily feed.

Database queries run inside `BEGIN READ ONLY` transactions with five-second
statement timeouts and two-second lock timeouts. There is no arbitrary-SQL tool,
write tool, URL-fetch tool, or access to other tables. Grant the database user
only the SELECT privileges it needs in production. Research is bounded to one
planning generation, three queries, five stock lookups, ten database reads
including preflight, a 366-day date span, 32,000 characters per evidence result,
and a configurable output-token limit per model call (see below). Summaries show
up to ten rows per query; chart tables retain all returned rows.

**Output-token limits** are the main control on how much each model call can
generate, including provider thinking tokens. An administrator sets them under
**Configuration → Research output-token limits**, saved with the model settings:

| Step | Model call | Default |
| --- | --- | --- |
| Planning | Writes the research plan and SQL | 4,096 |
| Chart choice | Decides whether SQL results get a chart, after the answer | 4,096 |
| Explanation | **Explain these results**, on request | 4,096 |

Each limit accepts a whole number from 256 to 32,768; a blank field uses the
default. Reaching a limit stops that call with a message naming the limit. A
truncated plan runs no queries; a truncated chart choice adds no chart but
keeps the answer. The provider-stream size cap grows with the largest limit
(at least 1,024 KB). Research thinking longer than 16,000 characters is
shortened for display instead of failing the turn.

Time is a safety net rather than the main limit. Each research or explanation
request has a 290-second server deadline after database preflight (including
catalog validation), covering planning, queries and the optional chart request,
with a 320-second browser deadline for the entire request. The chat route sets
`maxDuration = 300` so hosts such as Vercel allow the full turn, including
the single pre-stream 503 retry described above; SDK-level retries remain disabled.
Cancellation closes active database reads as well as model generation.
Timeout, user cancellation and planner output-token exhaustion are reported
separately. A truncated plan never executes a data query and is not retried
automatically. Configuration chat retains its 60-second server deadline.

Latest means the latest **stored** date matching the currency/board/stock
filters, never an assumed live trading date. Rankings default to that day;
trends default to every stored day (up to 366) ending there, i.e. the full
bundled period of 24 Aug – 20 Oct 2026 (40 trading days). Relative periods such
as "last 30 days" or "this month" are anchored to the latest stored date, never
today's date; requests beyond stored coverage use the overlapping stored dates,
and a period with no overlap gets a clarification stating the stored range. The
use-case brief and example questions show this range from
[hkex-coverage.ts](./src/lib/hkex-coverage.ts), which a test keeps in sync with
the bundled CSV. Currency values are never
summed together, numeric values retain exact strings, missing rows are not
treated as zero, and row-limit truncation is explicit. Short turnover percentage
is `100 * SUM(short_selling_value) / SUM(total_turnover)`, not an average of
percentages and not short interest. Source URLs in aggregate rows are
representative links, not exhaustive provenance lists.

The agent explains data gaps, cites stored dates/currencies/source links and
suggests supported follow-up questions. Price predictions, outstanding short
positions and valuation questions require additional datasets; this use case
does not invent those values or give trading recommendations. Existing curated
use cases and `/api/insight` do not silently route to this paid agent.

The real-PostgreSQL integration tests are optional and create/drop their own
uniquely named disposable databases. Point them at a **test-only** PostgreSQL
server with `CREATEDB` privileges:

```bash
TEST_POSTGRES_URL='postgresql://user:password@127.0.0.1:5432/test' \
  npm test -- src/lib/server/database-seed.integration.test.ts src/lib/server/hkex-database.integration.test.ts
```

For groups not managed by environment variables, after initialization,
API/model settings (including any configured API key) are
stored in PostgreSQL in `public.insightful_configuration`. They are not encrypted
by the application: restrict table access and protect database backups. The
initializer revokes table access from `PUBLIC`; a separate runtime role needs
`SELECT`, `INSERT` and `UPDATE` on this table. API saves use a transaction and an
advisory lock to preserve omitted secrets across concurrent saves.

For file-managed connections, only the PostgreSQL connection (including its password) remains in the
server-only, gitignored `.local/connections.json`, written atomically with
owner-only permissions. It is the bootstrap needed to connect before loading
settings. Override its location with `CONNECTION_CONFIG_PATH` on a private
persistent volume. `CONFIG_ADMIN_TOKEN` and `AI_GATEWAY_API_KEY` remain environment
secrets and are never migrated into PostgreSQL.

Before the configuration table exists, API saves and reads continue using the
private file so existing installations and API-first setup keep working. Save
the database connection and explicitly run **Initialize database** to migrate.
Without an environment LLM group, once the table exists, PostgreSQL is authoritative, even when its API row is
absent; database outages, invalid schemas and permission errors fail explicitly
without falling back to stale file values. Saving a database connection updates
the bootstrap even if loading the new target's API settings fails; that failure
is explicitly reported. Changing the target database selects that database's
API configuration, not the previous database's settings.

Protect the bootstrap host and backups. Saves and initialization are serialized
within one Node.js process. Serverless, read-only, ephemeral or multi-instance
deployments without a database environment group still require a persistent, consistently provisioned bootstrap
connection; database-backed API settings do not remove that requirement.
`GET/PUT /api/config`, `POST /api/config/test`, `POST /api/config/models`,
`POST /api/config/chat` and `POST /api/config/database/initialize` require
`Authorization: Bearer <CONFIG_ADMIN_TOKEN>`.
`POST /api/hkex/chat` is public and uses the shared research limits described above.

## Data sources

| Dataset | Source |
| --- | --- |
| Hang Seng indices, 20 HK blue chips (prices, valuations, dividends, financials) | Yahoo Finance snapshot (`src/lib/data/hk-snapshot.json`) |
| US unemployment, CPI, fed funds, GDP growth 2010–2024 | BLS, BEA, Federal Reserve |
| GDP, population and GDP per capita of the 20 largest economies | World Bank (2023) |
| CO₂ concentration and temperature anomaly | NOAA, NASA GISS |
| Top CO₂ emitters | Global Carbon Project (2022) |
| Electricity mix, solar and wind share | Ember |
| Global and regional EV sales | IEA Global EV Outlook |
| Magnificent 7 revenue, net income and margin | 10-K filings, FY2021–24 |

### Refreshing the Hong Kong snapshot

```bash
npm run prefetch
```

This pulls five years of monthly prices, quotes, valuation ratios and annual financials from Yahoo Finance. Non-HKD financials are converted to HKD. The script then rewrites the snapshot JSON.

### HKEX daily short-selling extracts

[data/hkex/](./data/hkex/) contains standalone historical extracts from HKEX's
public Main Board and GEM daily quotation reports. They can be imported into
PostgreSQL with the explicit initializer above, then queried by **HKEX Database
Research**. They are not part of the deterministic analysis engine or in-memory
data catalog.

| File | Contents |
| --- | --- |
| [hkex-short-selling.csv](./data/hkex/hkex-short-selling.csv) | 34,077 records across 40 trading days, 24 August through 20 October 2026, covering both boards |
| [hkex-coverage.json](./data/hkex/hkex-coverage.json) | Requested twelve-month range, actual coverage, validation results and unavailable dates |
| [hkex-fetch-log.jsonl](./data/hkex/hkex-fetch-log.jsonl) | Per-request results, including retries; the latest entry for each board/date is authoritative |
| [hkex-short-selling-2026-10-20.csv](./data/hkex/hkex-short-selling-2026-10-20.csv) | Original validated one-day sample, also included in the combined extract |
| [hkex-access-validation.json](./data/hkex/hkex-access-validation.json) | Initial source-access checks, including separately labelled morning-report results |

Each CSV record contains the board, trading date, five-digit stock code, stock
name, short-selling shares and value, total traded shares and turnover, trading
currency, and source URL. Treat `stock_code` as text to retain leading zeros.
The unique record key is `(trading_date, stock_code)`. Monetary amounts are in
the row's trading currency; do not sum HKD, CNY and USD values together.

The collector reconciles each included report's security count, share totals
and monetary totals by currency. It requested 21 October 2025 through
20 October 2026: 80 reports validated, four explicitly reported public-holiday
closures, and 438 earlier weekday report URLs returned 404. A 404 does not
establish whether a date was a trading holiday or outside public retention.
Missing observations are not filled with zero.

The extracts include ETPs and other securities, not just ordinary shares, and
do not apply subsequent corrections. Technical access does not establish
commercial-use or redistribution rights; confirm the applicable HKEX terms
before such use.

The [collector](./scripts/hkex-backfill.py) requires Python 3.9+ and only uses
the standard library. Fetch a range into a new output directory:

```bash
python3 scripts/hkex-backfill.py \
  --start 2025-10-21 --end 2026-10-20 \
  --output data/hkex-refresh
```

Use `--resume` with the same range and output directory to reuse validated
reports, 404 responses and explicit holiday closures, and retry failures.
Only past dates are accepted so an unpublished or incomplete current-day
report cannot be mistaken for a completed report. The collector exits nonzero
for parsing, validation, network or unexpected HTTP failures; unavailable
404s and explicit closures are recorded in the coverage report.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine tests (vitest)
npm run lint
npm run typecheck
npm run build
```

Built with Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS v4, Recharts and lucide-react.

## Layout

```
src/lib/data/        datasets plus the HK snapshot
src/lib/engine/      parse.ts (question → interpretation), analyze.ts (→ report), stats.ts
src/lib/usecases.ts  personas and curated questions
src/components/      workspace, ask bar, report card, chart renderer, store
src/app/             workspace, /dashboard, /datasets, /config, /api/insight, /api/config
```
