import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { issueRelayTicket } from "../src/lib/voice/relay-ticket";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await delay(25);
  assert.ok(predicate(), "condition reached before deadline");
}
test("relay releases upstream connections on setup disconnect and isolates six simultaneous sessions", { timeout: 35000 }, async () => {
  const provider = new WebSocketServer({ port: 0 });
  await once(provider, "listening");
  const providerPort = (provider.address() as { port: number }).port;
  const portProbe = createServer(); portProbe.listen(0); await once(portProbe, "listening");
  const port = (portProbe.address() as { port: number }).port; await new Promise<void>(resolve => portProbe.close(() => resolve()));
  let active = 0, peak = 0, initialized = 0;
  let holdSetup = true; let respond = true;
  provider.on("connection", ws => {
    active++; peak = Math.max(peak, active);
    ws.on("close", () => { active--; });
    ws.send(JSON.stringify({ type: "session.created", session: {} }));
    ws.on("message", raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "session.update") {
        initialized++;
        if (!holdSetup) ws.send(JSON.stringify({ type: "session.updated", session: {} }));
      }
      if (msg.type === "response.create" && respond) {
        ws.send(JSON.stringify({ type: "response.created" }));
        ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(4800).toString("base64") }));
        ws.send(JSON.stringify({ type: "response.done", response: { status: "completed", output: [{}] } }));
      }
    });
  });
  const secret = "disposable-observability-test-secret-32-characters";
  const relay = spawn(process.execPath, ["--import", "tsx", "server/openai-voice-relay.ts"], { env: { ...process.env, AZURE_OPENAI_ENDPOINT: `ws://127.0.0.1:${providerPort}`, AZURE_OPENAI_API_KEY: "disposable", OPENAI_VOICE_RELAY_PORT: String(port), VOICE_RELAY_AUTH_REQUIRED: "true", VOICE_RELAY_AUTH_SECRET: secret, VOICE_ASR_PRIMARY: "openai", DOUBAO_APP_ID: "", DOUBAO_ACCESS_TOKEN: "", AURAL_OBSERVABILITY_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let started = false; let logs = "";
  relay.stdout.on("data", data => { logs = (logs + data.toString()).slice(-8000); if (data.toString().includes("listening on")) started = true; });
  relay.stderr.on("data", data => { logs = (logs + data.toString()).slice(-8000); });
  const clients: WebSocket[] = [];
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); clients.push(ws); await once(ws, "open");
    const sessionId = randomUUID();
    const init = { type: "init", sessionId, context: { title: "Synthetic concurrency check", aiName: "Interviewer", aiTone: "FRIENDLY", language: "en", followUpDepth: "NONE", questions: [{ text: "Say hello.", type: "TEXT", order: 0 }] } };
    ws.send(JSON.stringify({ ...init, ticket: await issueRelayTicket(secret, `session:${sessionId}`, init) }));
    return ws;
  };
  try {
    await until(() => started);
    const abandoned = await connect(); await until(() => initialized === 1);
    abandoned.close(); await until(() => active === 0, 2000);
    holdSetup = false;
    let audio = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { const ws = await connect(); ws.on("message", (_data, binary) => { if (binary) audio++; }); }));
    await until(() => audio >= 6, 8000);
    assert.equal(peak, 6);
    for (const ws of clients) ws.close();
    await until(() => active === 0, 2000);
    const liveness = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(liveness.status, 200);
    assert.deepEqual(await liveness.json(), { status: "ok" });
    assert.equal((await fetch(`http://127.0.0.1:${port}/unknown`)).status, 404);
    respond = false;
    const silent = await connect(); let warned = false;
    silent.on("message", (raw, binary) => { if (!binary && JSON.parse(raw.toString()).type === "error") warned = true; });
    await until(() => warned, 18000);
    silent.close(); await until(() => active === 0, 2000);
    respond = true;
    const recovered = await connect(); let recoveredAudio = false;
    recovered.on("message", (_raw, binary) => { if (binary) recoveredAudio = true; });
    await until(() => recoveredAudio, 4000);
    recovered.close(); await until(() => active === 0, 2000);
  } catch(error) { console.error(logs); throw error; } finally {
    for (const ws of clients) ws.terminate();
    relay.kill("SIGTERM"); await once(relay, "exit");
    for (const ws of provider.clients) ws.terminate();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});
