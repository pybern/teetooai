import {
  authorizeConfiguration, configurationError, ConnectionError, loadConnections,
  publicConnections, readConfigurationBody, saveConnection,
} from "@/lib/server/connections";

export async function GET(request: Request) {
  try {
    authorizeConfiguration(request);
    return Response.json(publicConnections(await loadConnections()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return configurationError(error); }
}

export async function PUT(request: Request) {
  try {
    authorizeConfiguration(request);
    const body = await readConfigurationBody(request);
    if (body.kind !== "api" && body.kind !== "database") throw new ConnectionError("Choose api or database.");
    return Response.json(await saveConnection(body.kind, body.settings), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return configurationError(error); }
}
