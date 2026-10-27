import {
  authorizeConfiguration, configurationError, listApiModelCatalog,
  loadConnections, parseApiEndpoint, readConfigurationBody,
} from "@/lib/server/connections";

export async function POST(request: Request) {
  try {
    authorizeConfiguration(request);
    const body = await readConfigurationBody(request);
    const saved = await loadConnections();
    const catalog = await listApiModelCatalog(parseApiEndpoint(body.settings, saved.api), request.signal);
    return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return configurationError(error); }
}
