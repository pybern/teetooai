import {
  authorizeConfiguration, streamChatWithSavedModel, configurationError, parseChatMessages, readConfigurationBody,
} from "@/lib/server/connections";

export async function POST(request: Request) {
  try {
    authorizeConfiguration(request);
    const body = await readConfigurationBody(request);
    const messages = parseChatMessages(body.messages);
    return await streamChatWithSavedModel(messages, request.signal);
  } catch (error) { return configurationError(error); }
}
