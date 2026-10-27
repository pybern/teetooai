import {
  configurationError, loadSavedDatabase, parseChatMessages,
  readConfigurationBody, streamChatWithSavedModel, type SavedModelRunner,
} from "@/lib/server/connections";
import { HkexDatabase } from "@/lib/server/hkex-database";
import { createHkexRunner } from "@/lib/server/hkex-agent";
import { acquireHkexRequest } from "@/lib/server/hkex-access";
import { createHkexExplanationRunner } from "@/lib/server/hkex-explanation";

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    const body = await readConfigurationBody(request);
    release = acquireHkexRequest(request);
    const messages = body.explanationId === undefined ? parseChatMessages(body.messages) : [{ role: "user" as const, content: "Explain these retrieved HKEX results." }];
    let runner: SavedModelRunner;
    if (body.explanationId !== undefined) runner = createHkexExplanationRunner(body.explanationId);
    else {
      const database = new HkexDatabase(await loadSavedDatabase(), request.signal);
      const metadata = await database.inspect();
      runner = createHkexRunner(database, metadata);
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
