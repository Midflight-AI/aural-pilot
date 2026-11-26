import assert from "node:assert/strict";
import test from "node:test";

import {
  getGeneratorModelChain,
  resolveGeneratorModel,
} from "../src/lib/ai/generator-run";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_GENERATOR_MODEL",
] as const;

function withEnv(
  nextEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = nextEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("getGeneratorModelChain uses the configured OpenAI generator model", () => {
  withEnv({ OPENAI_API_KEY: "test-openai", OPENAI_GENERATOR_MODEL: "gpt-4o" }, () => {
    assert.deepEqual(getGeneratorModelChain(), ["gpt-4o"]);
    assert.equal(resolveGeneratorModel(), "gpt-4o");
  });
  withEnv({ OPENAI_API_KEY: "test-openai", OPENAI_GENERATOR_MODEL: undefined }, () => {
    assert.deepEqual(getGeneratorModelChain(), ["gpt-4o-mini"]);
  });
});

test("getGeneratorModelChain refuses to run without OpenAI", () => {
  withEnv({ OPENAI_API_KEY: undefined, OPENAI_GENERATOR_MODEL: undefined }, () => {
    assert.throws(() => getGeneratorModelChain(), /OPENAI_API_KEY/);
  });
});
