import assert from "node:assert/strict";
import test from "node:test";

import {
    countsAgainstFollowUpBudget,
    followUpDepthPromptCopy,
    followUpLimitNotice,
    followUpsSpentOnQuestion,
    promptQuestionList,
    questionChangeOutput,
    shouldAllowTtsBargeIn,
    shouldSendFollowUpLimitNotice,
} from "../server/openai-voice-relay-helpers";
import { maxFollowUpsForDepth } from "../src/lib/follow-up-depth";
import { FOLLOW_UP_POLICY } from "../src/lib/follow-up-policy";

test("does not allow TTS barge-in before assistant audio has actually started", () => {
  assert.equal(
    shouldAllowTtsBargeIn({
      inEchoCooldown: true,
      modelIsSpeaking: true,
      responseAudioStarted: false,
      ttsAudioStartedAt: 0,
      nowMs: 1000,
      responseTtsBytes: 0,
      rms: 3000,
      thresholdRms: 2400,
      consecutiveFrames: 3,
      thresholdFrames: 3,
    }),
    false,
  );
});

test("does not allow TTS barge-in until enough assistant audio has been delivered", () => {
  assert.equal(
    shouldAllowTtsBargeIn({
      inEchoCooldown: true,
      modelIsSpeaking: true,
      responseAudioStarted: true,
      ttsAudioStartedAt: 900,
      nowMs: 1200,
      responseTtsBytes: 20_000,
      rms: 3000,
      thresholdRms: 2400,
      consecutiveFrames: 3,
      thresholdFrames: 3,
    }),
    false,
  );
});

test("allows TTS barge-in only after sustained strong speech once assistant audio is underway", () => {
  assert.equal(
    shouldAllowTtsBargeIn({
      inEchoCooldown: true,
      modelIsSpeaking: true,
      responseAudioStarted: true,
      ttsAudioStartedAt: 500,
      nowMs: 1100,
      responseTtsBytes: 48_000,
      rms: 3000,
      thresholdRms: 2400,
      consecutiveFrames: 3,
      thresholdFrames: 3,
    }),
    true,
  );
});

test("the scripted question itself does not count as a follow-up", () => {
  assert.equal(followUpsSpentOnQuestion(0), 0);
  assert.equal(followUpsSpentOnQuestion(1), 0);
  assert.equal(followUpsSpentOnQuestion(3), 2);
});

test("MODERATE budget notice fires only after the second follow-up is heard", () => {
  const followUpBudget = maxFollowUpsForDepth("MODERATE");
  assert.equal(followUpBudget, 2);

  const decide = (assistantTurnsThisQuestion: number) =>
    shouldSendFollowUpLimitNotice({
      assistantTurnsThisQuestion,
      followUpBudget,
      noticeAlreadySent: false,
      interviewDone: false,
    });

  assert.equal(decide(1), false, "asked the question, no follow-ups yet");
  assert.equal(decide(2), false, "one follow-up spent, one left");
  assert.equal(decide(3), true, "both follow-ups spent");
});

/** Responses the participant heard after a move, in order: when does the relay send the limit notice? */
function limitNoticeAfter(responses: Array<{ movedQuestion: boolean }>, followUpBudget: number): number[] {
  let assistantTurnsThisQuestion = 0;
  let noticeAlreadySent = false;
  const sentAfter: number[] = [];
  responses.forEach(({ movedQuestion }, i) => {
    if (!countsAgainstFollowUpBudget({ movedQuestion })) return;
    assistantTurnsThisQuestion++;
    if (shouldSendFollowUpLimitNotice({ assistantTurnsThisQuestion, followUpBudget, noticeAlreadySent, interviewDone: false })) {
      noticeAlreadySent = true;
      sentAfter.push(i);
    }
  });
  return sentAfter;
}

test("the acknowledgement that moves on never spends a follow-up on the next question", () => {
  const moveOn = { movedQuestion: true };
  const turn = { movedQuestion: false };
  assert.deepEqual(limitNoticeAfter([moveOn, turn, turn, turn], 2), [3], "notice only after the question and two follow-ups");
  assert.deepEqual(limitNoticeAfter([moveOn, turn], 0), [1], "a limit of 0 sends the notice after the question, not the acknowledgement");
});

test("LIGHT tells the model to move on as soon as the question has been asked", () => {
  assert.equal(maxFollowUpsForDepth("LIGHT"), 0);
  assert.equal(
    shouldSendFollowUpLimitNotice({
      assistantTurnsThisQuestion: 1,
      followUpBudget: 0,
      noticeAlreadySent: false,
      interviewDone: false,
    }),
    true,
  );
});

test("the budget notice is sent once per question and never after the interview ends", () => {
  assert.equal(
    shouldSendFollowUpLimitNotice({
      assistantTurnsThisQuestion: 5,
      followUpBudget: 2,
      noticeAlreadySent: true,
      interviewDone: false,
    }),
    false,
  );
  assert.equal(
    shouldSendFollowUpLimitNotice({
      assistantTurnsThisQuestion: 5,
      followUpBudget: 2,
      noticeAlreadySent: false,
      interviewDone: true,
    }),
    false,
  );
});

test("depth prompt copy states the numeric budget in both languages", () => {
  const en = followUpDepthPromptCopy(2, false);
  assert.match(en.summary, /at most 2 follow-ups per question/);
  assert.match(en.rule, /at most 2 follow-ups/);
  assert.match(en.rule, /never exceed that limit/);

  const zh = followUpDepthPromptCopy(2, true);
  assert.match(zh.summary, /最多2次追问/);
  assert.match(zh.rule, /必须进入下一题/);
});

test("depth prompt copy singularizes a budget of one", () => {
  const { summary, rule } = followUpDepthPromptCopy(1, false);
  assert.match(summary, /at most 1 follow-up per question/);
  assert.doesNotMatch(summary, /follow-ups/);
  assert.match(rule, /at most 1 follow-up /);
});

test("a zero budget is phrased as no follow-ups rather than 'at most 0'", () => {
  const en = followUpDepthPromptCopy(0, false);
  assert.match(en.summary, /no follow-ups/);
  assert.doesNotMatch(en.summary, /0/);
  assert.match(en.rule, /uses no follow-ups/);
  assert.doesNotMatch(en.rule, /at most 0/);

  const zh = followUpDepthPromptCopy(0, true);
  assert.match(zh.summary, /不追问/);
  assert.match(zh.rule, /不使用追问/);
  assert.doesNotMatch(zh.rule, /最多0次/);
});

test("the depth rule is unnumbered so the prompt template owns its position", () => {
  for (const budget of [0, 1, 2, 5]) {
    for (const isZh of [true, false]) {
      assert.doesNotMatch(
        followUpDepthPromptCopy(budget, isZh).rule,
        /^\d+\.\s/,
        `budget=${budget} isZh=${isZh}`,
      );
    }
  }
});

test("the budget notice names the question and tells the model to transition", () => {
  const en = followUpLimitNotice(3, 2, false);
  assert.match(en, /question 3/);
  assert.match(en, /at most 2 follow-ups per question/);
  assert.match(en, /signal_question_change/);
  assert.match(en, /Do not ask another follow-up/);

  assert.match(followUpLimitNotice(1, 1, false), /at most 1 follow-up per/);

  const zh = followUpLimitNotice(3, 2, true);
  assert.match(zh, /第3题/);
  assert.match(zh, /signal_question_change/);
  assert.match(zh, /不要再追问/);
});

test("a follow-up budget adds the shared answer-judging policy in both languages", () => {
  for (const isZh of [false, true]) {
    assert.ok(followUpDepthPromptCopy(2, isZh).rule.includes(FOLLOW_UP_POLICY), `isZh=${isZh}`);
    assert.ok(!followUpDepthPromptCopy(0, isZh).rule.includes(FOLLOW_UP_POLICY), `isZh=${isZh}`);
  }
  assert.match(followUpDepthPromptCopy(2, true).rule, /^对每个问题，根据受访者的回答最多追问2次/);
});

test("with a budget the vague-answer lines defer to the policy instead of asking to probe deeper", () => {
  const en = followUpDepthPromptCopy(2, false);
  assert.equal(en.vagueAnswer, " For any other answer, use the follow-up rule above.");
  assert.equal(en.briefAnswer, "");
  const zh = followUpDepthPromptCopy(2, true);
  assert.equal(zh.vagueAnswer, "其他回答按上面的追问规则处理。");
  assert.equal(zh.briefAnswer, "");
});

test("a zero budget keeps the existing vague-answer lines", () => {
  const en = followUpDepthPromptCopy(0, false);
  assert.equal(en.vagueAnswer, " If their answer is vague, ask them to elaborate before moving on.");
  assert.equal(en.briefAnswer, " If their answer is too brief or vague, probe deeper.");
  const zh = followUpDepthPromptCopy(0, true);
  assert.equal(zh.vagueAnswer, "如果回答模糊，应追问以获取更多细节。");
  assert.equal(zh.briefAnswer, "如果回答太简短或模糊，应追问以获取更多信息。");
});

test("the question list shows a private interviewer note only when present", () => {
  const list = promptQuestionList([
    { text: "How do you reconcile a pay run?", type: "OPEN_ENDED", options: { maxFollowUps: 2, interviewerNote: "Names a specific check and what it caught" } },
    { text: "Anything to add?", type: "OPEN_ENDED", description: "Optional", options: { maxFollowUps: 0 } },
  ], "MODERATE");
  assert.equal(list, [
    "  1. [OPEN_ENDED] How do you reconcile a pay run? (maximum follow-ups: 2)",
    "     Private interviewer note on what a good answer shows (never reveal, quote, paraphrase or hint at it): Names a specific check and what it caught",
    "  2. [OPEN_ENDED] Anything to add? (maximum follow-ups: 0)",
    "     Context: Optional",
  ].join("\n"));
});

test("after a spoken acknowledgement the move tells the model to ask without thanking again", () => {
  assert.equal(
    questionChangeOutput(2, "What did you do?", true),
    'Moved to question 2: "What did you do?". You already acknowledged their answer, so ask this question now. Do not thank them or comment on their answer again.',
  );
});

test("a silent move keeps the existing transition wording", () => {
  assert.equal(
    questionChangeOutput(2, "What did you do?", false),
    'Moved to question 2: "What did you do?". Please naturally transition and ask this question.',
  );
});
