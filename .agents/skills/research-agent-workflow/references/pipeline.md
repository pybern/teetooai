# Pipeline map

Function-level walk through one research turn, in execution order. Paths are relative to the repo root.

## Contents
1. [Use cases and routing](#1-use-cases-and-routing)
2. [Client request](#2-client-request)
3. [Route and preflight](#3-route-and-preflight)
4. [Stream wrapper and limits](#4-stream-wrapper-and-limits)
5. [Planning](#5-planning)
6. [Query execution and answer](#6-query-execution-and-answer)
7. [Chart agent](#7-chart-agent)
8. [UI rendering](#8-ui-rendering)
9. [Explanation](#9-explanation)
10. [Tool activity names](#10-tool-activity-names)
11. [Triage](#triage)

## 1. Use cases and routing

- `src/lib/usecases.ts`: `USE_CASES` (order matters; index 0 is `hkex-db`), `USE_CASE_BY_ID`, `DEFAULT_USE_CASE_ID = "hkex-db"`, `resolveUseCase(id)` (uses `Object.hasOwn`, so `__proto__` and unknown ids fall back to the default).
- `src/components/workspace.tsx`: `Workspace` resolves the use case. `execution === "database-agent"` → `HkexAgentWorkspace` (keyed by `uc.id`); passes the market strip only for `hk`. Other use cases → `ChatSession` (deterministic engine, not this pipeline).
- `src/components/sidebar.tsx` / `mobile-nav.tsx`: links `/?uc=<id>`; the sidebar highlights `resolveUseCase(...).id`.
- `src/components/hkex-agent-workspace.tsx`: the only place presentation differs. `hkex-db` uses the `ModelChat` default label, export title and empty prompt, plus `HKEX_EXTRA_SUGGESTION`. Other agent use cases pass `agentLabel: uc.tagline`, `exportTitle`, `emptyPrompt`.
- `src/app/api/insight/route.ts` rejects database-agent use cases; they must use `/api/hkex/chat`.

## 2. Client request

- `src/lib/model-chat-stream.ts` `sendModelChat(token, messages, signal, onText, onReasoning, { api: "/api/hkex/chat", onTools, useCaseId | explanationId })`. Body is `{ messages, useCaseId }` or `{ explanationId }`. Timeout is `HKEX_CLIENT_TIMEOUT_MS` (320 s).
- Parses the UI message stream; `data-tool` parts become `ModelChatToolActivity[]` passed to `onTools`.
- `researchErrorMessage(error)` maps errors to friendly text (expired, timed out, cancel, busy/429, `output(-token)? limit`, default).

## 3. Route and preflight

`src/app/api/hkex/chat/route.ts` `POST`:
1. `readConfigurationBody` → `USE_CASE_BY_ID[useCaseId ?? "hkex-db"]`; non-agent → 400 `ConnectionError`.
2. `acquireHkexRequest(request)` (`hkex-access.ts`): origin and cross-site checks, then a process-wide limiter (2 concurrent turns, 10 starts per minute, otherwise 429). Released in `finally`.
3. Research: `new HkexDatabase(loadSavedDatabase(), request.signal, agentScopeFor(useCase))`. `agentScopeFor` → `{ datasetIds: null }` for `agentDatasets: "all"`, otherwise the use case's `datasetIds`.
4. `database.inspect()` is the preflight: HKEX columns and coverage plus the permitted catalog entries (`catalogIdsForScope`) with full descriptions. It fails before any model call if the database is unreachable or the metadata exceeds `METADATA_MAX_CHARS` (128,000).
5. `createHkexRunner(database, metadata, useCase)` or `createHkexExplanationRunner(explanationId)`. The route passes the runner to `streamChatWithSavedModel(messages, signal, runnerPromise)` as a promise, so preflight runs alongside loading and checking the model settings. Either failure still returns a JSON error before any generation call.

## 4. Stream wrapper and limits

`src/lib/server/connections.ts` `streamChatWithSavedModel`:
- `loadSavedApi()` → `effectiveApiSettings` (`AI_GATEWAY_API_KEY` override for the Vercel AI Gateway) → `checkReasoningEffort` (research prefers `low` when supported). Research reuses a model catalog loaded in the last 5 minutes (`cachedModelCatalog`, keyed by endpoint and key); `saveConnection` clears it and `listApiModelCatalog` refreshes it.
- Deadline `HKEX_SERVER_TIMEOUT_MS` (290 s) for runners, 60 s for the config chat. It starts before the preflight resolves and is passed to runners as `deadline` (epoch ms). One delayed 503 retry per research turn; never retries 429.
- Provider stream byte cap is `max(1 MB, largest outputTokenLimit × 512 bytes)`.
- Text output is capped at `MAX_CHAT_MESSAGE_CHARS` (16,000) and fails if exceeded. Research **thinking** is clipped with "[Thinking shortened for display.]" instead of failing.
- A `finish` part with `finishReason: "length"` throws a generic output-token-limit error (the runners throw step-specific ones first).

Token limits (`src/lib/connections.ts`): `OUTPUT_TOKEN_STEPS = ["planning", "chart", "explanation"]`, `DEFAULT_OUTPUT_TOKENS` (4,096 each), `MIN_OUTPUT_TOKENS = 256`, `MAX_OUTPUT_TOKENS = 32768`, `outputTokenLimit(settings, step)`. Saved as `ApiSettings.outputTokens` and validated by `parseOutputTokens` (whole numbers in range; blank or null are omitted; unknown keys rejected). Edited in `connection-settings.tsx`.

## 5. Planning

`src/lib/server/hkex-agent.ts` `createHkexRunner`:
- Emits `loadResearchSkill` and `inspectDatabase` activities, then `planResearch` (running).
- Instructions: `HKEX_AGENT_INSTRUCTIONS` + `PRELOADED_CATALOG_INSTRUCTIONS` (or `NO_CATALOG_INSTRUCTIONS`) + the workspace line (`useCase.name`, `persona`, `scenario`) + `HKEX_RESEARCH_SKILL` + metadata + workspace tables + `HKEX_CHART_OPTIONS`, all from `hkex-skills.ts`.
- `streamText` with `Output.object({ schema: hkexPlanOutputSchema, name: "hkexResearchPlan", description: ... })`, `maxOutputTokens: outputTokenLimit(settings, "planning")` and `maxRetries: 0`. With a catalog: tools `{ runSql }`, `stopWhen: isStepCount(MAX_AGENT_STEPS)`, and `prepareStep` withdraws tools on the final step. `MAX_AGENT_TOOL_CALLS = 1`.
- Validation is `hkexPlanSchema`: clarification XOR ≥1 query; ≤3 `queries`, ≤3 `sqlQueries`, ≤5 stock searches. `planValidationDetails` produces sanitized messages, including the received type for non-object roots. Up to `MAX_PLAN_REPAIRS = 3` repair attempts (no tools) for schema failures after a normal finish; every correction uses the latest safe diagnostic and the original deadline. A repair is not started when `deadline − now < MIN_REPAIR_TIME_MS` (20 s); the error then says planning "timed out before automatic plan repair N". If the first attempt ran a `runSql` draft check, repairs get `draftCheck` (the draft SQL plus row count and column names, or its safe error) as untrusted data. `finishReason === "length"` stops with the configured limit and no further repair.
- Configuration `testApi` sends one strict JSON-schema probe, using the planning token budget and 15-second test timeout. A normal finish and schema-valid feedback are required; passing this small probe does not guarantee every research plan will succeed.

## 6. Query execution and answer

Still in `createHkexRunner`, after a valid plan:
- Yields `text-start` and "## Results". A clarification yields only "## Clarification needed".
- SQL sections start first, before stock lookups, since they never depend on them.
- Stock searches: `findStocks` per unique search, then `resolveStockSearch` in the query's currency: exact code, then exact name ignoring listing suffixes (`-W`, `-R`, ...), then a single match from an untruncated lookup. Otherwise a "## Clarification needed" section lists the candidates and only that query is skipped. The turn ends early only when nothing else is left to run.
- **HKEX sections** (parallel): `queryHkex` (`database.query`, built by `buildHkexQuery`) → `computeInsights` (`buildHkexInsights`, exact decimals) → `formatHkexEvidence` → if the plan's `chart` is not null: `getHkexChartOptions` + `buildHkexChart` → `renderChart` activity with `chart`.
- **SQL sections** (parallel): `querySql` (`database.runAgentSql` → `validateAgentSql` in `agent-sql.ts`: libpg-query parse, allow-listed nodes, functions and relations, scope rewrite, `READ ONLY`, `AGENT_SQL_ROW_LIMIT = 100`) → `buildSqlInsights` → a `computeInsights` activity when it isn't null → `formatSqlEvidence` (20 rows, 10 columns preview). If `querySql` fails with a repairable error (`SQL rejected: ...` from the validator, or `Query failed: ...` for PostgreSQL 42xxx/22xxx except 42501), `correctSql` makes one structured call (`agentSqlRepair` schema `{ sql }`, no tools, planning token limit, `min(SQL_REPAIR_TIMEOUT_MS = 90 s, deadline − now − 5 s)`; skipped below `MIN_REPAIR_TIME_MS`) and the corrected SQL runs through `querySql` again. Activity `repairSql`: running → complete, error, or complete with "nearly out of time". Connection, permission, read-limit and size errors are not corrected. A section that still fails becomes "This query could not be completed".
- All sections run concurrently but are yielded in plan order (HKEX first, then SQL).
- Database limits (`hkex-database.ts`): every read runs in `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '2s'`. The pg client's own `query_timeout` is 10 s (`createPostgresClient(..., 10000)`), only a backstop. `HKEX_READ_LIMIT = 24` reads per turn. So a slow turn is almost always model time, not database time.
- `storeHkexExplanation(question, hkexResults, { workspace, sqlResults, tables })` → `researchResults` activity with `explanationId` (only when some rows were returned). The store is in memory: 32 entries, 15-minute TTL.

## 7. Chart agent

`src/lib/server/sql-chart.ts`, called from `createHkexRunner` after the SQL text loop and the explanation store, before `text-end`:
- `profileColumns(rows)` classifies columns as number, date or text (raw string rows from `pg`). `isChartable`: ≥2 rows, ≥2 columns, at least one number column.
- If none are chartable: no call and no `chooseChart` activity.
- Time budget: `min(CHART_TIMEOUT_MS = 60 s, deadline − now − CHART_DEADLINE_MARGIN_MS = 5 s)`. Below `MIN_CHART_TIME_MS` (10 s) the call is skipped with a `chooseChart` "nearly out of time" note. When the budget runs out, the answer is kept and `chooseChart` errors with "ran out of time". Only a client cancel or the turn deadline itself is rethrown.
- `chooseSqlCharts({ model, settings, abortSignal, onError, question, results })`: structured output `sqlChartChoiceSchema` (named `sqlChartChoice`, which the test fixture keys on). `maxOutputTokens: outputTokenLimit(settings, "chart")`. Input is `chartAgentInput`: question, titles, column profiles, ≤12 sample rows (values ≤80 chars). Drops choices for results it wasn't offered and duplicate choices.
- `buildSqlChart(result, choice)` validates: columns exist; values are numeric and not the axis; the series column is separate and only used with one value column; line/area need a date or number axis; area has one series; ≤100 points and ≤8 series; no duplicate (label, series); ≥2 numeric values. Time axes are sorted, bars keep SQL order, and nulls are preserved. The output is `SqlChartSpec` (`src/lib/sql-chart.ts`).
- Activities: `chooseChart` running → per choice `renderChart` complete with `sqlChart`, or an error → `chooseChart` complete or error. A non-abort failure is caught, so the answer still completes.

## 8. UI rendering

`src/components/model-chat.tsx` (shared by both use cases):
- Finished turn (`ChatMessage`): thinking, `ToolActivities`, `ResearchInsights`, answer `MarkdownReply`, `ResearchCharts` (HKEX), `SqlCharts`, `SqlPreview` (View SQL), `ExplainResults`.
- Incomplete turn: the same order under "Incomplete research".
- Streaming: thinking (`streaming` while no text yet), tool log (`active`), View SQL, insights, answer, `ResearchCharts`, `SqlCharts`, `ChartPlaceholder` (when a `chooseChart`/`renderChart` tool is running), status line "Researching your question...".
- Shimmer: `.research-shimmer` on the status line, "Thinking...", the running tools summary and items, the "Preparing chart..." caption and "Preparing your explanation...". `.shimmer` on the placeholder bars. Both stop under `prefers-reduced-motion`.
- Chart components: `HkexChart` (json-render registry over `hkexChartCatalog`) and `SqlChart` (recharts via `ChartContainer`, sharing the `colors` palette from `hkex-chart.tsx`). The PDF export (`src/lib/export-chat-pdf.ts`) snapshots any recharts SVG.

## 9. Explanation

`src/lib/server/hkex-explanation.ts` `createHkexExplanationRunner(id)`: validates the UUID and expiry (410 if missing). Streams one call with `explanationInstructions` (common rules + HKEX rules only when HKEX evidence is present) and `maxOutputTokens: outputTokenLimit(settings, "explanation")`. `finishReason: "length"` → a step-specific error. No database access.

## 10. Tool activity names

`loadResearchSkill`, `inspectDatabase`, `planResearch`, `runSql` (draft check), `findStocks`, `queryHkex`, `querySql`, `repairSql` (SQL correction), `computeInsights` (carries `insights`), `renderChart` (carries `chart` or `sqlChart`), `researchResults` (carries `explanationId`), `chooseChart`. The UI keys behaviour on these names and fields; rename only with matching UI and test updates.

## Triage

| Symptom | Where to look |
|---|---|
| "API request timed out after N seconds" | `HKEX_SERVER_TIMEOUT_MS`. Check which step was slow in the tool log. Prefer raising a token limit or narrowing the question over raising time. Keep server < `maxDuration` < client. |
| "...reached its N-token output limit" | The step named in the message (planning, chart, explanation). Raise it in Configuration → Research output-token limits. Planning truncation never runs queries. |
| Plan validation / repair errors | `hkexPlanSchema`, `planValidationDetails`, and the instructions and JSON examples in `hkex-skills.ts`. The model must support JSON-schema structured output. Configuration's Test connection verifies a basic schema probe; research still validates each plan and stops after three failed repairs. |
| "Database evidence exceeded 32,000 characters" | Template and catalogue SQL results are trimmed to the rows that fit (`fitRows`, `EVIDENCE_MAX_CHARS`) and marked partial, so this now only fires for a single row too large on its own (or for `findStocks`). Trends are fetched newest first (a cut keeps the latest dates; a mid-date cut in a stock trend drops that date) and returned oldest first; template results carry `source_url` once per result in `sources`, not per row. |
| "This query could not be completed" | `validateAgentSql` rejection (relation, function or node not allowed, or out of scope) or a database error. The `querySql` activity shows the SQL. A `repairSql` entry means one correction was tried (or skipped near the deadline); a second `querySql` error means the corrected SQL failed too. No `repairSql` entry means the error was not repairable (connection, permission, size). |
| "Research planning timed out before automatic plan repair" | The first planning attempt(s) used most of the turn. Check the planning step time and token limit; repairs need `MIN_REPAIR_TIME_MS` left. |
| No chart for a SQL answer | Was the result chartable (`isChartable`; no `chooseChart` entry means it wasn't)? Did `chooseChart` decline ("A chart would not add..."), or produce a `renderChart` error naming the failed rule? A `chooseChart` error shows only the generic "No chart was added" message. The real cause (token limit, schema or provider failure) is not surfaced, so reproduce it in `hkex-agent.test.ts` or add logging. |
| No insight card for a SQL answer | `buildSqlInsights` returned null: no clear axis or measure, a single row, or repeated axis values. |
| Feature appears in one use case only | Look for a `uc.id`/`useCase` branch outside presentation content or data scope, and add the case to the parity `describe.each`. |
| Wrong workspace opens by default | `resolveUseCase` / `DEFAULT_USE_CASE_ID`. |
| "These research results expired" on Explain | The in-memory explanation store (15 min, 32 entries, per process). |
