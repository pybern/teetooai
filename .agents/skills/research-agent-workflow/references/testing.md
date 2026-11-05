# Testing patterns

All research-agent tests run offline with vitest. Use these fixtures rather than writing new mocks.

## src/lib/server/hkex-agent.test.ts (server, end to end through the route)

- **Provider fixture:** a local HTTP server that answers OpenAI-compatible `/v1/chat/completions` with SSE.
  - `calls`: planner and explanation request bodies.
  - `chartCalls`: chart-agent bodies, detected by `response_format.json_schema.name === "sqlChartChoice"`.
  - Control variables, reset in `beforeEach`:
    - `plan`: JSON the planner returns.
    - `script`: a per-call raw SSE list for multi-step tool loops (`toolCall(name, input)`, `chunk(delta, reason)`).
    - `finishReason`, `reasoning`, `explanation`, `providerStatus`.
    - `chartChoice`, `chartStatus`.
    - `chartGate`: a promise that holds the chart response so you can assert ordering.
- **Database:** `vi.mock("pg")` with `pg.query` routing on SQL text. Inside a `describe`, override with `pg.query.mockImplementation` and fall back to the original. In the catalog block, `"AS agent_query"` returns the SQL result rows.
- **Settings:** `await saveSettings(reasoningEffort?, outputTokens?)` writes the API and database connection to a temp file.
- **Calling:**
  - `await POST(request({ messages, useCaseId }))` for raw stream assertions; read `response.body` with a reader to check ordering.
  - `interceptChat()` + `research(onTools, useCaseId)`, or `sendModelChat(...)`, for client-parsed results (`result.message.content`, `result.tools`, `result.reasoning`).
- **Parity:** use `it.each(["hk", "hkex-db"])` for behaviour that must match across use cases.
- **Repairs:** `MAX_PLAN_REPAIRS = 3` permits four planning attempts; a draft tool step can add one provider request. Test success on the final repair, exhausted failures, non-object roots, latest safe diagnostics, no tools on repairs, and immediate stops for truncation/cancellation. Never execute final queries from an invalid or truncated plan.
- **Constants:** import `HKEX_SERVER_TIMEOUT_MS` and similar rather than writing numbers. Mock `AbortSignal.timeout` keyed on the constant to simulate deadlines.
- **Useful assertions:**
  - `calls[0]` → `max_tokens`, `reasoning_effort`, `tools`, `response_format`.
  - `calls` length → number of model requests.
  - `pg.query.mock.calls` → whether data queries ran or were read-only.
  - `JSON.stringify(result)` does not contain secrets or `"private upstream details"`.

## src/lib/server/sql-chart.test.ts (pure units)

`buildSqlChart`, `profileColumns`, `isChartable` and `buildSqlInsights` with inline rows. Values are strings, as `pg` returns them. Add one case per validation rule you introduce.

## src/components/model-chat.test.ts (shared UI)

- `ModelChat` is rendered with `agentMode: true`. `onSend.mockImplementationOnce(() => new Promise(...))` keeps a turn pending.
- Drive streaming with the callbacks captured in `onSend.mock.calls[0]`: `[2]` is onText, `[3]` onReasoning, `[4]` onTools (pass a full tool list each time).
- Charts need `vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })`.
- Position checks use `a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING`.
- Selectors: `figure[data-sql-chart]`, `figure[data-chart-placeholder]`, `.research-shimmer`, `[role="status"]`, `button[aria-label="Expand thinking"]`.

## src/components/hkex-agent-workspace.test.ts (real workspace, both use cases)

- Renders `HkexAgentWorkspace` with `USE_CASE_BY_ID[id]`. `fetch` is stubbed; return `createUIMessageStreamResponse({ stream: createUIMessageStream({ execute }) })` and write `start`, `reasoning-*`, `text-*`, `data-tool` and `finish` parts.
- Hold parts of the stream with promise gates (`await gate`) to assert in-progress UI, then release and use `vi.waitFor` for the final state.
- The `describe.each(["hkex-db", "hk"])("shared research UI for %s")` block is the parity suite. Extend it for any loading, shimmer or ordering behaviour.

## Other relevant suites

- `src/lib/server/connections.test.ts`: `parseApi` validation (including `outputTokens`), the stream wrapper limits, and config routes. The connection test requires a `stop` completion with strict schema-valid `{"ok":true,"feedback":"..."}` content; plain feedback, wrong root types, extra fields, refusals and truncated completions fail explicitly.
- `src/components/connection-settings.test.ts`: the Configuration form (thinking effort, output-token limit fields, save payload).
- `src/lib/model-chat-stream.test.ts`: `researchErrorMessage` mappings and the client timeout.
- `src/lib/usecases.test.ts`: the default and unknown-id resolution.
- `src/lib/server/agent-sql.test.ts`, `hkex-database.test.ts`, `hkex-insights.test.ts`, `hkex-chart.test.ts`: SQL validation and scoping, query building, HKEX insights and charts.
- `*.integration.test.ts` are skipped without a real database.
