import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { issueRelayTicket, verifyRelayTicket, initDigest } from "../src/lib/voice/relay-ticket";
const secret = "test-only-relay-secret-of-at-least-32-characters";
const init = { type: "init", sessionId: "session-one", context: { title: "Interview" } };
test("relay access binds the signed session and exact initialization", async () => {
 const ticket = await issueRelayTicket(secret, "session:one", init);
 assert.equal(await verifyRelayTicket(secret, ticket, init), "session:one");
 await assert.rejects(verifyRelayTicket(secret, ticket, { ...init, sessionId: "session-two" }));
 await assert.rejects(verifyRelayTicket(secret + "wrong", ticket, init));
 await assert.rejects(verifyRelayTicket(secret, "invalid", init));
 await assert.rejects(issueRelayTicket(undefined, "session:one", init));
});
test("relay rejects expired access even with an otherwise valid signature", async () => {
 const ticket = await new SignJWT({ digest: initDigest(init) }).setProtectedHeader({ alg: "HS256" }).setIssuer("aural-voice").setAudience("aural-relay").setSubject("session:one").setIssuedAt(1).setExpirationTime(2).sign(new TextEncoder().encode(secret));
 await assert.rejects(verifyRelayTicket(secret, ticket, init));
});
