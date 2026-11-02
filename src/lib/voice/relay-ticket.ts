import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const issuer = "aural-voice";
const audience = "aural-relay";
function key(secret: string | undefined) {
  if (!secret || secret.length < 32) throw new Error("relay_auth_unconfigured");
  return new TextEncoder().encode(secret);
}
export function initDigest(init: unknown) {
  return createHash("sha256").update(JSON.stringify(init)).digest("hex");
}
export async function issueRelayTicket(secret: string | undefined, subject: string, init: unknown) {
  return new SignJWT({ digest: initDigest(init) }).setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt()
    .setExpirationTime("60s").sign(key(secret));
}
export async function verifyRelayTicket(secret: string | undefined, token: string, init: unknown) {
  const { payload } = await jwtVerify(token, key(secret), { issuer, audience, algorithms: ["HS256"], maxTokenAge: "60s" });
  if (!payload.sub || payload.digest !== initDigest(init)) throw new Error("invalid_relay_ticket");
  return payload.sub;
}
