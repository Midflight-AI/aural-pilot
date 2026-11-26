import { type LLMProvider } from "./types";
import { OpenAIProvider } from "./providers/openai";

const openai = new OpenAIProvider();

/** Aural's only text provider is OpenAI (Azure). */
export function getProvider(): LLMProvider {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("No LLM provider configured. Set OPENAI_API_KEY.");
  }
  return openai;
}

/** Model used for post-interview report generation. */
export const REPORT_MODEL = process.env.OPENAI_REPORT_MODEL?.trim() || "gpt-5.5";

/** Model used for interview question generation and refinement. */
export const GENERATOR_MODEL = process.env.OPENAI_GENERATOR_MODEL?.trim() || "gpt-4o-mini";

export const PRIMARY_GENERATOR_MODEL = GENERATOR_MODEL;
