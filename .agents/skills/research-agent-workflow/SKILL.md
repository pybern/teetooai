---
name: research-agent-workflow
description: "End-to-end guide to the database research agent behind the HKEX Short-Selling Research (hkex-db, default) and HK Equities Analyst (hk) workspaces: /api/hkex/chat routing, data scoping, preflight, structured planning, HKEX template and catalogue SQL queries, streamed answers, insight cards, the post-answer chart agent, chart placeholder, explanations, output-token limits and timeouts, and the shared ModelChat UI. Use this skill whenever you change, debug, extend, review or explain anything in that flow, even if the request only mentions one piece of it: charts or chart choice, insights/KPI cards, shimmer or loading states, timeouts or 'timed out' errors, token limits, planning or SQL errors, use case 1 vs 2 differences, the default workspace, View SQL, Explain these results, or adding a new database-agent use case."
---

# Research agent workflow

This repo has two kinds of workspaces. Five curated use cases run a deterministic engine through `/api/insight` (see `src/lib/engine`, `src/components/insight-store.tsx`) and are **not** covered here. The two `execution: "database-agent"` use cases run the AI research agent described below:

| # | id | Name | Data scope |
|---|---|---|---|
| 1 | `hkex-db` | HKEX Short-Selling Research (default workspace) | `agentDatasets: "all"`: every catalogued dataset |
| 2 | `hk` | HK Equities Analyst | HKEX table + its `datasetIds` (`hk-indices`, `hk-valuations`, `hk-prices`, `hk-financials`) |

Both run **the same agent and the same UI**. They differ only in data scope, one workspace line in the planner prompt, and presentation content (labels, suggestions, HK market strip). Keeping them identical everywhere else is a standing requirement from the project owner. Any feature added for one must work for both, with a test that runs it for both.

## End-to-end flow

Read [references/pipeline.md](./references/pipeline.md) for the function-level map of every step. In summary:

1. **Workspace selection.** `resolveUseCase(params.get("uc"))` (`src/lib/usecases.ts`) returns the requested use case, or `DEFAULT_USE_CASE_ID = "hkex-db"` for a missing or unknown id. `workspace.tsx` renders `HkexAgentWorkspace` for database-agent use cases, and the sidebar uses the same resolver for its highlight.
2. **Client send.** `HkexAgentWorkspace` → `ModelChat` (`agentMode`) → `sendModelChat(..., { api: "/api/hkex/chat", useCaseId })`. The response is an AI SDK UI message stream with text, reasoning and `data-tool` parts.
3. **Route** (`src/app/api/hkex/chat/route.ts`). Rejects non-agent use cases with a 400 before any provider or database access. Takes a concurrency slot (`acquireHkexRequest`) and builds `HkexDatabase` with `agentScopeFor(useCase)`. Runs `database.inspect()` as preflight, then `createHkexRunner(database, metadata, useCase)`. Explanation requests (`explanationId`) use `createHkexExplanationRunner` instead. `maxDuration = 300`.
4. **Stream wrapper** (`streamChatWithSavedModel` in `src/lib/server/connections.ts`). Loads the saved model settings and applies the 290 s server deadline. Allows one 503 retry per turn, sizes the provider-stream cap from the token limits, and redacts credentials. Clips research thinking to 16,000 characters, then forwards `onToolActivity` as `data-tool` parts.
5. **Planning** (`createHkexRunner`, `src/lib/server/hkex-agent.ts`). One structured-output `streamText` call whose instructions include the preloaded workspace catalog. It may make one `runSql` draft check (`MAX_AGENT_STEPS = 2`); tools are withdrawn on the last step. Output must match the named `hkexResearchPlan` schema and `hkexPlanSchema`: either a `clarification`, or up to three `queries` (HKEX templates, each with a `chart` preference) plus up to three `sqlQueries` (catalogue SQL). An invalid plan gets up to `MAX_PLAN_REPAIRS = 3` automatic repair attempts with no tools, within the original deadline. A plan cut off at the token limit is never executed or repaired further.
6. **Queries.** Every query starts in parallel; sections stream in plan order. HKEX templates do `findStocks` → `validateHkexQuery` → `queryHkex` → `computeInsights` (`buildHkexInsights`) → `renderChart` (`buildHkexChart`, using the planner's chart preference). SQL queries do `querySql` (`runAgentSql`, validated by `validateAgentSql` and scoped per use case) → `computeInsights` (`buildSqlInsights`, when the rows have a clear axis and measure).
7. **Answer.** Markdown sections (`formatHkexEvidence`, `formatSqlEvidence`) stream as each query finishes. Server-held evidence is stored for the optional explanation (`storeHkexExplanation`).
8. **Chart agent (after the answer).** Only after **every** section has streamed: if any SQL result `isChartable`, one more structured-output call (`chooseSqlCharts`) returns per-result chart choices or `{ charts: [] }`. `buildSqlChart` builds the chart from the **returned rows only**. Failures add no chart and never affect the answer. HKEX template results never trigger this call.
9. **UI** (`src/components/model-chat.tsx`). Order inside a turn: thinking → tool log → insight cards → **answer text → HKEX charts → SQL charts → chart placeholder (while streaming)** → View SQL → Explain. Shimmer marks the status line, live thinking, the running tool heading and items, the chart placeholder caption and the explanation loading line.
10. **Explanation.** Runs only when the user clicks **Explain these results**: one streaming call over the server-held evidence, with no new queries.

## Invariants (do not break)

- **Same agent, same UI for both use cases.** Branch on `uc.id` only for presentation content in `hkex-agent-workspace.tsx` / `workspace.tsx`, and on `useCase` only for data scope and the prompt's workspace line. Never add a feature behind `uc.id === "hkex-db"`.
- **The model never supplies data values.** Plans contain queries; charts and insights are computed by the server from rows the database returned. Model chart choices only name columns and a chart type, and are validated against the actual rows.
- **Stream first, chart last.** Nothing may delay answer text for chart work. The chart agent runs after the final text delta; the placeholder holds the chart's spot below the answer meanwhile.
- **Charts render below the answer text**, in every view: finished, incomplete and streaming.
- **Tokens are the primary limit, time is a safety net.** Per-step output-token limits (`planning`, `chart`, `explanation`; default 4,096; range 256–32,768) live in `ApiSettings.outputTokens`. Read them via `outputTokenLimit(settings, step)`, never a hard-coded number. Deadlines: server `HKEX_SERVER_TIMEOUT_MS = 290000` < route `maxDuration = 300` s < browser `HKEX_CLIENT_TIMEOUT_MS = 320000`. Preserve that ordering if you change any of them.
- **Read-only, scoped data access.** Agent SQL is parsed with the PostgreSQL parser, limited to the catalogued relations, rewritten into the use case's dataset scope, and run `READ ONLY` with a 100-row cap. Do not widen this.
- **Errors stay user-safe.** Never echo provider bodies, model output or unknown plan keys into errors. `researchErrorMessage` maps server errors to friendly text, so keep new limit or timeout messages matching its patterns (`output(-token)? limit`, `timed out`).
- **Deterministic first.** Insights, charts and formatting need no model call. Only planning, chart choice and explanation call the model.

## Making changes

Follow the matching recipe, then run the verification steps below. Patterns for each test file are in [references/testing.md](./references/testing.md).

**Change what the planner can do** (new query field, new plan rule):
1. Update `hkexPlanOutputSchema` / `hkexPlanSchema` and `planFields` in `hkex-agent.ts`.
2. Update the instructions in `hkex-skills.ts` (`HKEX_AGENT_INSTRUCTIONS`, `PRELOADED_CATALOG_INSTRUCTIONS`), including a valid JSON example.
3. Add tests in `hkex-agent.test.ts` that set `plan = {...}` and assert on `calls[0]` and the streamed content.

**Change charts:**
- HKEX template charts: `src/lib/hkex-chart.ts` (spec and catalog), `src/lib/server/hkex-chart.ts` (eligibility and build), `src/components/hkex-chart.tsx`.
- SQL charts: `src/lib/sql-chart.ts` (spec), `src/lib/server/sql-chart.ts` (profiling, `isChartable`, chart-agent prompt and schema, `buildSqlChart` validation), `src/components/sql-chart.tsx`.
- Keep the chart-agent call after the text loop in `createHkexRunner`, and keep `buildSqlChart` rejecting anything not grounded in the rows.

**Change insight cards:** `hkex-insights.ts` (exact decimal math for HKEX) or `sql-insights.ts` (generic SQL rows). Both return `InsightSummary`, rendered by `ResearchInsightSummary`. Return `null` from `buildSqlInsights` rather than produce a misleading summary.

**Change loading or shimmer states:** edit `model-chat.tsx` only. Add the use-case parity assertion to the `describe.each(["hkex-db", "hk"])` block in `hkex-agent-workspace.test.ts`. Respect `prefers-reduced-motion` in `globals.css` (`.research-shimmer`, `.shimmer`).

**Change token limits or timeouts:** constants and helpers are in `src/lib/connections.ts`. Validation is `parseOutputTokens` in `src/lib/server/connections.ts`, and the admin UI is `connection-settings.tsx` (Research output-token limits). Tests reference the constants (`HKEX_SERVER_TIMEOUT_MS`), not literals.

**Add a database-agent use case:** add an entry in `USE_CASES` with `execution: "database-agent"` and either `agentDatasets: "all"` or explicit `datasetIds`. It then inherits the route, agent and UI automatically. Add it to the `it.each`/`describe.each` lists in `hkex-agent.test.ts` and `hkex-agent-workspace.test.ts`, and document it in the README.

**Debug a user-reported failure:** see the triage table in [references/pipeline.md](./references/pipeline.md#triage).

## Verification

Run the smallest set that covers the change, then the full suite before finishing:

```bash
npx vitest run src/lib/server/hkex-agent.test.ts src/lib/server/sql-chart.test.ts   # agent, chart agent, insights
npx vitest run src/components/model-chat.test.ts src/components/hkex-agent-workspace.test.ts  # UI and parity
npm test            # full suite (vitest run)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

These tests use a local mock provider and a mocked `pg` client, so no real model or database is needed. A live check needs saved model and database settings (Configuration page) and `npm run dev`. Say so explicitly in your summary if you could not run one.

## Documentation

`README.md` is the user-facing source of truth. Sections to keep in sync: *HKEX database research agent*, *Table catalog and agent SQL*, *Factual insight cards*, *Charts for SQL results*, *Inline charts in the live HKEX use case*, and the limits paragraph (output-token limits table and deadlines). Update them in the same change as the code.
