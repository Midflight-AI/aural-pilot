import { NextResponse } from "next/server";
import { handleVoiceSave, type VoiceSavePayload } from "./logic";
import { voiceSaveOps } from "./ops";

/**
 * POST /api/voice/save
 * Save voice interview messages, optionally complete the session,
 * and generate the AI report after the response so the interviewee isn't blocked.
 */
export async function POST(req: Request) {
  const payload = (await req.json()) as VoiceSavePayload;
  const result = await handleVoiceSave(payload, voiceSaveOps);
  return NextResponse.json(result.body, { status: result.status });
}

