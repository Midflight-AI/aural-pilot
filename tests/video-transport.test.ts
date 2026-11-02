import { test } from "node:test";
import assert from "node:assert/strict";
import { VideoUploadQueue, validateManifest, recoverStoredVideo, type VideoManifest, type PendingChunk, type VideoStore } from "../src/lib/video/transport";

function fixture() {
  const manifest: VideoManifest = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(), generation: 1, mimeType: "video/webm;codecs=vp8,opus", chunks: [], sealed: false, partial: false };
  const chunks = new Map<number, PendingChunk>();
  let saved: VideoManifest | undefined;
  const store: VideoStore = {
    async put(_id, chunk, m) { chunks.set(chunk.sequence, chunk); saved = structuredClone(m); },
    async saveManifest(m) { saved = structuredClone(m); },
    async pending() { return [...chunks.values()].sort((a, b) => a.sequence - b.sequence); },
    async acknowledge(_id, sequence) { chunks.delete(sequence); },
  };
  return { manifest, chunks, store, saved: () => saved };
}

test("lost upload acknowledgement retries identical bytes and finalizes only after every acknowledgement", async () => {
  const f = fixture();
  const uploaded = new Map<number, string>();
  let loseAck = true;
  let finalizations = 0;
  const transport = {
    async upload(_m: VideoManifest, chunk: PendingChunk) {
      const prior = uploaded.get(chunk.sequence);
      if (prior) assert.equal(prior, chunk.sha256);
      uploaded.set(chunk.sequence, chunk.sha256);
      if (loseAck) { loseAck = false; throw new Error("offline"); }
    },
    async finalize(m: VideoManifest) { assert.equal(uploaded.size, m.chunks.length); finalizations++; },
  };
  const queue = new VideoUploadQueue(f.manifest, f.store, transport, () => assert.fail("unexpected limit"));
  const first = queue.append(new Blob(["container header"]), 5000);
  const last = queue.append(new Blob(["container tail"]), 8000);
  await queue.seal();
  await Promise.all([first, last]);
  await assert.rejects(queue.retry(), /offline/);
  assert.equal(finalizations, 0);
  assert.equal(f.chunks.size, 1);
  // New queue instance demonstrates reload recovery of persisted manifest + pending bytes.
  const recovered = new VideoUploadQueue(f.saved()!, f.store, transport, () => assert.fail());
  await recovered.retry();
  assert.equal(f.chunks.size, 0);
  assert.equal(finalizations, 1);
  assert.deepEqual([...uploaded.keys()], [0, 1]);
  await recovered.retry();
  assert.equal(uploaded.size, 2);
});

test("a 60 second backlog stops capture and seals partial evidence", async () => {
  const f = fixture();
  const limits: string[] = [];
  const queue = new VideoUploadQueue(f.manifest, f.store, { async upload() { throw new Error("offline"); }, async finalize() {} }, (code) => limits.push(code));
  await queue.append(new Blob(["header"]), 5000);
  await queue.append(new Blob(["tail"]), 60000);
  await queue.seal();
  assert.deepEqual(limits, ["backlog_limit"]);
  assert.equal(f.saved()!.partial, true);
  assert.equal(f.saved()!.failureCode, "backlog_limit");
});

test("missing sequence, duplicate sequence, invalid hash and unsupported containers fail closed", () => {
  const f = fixture();
  const valid = { ...f.manifest, sealed: true, chunks: [{ sequence: 0, bytes: 10, sha256: "a".repeat(64), endMs: 5000 }] };
  validateManifest(valid);
  assert.throws(() => validateManifest({ ...valid, chunks: [{ ...valid.chunks[0], sequence: 1 }] }));
  assert.throws(() => validateManifest({ ...valid, chunks: [...valid.chunks, ...valid.chunks] }));
  assert.throws(() => validateManifest({ ...valid, chunks: [{ ...valid.chunks[0], sha256: "wrong" }] }));
  assert.throws(() => validateManifest({ ...valid, mimeType: "video/mp4" }));
});

test("local persistence failure cannot silently finalize complete", async () => {
  const f = fixture();
  f.store.put = async () => { throw new Error("quota exceeded"); };
  const limits: string[] = [];
  const queue = new VideoUploadQueue(f.manifest, f.store, { async upload() {}, async finalize() { assert.fail(); } }, code => limits.push(code));
  await queue.append(new Blob(["header"]), 5000);
  await assert.rejects(queue.seal(), /local_storage_failed/);
  assert.equal(f.manifest.partial, true);
  assert.deepEqual(limits, ["local_storage_failed"]);
});

test("an oversized callback is rejected before buffering media", async () => {
 const f=fixture(); const limits:string[]=[];
 const queue=new VideoUploadQueue(f.manifest,f.store,{async upload(){},async finalize(){}},code=>limits.push(code));
 await queue.append(new Blob([new Uint8Array(21*1024*1024)]),5000);
 assert.equal(f.chunks.size,0);assert.deepEqual(limits,["backlog_limit"]);assert.equal(f.manifest.partial,true);
});

test("final chunk appended during an upload is acknowledged before finalization", async () => {
 const f=fixture();
 let release!:()=>void;
 let started!:()=>void;
 const uploading=new Promise<void>(resolve=>{started=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const sent:number[]=[];
 const queue=new VideoUploadQueue(f.manifest,f.store,{
  async upload(_m,chunk){if(chunk.sequence===0){started();await gate;}sent.push(chunk.sequence);},
  async finalize(m){assert.equal(f.chunks.size,0);assert.equal(sent.length,m.chunks.length);},
 },()=>assert.fail());
 await queue.append(new Blob(["first"]),5000);
 const inFlight=queue.drain();await uploading;
 await queue.append(new Blob(["last"]),8000);await queue.seal();
 const finishing=queue.retry();release();
 await Promise.all([inFlight,finishing]);
 assert.deepEqual(sent,[0,1]);
});


test("uploads are bounded and failed batches settle before retry or finalization", async () => {
 const f=fixture(); let active=0; let peak=0; let finalized=0; let fail=true;
 const queue=new VideoUploadQueue(f.manifest,f.store,{
  async upload(_m,chunk){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,chunk.sequence===0?1:10));active--;if(chunk.sequence===0&&fail)throw new Error("lost connection");},
  async finalize(){assert.equal(active,0);assert.equal(f.chunks.size,0);finalized++;},
 },()=>assert.fail());
 for(let i=0;i<7;i++)await queue.append(new Blob([String(i)]),(i+1)*5000);
 await queue.seal();await assert.rejects(queue.retry(),/lost connection/);
 assert.equal(active,0);assert.equal(peak,3);assert.equal(finalized,0);assert.equal(f.chunks.size,5);
 fail=false;await queue.retry();assert.equal(finalized,1);assert.equal(peak,3);
});


test("retry after setup outage preserves an empty reservation for a later capture", async () => {
 const f=fixture();let uploads=0;let finalizations=0;
 await f.store.saveManifest(f.manifest);
 const transport={async upload(){uploads++;},async finalize(){finalizations++;}};
 assert.equal(await recoverStoredVideo(f.manifest,f.store,transport),false);
 assert.equal(f.manifest.sealed,false);assert.equal(f.manifest.partial,false);
 assert.equal(f.saved()!.id,f.manifest.id);assert.equal(finalizations,0);
 const capture=new VideoUploadQueue(f.manifest,f.store,transport,()=>assert.fail());
 await capture.append(new Blob(["fresh container"]),5000);await capture.seal();await capture.retry();
 assert.equal(uploads,1);assert.equal(finalizations,1);
});

test("reload recovery seals real interrupted media as partial and preserves failed uploads", async () => {
 const f=fixture();let offline=true;let finalized=0;
 const transport={async upload(){if(offline)throw new Error("offline");},async finalize(m:VideoManifest){assert.equal(m.partial,true);finalized++;}};
 const capture=new VideoUploadQueue(f.manifest,f.store,transport,()=>assert.fail());
 await capture.append(new Blob(["surviving chunk"]),5000);
 await assert.rejects(recoverStoredVideo(f.saved()!,f.store,transport),/offline/);
 assert.equal(f.saved()!.sealed,true);assert.equal(f.saved()!.partial,true);assert.equal(f.chunks.size,1);assert.equal(finalized,0);
 offline=false;assert.equal(await recoverStoredVideo(f.saved()!,f.store,transport),true);
 assert.equal(f.chunks.size,0);assert.equal(finalized,1);
});
