import { NO_ANSWERS_SUMMARY } from "@/lib/report-evidence";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** The report for a session with no candidate answers: no model call, no scores, no insights. */
export async function saveNoAnswersReport(sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ summary: NO_ANSWERS_SUMMARY, themes: [], sentiment: null, insights: { keyInsights: [] } })
    .eq("id", sessionId);
  if (error) throw error;
}
