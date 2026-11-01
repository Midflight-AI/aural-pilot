import { authorizeSession, json, jsonBody, responseError, uuid } from "@/lib/video/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { saveObservations } from "@/lib/observability/server";
export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const sessionId = uuid(body.sessionId);
    await authorizeSession(sessionId, undefined, request, false);
    const limited = checkRateLimit(`observations:${sessionId}`);
    if (limited) return limited;
    await saveObservations(sessionId, body.events, "client");
    return json({ accepted: true });
  } catch (error) { return responseError(error); }
}
