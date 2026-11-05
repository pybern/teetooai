import {
  ConnectionError, configurationError, loadSavedDatabase, parseChatMessages,
  readConfigurationBody, streamChatWithSavedModel, type SavedModelRunner,
} from "@/lib/server/connections";
import { HkexDatabase } from "@/lib/server/hkex-database";
import { agentScopeFor, createHkexRunner } from "@/lib/server/hkex-agent";
import { USE_CASE_BY_ID } from "@/lib/usecases";
import { acquireHkexRequest } from "@/lib/server/hkex-access";
import { createHkexExplanationRunner } from "@/lib/server/hkex-explanation";

// Hosting limit for one research turn; must exceed HKEX_SERVER_TIMEOUT_MS.
export const maxDuration = 300;

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    const body = await readConfigurationBody(request);
    const useCase = USE_CASE_BY_ID[typeof body.useCaseId === "string" ? body.useCaseId : "hkex-db"];
    if (useCase?.execution !== "database-agent") throw new ConnectionError("Choose a research workspace that supports database questions.", 400);
    release = acquireHkexRequest(request);
    const messages = body.explanationId === undefined ? parseChatMessages(body.messages) : [{ role: "user" as const, content: "Explain these retrieved HKEX results." }];
    // Database preflight still fails before any model request, but runs alongside the model settings check.
    const runner: Promise<SavedModelRunner> = body.explanationId !== undefined
      ? Promise.resolve(createHkexExplanationRunner(body.explanationId))
      : (async () => {
        const database = new HkexDatabase(await loadSavedDatabase(), request.signal, agentScopeFor(useCase));
        return createHkexRunner(database, await database.inspect(), useCase);
      })();
    const limitedRunner = runner.then((resolved): SavedModelRunner => async function* (options) {
      try { yield* resolved(options); } finally { release?.(); }
    });
    return await streamChatWithSavedModel(messages, request.signal, limitedRunner);
  } catch (error) {
    release?.();
    return configurationError(error);
  }
}
