import assert from "node:assert/strict";
import test from "node:test";

import { buildInterviewerPrompt } from "../src/lib/ai/prompts/interviewer";
import { maxFollowUpsForDepth } from "../src/lib/follow-up-depth";
import { FOLLOW_UP_POLICY } from "../src/lib/follow-up-policy";

type PromptArgs = Parameters<typeof buildInterviewerPrompt>[0];

function systemPromptFor(followUpDepth: string | null): string {
  const interview = {
    aiName: "Aural",
    title: "Beauty advisor screening",
    objective: "Assess sales and communication skills",
    aiTone: "Professional",
    language: "en",
    followUpDepth,
    chatEnabled: true,
    voiceEnabled: false,
    videoEnabled: false,
    questions: [
      { text: "Walk me through a tough customer.", type: "TEXT", description: null, options: null },
      { text: "How do you keep up with new products?", type: "RESEARCH", description: null, options: null },
    ],
  };

  const [system] = buildInterviewerPrompt({
    interview,
    conversationHistory: [],
    currentQuestionIndex: 0,
  } as unknown as PromptArgs);

  const { content } = system;
  assert.equal(system.role, "system");
  assert.ok(typeof content === "string", "system prompt should be plain text");
  return content;
}

test("MODERATE states the 1-2 follow-up budget the creator picked as a hard limit", () => {
  const prompt = systemPromptFor("MODERATE");
  assert.equal(maxFollowUpsForDepth("MODERATE"), 2);

  assert.match(prompt, /HARD LIMIT of 2 follow-ups per scripted question/);
  assert.match(prompt, /Ask at most 2 follow-ups per scripted question/);
  assert.match(prompt, /you MUST move to the next scripted question/);
});

test("LIGHT asks for no follow-ups at all", () => {
  const prompt = systemPromptFor("LIGHT");
  assert.equal(maxFollowUpsForDepth("LIGHT"), 0);

  assert.match(prompt, /Ask only the scripted questions/);
  assert.doesNotMatch(prompt, /Ask at most 0 follow-ups/);
});

test("DEEP raises the budget but still names a limit", () => {
  const prompt = systemPromptFor("DEEP");
  assert.equal(maxFollowUpsForDepth("DEEP"), 5);

  assert.match(prompt, /HARD LIMIT of 5 follow-ups per scripted question/);
  // The old copy promised unlimited probing, which is what over-ran the budget.
  assert.doesNotMatch(prompt, /until you feel the topic is fully explored/);
});

test("RESEARCH questions get a bigger budget that is still bounded", () => {
  const prompt = systemPromptFor("MODERATE");
  assert.equal(maxFollowUpsForDepth("MODERATE", "RESEARCH"), 4);

  assert.match(prompt, /up to 4 follow-ups instead of 2/);
  assert.match(prompt, /still a hard limit/);
  assert.doesNotMatch(prompt, /Override the normal follow-up limit/);
});

test("answering the participant does not spend the follow-up budget", () => {
  assert.match(
    systemPromptFor("MODERATE"),
    /does not count against this budget/,
  );
});

test("an unset depth falls back to the MODERATE budget rather than going unbounded", () => {
  for (const depth of [null, "medium"]) {
    const prompt = systemPromptFor(depth);
    assert.match(
      prompt,
      /HARD LIMIT of 2 follow-ups per scripted question/,
      `depth=${String(depth)}`,
    );
  }
});

function promptForQuestions(followUpDepth: string, questions: Array<{ text: string; options: unknown }>): string {
  const [system] = buildInterviewerPrompt({
    interview: {
      aiName: "Aural",
      title: "Payroll officer screening",
      objective: null,
      aiTone: "Professional",
      language: "en",
      followUpDepth,
      chatEnabled: true,
      voiceEnabled: false,
      videoEnabled: false,
      questions: questions.map(q => ({ ...q, type: "OPEN_ENDED", description: null, isRequired: true })),
    },
    conversationHistory: [],
    currentQuestionIndex: 0,
  } as unknown as PromptArgs);
  const { content } = system;
  assert.ok(typeof content === "string");
  return content;
}

test("a private interviewer note is listed under its question only when present", () => {
  const prompt = promptForQuestions("LIGHT", [
    { text: "How do you reconcile a pay run?", options: { maxFollowUps: 2, interviewerNote: "Names a specific check and what it caught" } },
    { text: "Anything to add?", options: null },
  ]);
  assert.match(prompt, /1\. \[OPEN_ENDED\] How do you reconcile a pay run\? \(maximum follow-ups: 2; required\)\n {3}Private interviewer note .*never reveal.*: Names a specific check and what it caught\n2\. /);
  assert.equal(prompt.match(/Private interviewer note/g)?.length, 1);
  assert.doesNotMatch(promptForQuestions("MODERATE", [{ text: "Anything to add?", options: { maxFollowUps: 2 } }]), /Private interviewer note/);
});

test("a follow-up budget brings in the shared answer-judging policy", () => {
  const prompt = promptForQuestions("LIGHT", [{ text: "How do you reconcile a pay run?", options: { maxFollowUps: 2 } }]);
  assert.ok(prompt.includes(FOLLOW_UP_POLICY));
  assert.match(prompt, /the follow-up limit is a maximum, not a target/);
  assert.match(prompt, /If the answer needs a follow-up and the follow-up budget/);
});

test("with a follow-up budget, nothing but the policy tells the model when to probe", () => {
  const prompt = promptForQuestions("MODERATE", [{ text: "How do you reconcile a pay run?", options: { maxFollowUps: 2 } }]);
  assert.match(prompt, /3\. Ask a follow-up only when the follow-up rule below calls for one\n/);
  assert.match(prompt, /- Ask at most 2 follow-ups per scripted question\n/);
  assert.doesNotMatch(prompt, /questions to dig deeper|key thread unexplored/);
});

test("a limit of 0 keeps the no-follow-up copy without the policy", () => {
  const prompt = promptForQuestions("LIGHT", [{ text: "Anything to add?", options: { maxFollowUps: 0, interviewerNote: "Anything relevant" } }]);
  assert.match(prompt, /Ask only the scripted questions/);
  assert.match(prompt, /3\. Ask intelligent follow-up questions to dig deeper\n/);
  assert.ok(!prompt.includes(FOLLOW_UP_POLICY));
  assert.match(prompt, /Private interviewer note/);
});
