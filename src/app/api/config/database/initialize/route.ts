import { authorizeConfiguration, configurationError, ConnectionError, readConfigurationBody } from "@/lib/server/connections";
import { initializeSavedDatabase } from "@/lib/server/database-seed";

export async function POST(request: Request) {
  try {
    authorizeConfiguration(request);
    const body = await readConfigurationBody(request);
    if (body.confirm !== true) throw new ConnectionError("Confirm that initialization may create and seed missing tables in the saved database.");
    return Response.json(await initializeSavedDatabase(request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return configurationError(error); }
}
