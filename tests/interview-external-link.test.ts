import assert from "node:assert/strict";
import test from "node:test";

import { parseExternalLink } from "../src/lib/interview-external-link";

test("a reference and https link are kept, trimmed", () => {
  assert.deepEqual(parseExternalLink({ reference: " REQ-0042 ", url: "https://ramp.example/admin/requisitions/abc" }), {
    externalReference: "REQ-0042",
    externalUrl: "https://ramp.example/admin/requisitions/abc",
  });
});

test("both null clears the link", () => {
  assert.deepEqual(parseExternalLink({ reference: null, url: null }), { externalReference: null, externalUrl: null });
});

test("a link needs both halves, https and a sensible length", () => {
  for (const body of [
    { reference: "REQ-0042", url: null },
    { reference: null, url: "https://ramp.example/x" },
    { reference: "REQ-0042", url: "http://ramp.example/x" },
    { reference: "REQ-0042", url: "javascript:alert(1)" },
    { reference: "REQ-0042", url: "not a url" },
    { reference: "", url: "https://ramp.example/x" },
    { reference: "x".repeat(41), url: "https://ramp.example/x" },
    { reference: "REQ-0042", url: `https://ramp.example/${"x".repeat(500)}` },
    null,
  ]) assert.ok("error" in parseExternalLink(body), JSON.stringify(body));
});
