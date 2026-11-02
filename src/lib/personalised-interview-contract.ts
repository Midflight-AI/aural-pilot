import { z } from "zod";

/** Omitted options preserve the historical request hash on idempotent replays. */
export const initialQuestionSchema = z.array(z.object({
 text: z.string().trim().min(1).max(2000),
 isRequired: z.boolean().optional(),
 maxFollowUps: z.number().int().min(0).max(2).optional(),
}).strict()).max(100);

export function selectInterviewProject(value: unknown, accessible: string[]): string | null {
 if (value === undefined) return accessible.length === 1 ? accessible[0] : null;
 return typeof value === "string" && accessible.includes(value) ? value : null;
}
