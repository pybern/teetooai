import {
  authorizeConfiguration, configurationError, ConnectionError, loadConnections,
  loadConfiguredBootstrapConnections, parseApi, parseDatabase, readConfigurationBody, testApi, testDatabase,
} from "@/lib/server/connections";

export async function POST(request: Request) {
  try {
    authorizeConfiguration(request);
    const body = await readConfigurationBody(request);
    if (body.kind !== "api" && body.kind !== "database") throw new ConnectionError("Choose api or database.");
    const result = body.kind === "api"
      ? await testApi(parseApi(body.settings, (await loadConnections()).api))
      : await testDatabase(parseDatabase(body.settings, (await loadConfiguredBootstrapConnections()).database));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return configurationError(error); }
}
