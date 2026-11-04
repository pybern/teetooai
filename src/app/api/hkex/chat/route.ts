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
    let runner: SavedModelRunner;
    if (body.explanationId !== undefined) runner = createHkexExplanationRunner(body.explanationId);
    else {
      const database = new HkexDatabase(await loadSavedDatabase(), request.signal, agentScopeFor(useCase));
      const metadata = await database.inspect();
      runner = createHkexRunner(database, metadata, useCase);
    }
    const limitedRunner: SavedModelRunner = async function* (options) {
      try { yield* runner(options); } finally { release?.(); }
    };
    return await streamChatWithSavedModel(messages, request.signal, limitedRunner);
  } catch (error) {
    release?.();
    return configurationError(error);
  }
}
