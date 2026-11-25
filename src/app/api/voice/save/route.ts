import { randomUUID } from "node:crypto";
import { verifiedInsights } from "@/lib/report-verification";
import { hasCandidateAnswers, reportEvidence } from "@/lib/report-evidence";
import { saveNoAnswersReport } from "@/lib/no-answers-report";
import { svgDataUrlToPng } from "@/lib/ai/convert-svg";
import { extractJson } from "@/lib/ai/extract-json";
import { buildSummaryPrompt } from "@/lib/ai/prompts/summary";
import { getProvider, REPORT_MODEL } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import {
  handleVoiceSave,
  resolveVoiceQuestionId,
  sessionQuestionOrder,
  type SessionQuestion,
  type ActivitySegment,
  type CompletionSession,
  type ProgressSession,
  type VoiceSaveOps,
  type VoiceSavePayload,
} from "./logic";

const log = createLogger("api/voice/save");
const voiceSaveOps: VoiceSaveOps = {
  async insertMessages(sessionId, messages) {
    // Resolve turns against this session's own questions (its invite plan when it has one).
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("interviewId, questionPlan")
      .eq("id", sessionId)
      .single();
    if (sessionError || !session) throw sessionError ?? new Error("Session not found");
    let questions = (session.questionPlan as { questions?: SessionQuestion[] } | null)?.questions;
    if (!questions) {
      const { data, error } = await supabaseAdmin
        .from("questions")
        .select("id, order")
        .eq("interviewId", session.interviewId);
      if (error) throw error;
      questions = data ?? [];
    }
    const ordered = sessionQuestionOrder(questions);
    // Database defaults give every row in one insert the same timestamp.
    const firstTurnMs = Date.now() - messages.length + 1;
    const { error } = await supabaseAdmin.from("messages").upsert(
      messages.map((m, index) => ({
        id: m.id ?? randomUUID(),
        timestamp: new Date(firstTurnMs + index).toISOString(),
        sessionId,
        role: m.role === "user" ? ("USER" as const) : ("ASSISTANT" as const),
        content: m.content,
        contentType: "TEXT" as const,
        questionId: resolveVoiceQuestionId(m, ordered),
        ...(m.questionIndex === -1 ? { introductionEndSeconds: Math.max(0, Number(m.introductionEndSeconds) || 0) } : {}),
        wordCount: m.content.split(/\s+/).length,
        transcription: m.source === "chat" ? "chat" : null,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
  },
  async loadSessionForCompletion(sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select(
        `*, interview:interviews!inner(title, objective, language, userId, projectId, assessmentCriteria, questions(text, order, type))`,
      )
      .eq("id", sessionId)
      .order("order", {
        referencedTable: "interviews.questions",
        ascending: true,
      })
      .single();

    if (data?.questionPlan && data.interview) {
      data.interview.questions = data.questionPlan.questions;
      data.interview.assessmentCriteria = data.questionPlan.assessmentCriteria;
    }
    return (data as CompletionSession | null) ?? null;
  },
  async loadActivitySegments(sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select("activitySegments")
      .eq("id", sessionId)
      .single();
    return ((data?.activitySegments as ActivitySegment[]) ?? []);
  },
  async closeOpenSegments(sessionId, now) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select("activitySegments")
      .eq("id", sessionId)
      .single();
    const segments = ((data?.activitySegments as ActivitySegment[]) ?? []);
    const closed = segments.map((s) =>
      s.leftAt === null ? { ...s, leftAt: now } : s,
    );
    await supabaseAdmin
      .from("sessions")
      .update({ activitySegments: closed })
      .eq("id", sessionId);
    return closed;
  },
  async loadMessageTimestamps(sessionId) {
    const { data } = await supabaseAdmin
      .from("messages")
      .select("timestamp")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: true });

    return (data ?? []).map((r) => r.timestamp as string);
  },
  async loadSessionForProgress(sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select(`*, interview:interviews!inner(questions(*))`)
      .eq("id", sessionId)
      .order("order", {
        referencedTable: "interviews.questions",
        ascending: true,
      })
      .single();

    if (data?.questionPlan && data.interview) {
      data.interview.questions = data.questionPlan.questions;
    }
    return (data as ProgressSession | null) ?? null;
  },
  async updateSession(sessionId, payload) {
    await supabaseAdmin.from("sessions").update(payload).eq("id", sessionId);
  },
  generateSummary,
  log,
  now: () => new Date(),
};

/**
 * POST /api/voice/save
 * Save voice interview messages, optionally complete the session,
 * and fire-and-forget an AI summary/analysis so the interviewee isn't blocked.
 */
export async function POST(req: Request) {
  const payload = (await req.json()) as VoiceSavePayload;
  const result = await handleVoiceSave(payload, voiceSaveOps);
  return NextResponse.json(result.body, { status: result.status });
}

async function generateSummary(
  sessionId: string,
  interviewTitle: string,
  objective?: string | null,
  language?: string | null,
  questions?: { text: string; order: number; type?: string }[] | null,
  assessmentCriteria?: { name: string; description: string }[] | null,
): Promise<void> {
  try {
    const { data: allMessages } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("sessionId", sessionId)
      .order("timestamp", { ascending: true });

    if (!allMessages || allMessages.length === 0) {
      log.info("No messages to summarize");
      return;
    }

    if (!hasCandidateAnswers(allMessages)) {
      await saveNoAnswersReport(sessionId);
      return;
    }
    const evidence = reportEvidence(questions ?? [], allMessages);
    const whiteboardDrawingsRaw = evidence.turns
      .filter((m) => m.contentType === "WHITEBOARD" && m.whiteboardData)
      .map((m) => {
        const data = m.whiteboardData as Record<string, unknown>;
        return {
          label: (data.label as string) || "Untitled Drawing",
          imageDataUrl: m.whiteboardImageUrl ?? null,
        };
      });

    const whiteboardDrawings = await Promise.all(
      whiteboardDrawingsRaw.map(async (d) => ({
        ...d,
        imageDataUrl: d.imageDataUrl
          ? await svgDataUrlToPng(d.imageDataUrl)
          : null,
      })),
    );

    const codeSnippetsInput = evidence.turns
      .filter(
        (m) => (m.contentType as string) === "CODE" && m.whiteboardData,
      )
      .map((m) => {
        const data = m.whiteboardData as Record<string, unknown>;
        return {
          label: (data.label as string) || "Untitled Snippet",
          code: (data.code as string) || "",
          language: (data.language as string) || "plaintext",
        };
      })
      .filter((s) => s.code.trim().length > 0);

    const provider = getProvider(REPORT_MODEL);
    const textMessages = evidence.turns
      .filter((m) => m.contentType === "TEXT")
      .map((m) => ({
        role: m.role === "USER" ? "user" : "assistant",
        content: m.content,
      }));
    const drawingsInput =
      whiteboardDrawings.length > 0 ? whiteboardDrawings : null;
    const codeInput = codeSnippetsInput.length > 0 ? codeSnippetsInput : null;

    const promptMessages = buildSummaryPrompt(
      interviewTitle,
      textMessages,
      objective,
      assessmentCriteria,
      evidence.questions,
      language,
      drawingsInput,
      codeInput,
    );

    let response;
    try {
      response = await provider.generateResponse({
        messages: promptMessages,
        temperature: 0.3,
        maxTokens: 8192,
        model: REPORT_MODEL,
      });
    } catch (err) {
      const isVisionError =
        err instanceof Error &&
        /image.*not supported|vision.*not supported|does not support.*image/i.test(
          err.message,
        );
      if (isVisionError && drawingsInput?.some((d) => d.imageDataUrl)) {
        log.info("Model does not support images, retrying text-only");
        const textOnlyDrawings = drawingsInput.map((d) => ({
          ...d,
          imageDataUrl: null,
        }));
        const fallbackMessages = buildSummaryPrompt(
          interviewTitle,
          textMessages,
          objective,
          assessmentCriteria,
          evidence.questions,
          language,
          textOnlyDrawings,
          codeInput,
        );
        response = await provider.generateResponse({
          messages: fallbackMessages,
          temperature: 0.3,
          maxTokens: 8192,
          model: REPORT_MODEL,
        });
      } else {
        throw err;
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(response.content);
    } catch (parseErr) {
      log.error(
        "Raw AI response (first 1000 chars):",
        response.content.slice(0, 1000),
      );
      throw parseErr;
    }

    const insightsData = verifiedInsights(parsed, evidence.turns, evidence);

    await supabaseAdmin
      .from("sessions")
      .update({
        summary: String(parsed.summary ?? ""),
        themes: (parsed.themes as string[]) ?? [],
        sentiment: parsed.sentiment ?? null,
        insights: insightsData,
      })
      .eq("id", sessionId);

    const themeCount = Array.isArray(parsed.themes) ? parsed.themes.length : 0;
    const insightCount = Array.isArray(parsed.keyInsights)
      ? parsed.keyInsights.length
      : 0;
    const qEvalCount = Array.isArray(parsed.questionEvaluations)
      ? parsed.questionEvaluations.length
      : 0;
    log.info(
      `Summary generated for session ${sessionId}: ` +
        `${themeCount} themes, ${insightCount} insights, ${qEvalCount} question evaluations`,
    );
  } catch (error) {
    log.error("Summary generation failed:", error);
  }
}
