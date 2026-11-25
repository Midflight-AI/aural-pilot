import assert from "node:assert/strict";
import test from "node:test";
import { renderOpening } from "../src/lib/interview-opening";

const values = { participantName: "Maria Santos", title: "Video Editor", aiName: "Sam", questionCount: 6 };

test("fills every merge field for this participant", () => {
  assert.equal(
    renderOpening("Hi {{first_name}}, I'm {{interviewer}}. {{question_count}} questions on the {{role}} role.", values),
    "Hi Maria, I'm Sam. 6 questions on the Video Editor role.",
  );
});

test("greets 'there' when the participant has no name", () => {
  assert.equal(renderOpening("Hi {{first_name}}!", { ...values, participantName: " " }), "Hi there!");
});

test("leaves unknown fields as written and treats a blank opening as none", () => {
  assert.equal(renderOpening("Hello {{company}}", values), "Hello {{company}}");
  assert.equal(renderOpening("  ", values), null);
  assert.equal(renderOpening(null, values), null);
});

test("the relay says the opening and waits before question 1", async () => {
  const { openingRule } = await import("../server/openai-voice-relay-helpers");
  const rule = openingRule({ title: "Video Editor", opening: 'Hi Maria, tell me "about" you.' }, 1, 6);
  assert.match(rule, /saying exactly this.*"Hi Maria, tell me 'about' you\."/s);
  assert.match(rule, /NOT call signal_question_change/);
});

test("the relay keeps the built-in greeting without an opening or after question 1", async () => {
  const { openingRule } = await import("../server/openai-voice-relay-helpers");
  assert.match(openingRule({ title: "Video Editor" }, 1, 6), /mention the topic "Video Editor" and that there are 6 questions/);
  assert.match(openingRule({ title: "Video Editor", opening: "Hi" }, 3, 6), /^Start at question 3/);
});
