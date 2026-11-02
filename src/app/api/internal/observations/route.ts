import { bearerMatches, saveObservations } from "@/lib/observability/server";
import { json, jsonBody, responseError, uuid } from "@/lib/video/server";
export async function POST(request: Request) {
  if (!bearerMatches(request, process.env.VOICE_RELAY_AUTH_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await jsonBody(request);
    await saveObservations(uuid(body.sessionId), body.events, "relay");
    return json({ accepted: true });
  } catch (error) { return responseError(error); }
}
