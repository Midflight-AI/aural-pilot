import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_SEGMENT_BYTES, MAX_PENDING_SEGMENTS, RelayBackup, TURN_BATCH, wavFromPcm16, type BackupDelivery } from "../server/relay-backup";
import { isWav, relayTurnRows, unsavedRelayTurns } from "../src/lib/relay-backup";

const SESSION = "0b8f2f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function recorder(accept: () => boolean = () => true) {
  const delivered: BackupDelivery[] = [];
  const backup = new RelayBackup(async (delivery) => {
    if (!accept()) return false;
    delivered.push(delivery);
    return true;
  });
  return { backup, delivered };
}

test("relay backup keeps turns the receiver did not accept and sends them on the next flush", async () => {
  let online = false;
  const { backup, delivered } = recorder(() => online);
  backup.addTurn("assistant", "Tell me about your last role.", 0);
  backup.addTurn("user", "I edited video for a news site.", 0);
  await backup.flush();
  assert.equal(delivered.length, 0);

  online = true;
  await backup.flush();
  assert.equal(delivered.length, 1);
  const turns = delivered[0].kind === "turns" ? delivered[0].turns : [];
  assert.deepEqual(turns.map((t) => [t.role, t.content, t.questionIndex]), [
    ["assistant", "Tell me about your last role.", 0],
    ["user", "I edited video for a news site.", 0],
  ]);

  await backup.flush();
  assert.equal(delivered.length, 1, "accepted turns are not sent twice");
});

test("relay backup sends turns in batches the receiver accepts", async () => {
  const { backup, delivered } = recorder();
  for (let i = 0; i < TURN_BATCH + 3; i++) backup.addTurn("user", `answer ${i}`, 0);
  await backup.flush();
  assert.deepEqual(delivered.map((d) => (d.kind === "turns" ? d.turns.length : 0)), [TURN_BATCH, 3]);
});

test("relay backup cuts a minute of microphone audio into a WAV segment", async () => {
  const { backup, delivered } = recorder();
  backup.addMicAudio(Buffer.alloc(AUDIO_SEGMENT_BYTES));
  backup.addMicAudio(Buffer.alloc(3200));
  await backup.flush();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].kind, "audio");

  await backup.close();
  assert.equal(delivered.length, 2, "close sends the partial segment");
  const last = delivered[1];
  assert.ok(last.kind === "audio" && isWav(last.wav) && last.wav.length === 44 + 3200);
});

test("relay backup holds a bounded number of audio segments while offline", async () => {
  let online = false;
  const { backup, delivered } = recorder(() => online);
  for (let i = 0; i < MAX_PENDING_SEGMENTS + 2; i++) backup.addMicAudio(Buffer.alloc(AUDIO_SEGMENT_BYTES));
  await backup.flush();
  assert.equal(delivered.length, 0);
  online = true;
  await backup.flush();
  assert.equal(delivered.length, MAX_PENDING_SEGMENTS);
});

test("WAV header describes 16 kHz mono 16-bit PCM", () => {
  const wav = wavFromPcm16(Buffer.alloc(32000));
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 32000);
});

test("relay turn rows reject malformed deliveries", () => {
  const good = { id: "1b8f2f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b", role: "user", content: " hello ", questionIndex: 2, spokenAt: "2026-11-25T10:00:00.000Z" };
  assert.deepEqual(relayTurnRows(SESSION, [good]), [
    { id: good.id, session_id: SESSION, role: "user", content: "hello", question_index: 2, spoken_at: good.spokenAt },
  ]);
  assert.equal(relayTurnRows(SESSION, []), null);
  assert.equal(relayTurnRows(SESSION, [{ ...good, role: "system" }]), null);
  assert.equal(relayTurnRows(SESSION, [{ ...good, id: "not-a-uuid" }]), null);
  assert.equal(relayTurnRows(SESSION, [{ ...good, content: "   " }]), null);
  assert.equal(relayTurnRows(SESSION, [{ ...good, spokenAt: "yesterday" }]), null);
});

test("only turns spoken after the browser's last saved message are recovered", () => {
  const turns = [
    { id: "a", spoken_at: "2026-11-25T10:00:00.000Z" },
    { id: "b", spoken_at: "2026-11-25T10:05:00.000Z" },
    { id: "c", spoken_at: "2026-11-25T10:09:00.000Z" },
  ];
  assert.deepEqual(unsavedRelayTurns(turns, "2026-11-25T10:05:00.500Z").map((t) => t.id), ["c"]);
  assert.deepEqual(unsavedRelayTurns(turns, null).map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(unsavedRelayTurns(turns, "2026-11-25T10:10:00.000Z"), []);
});
