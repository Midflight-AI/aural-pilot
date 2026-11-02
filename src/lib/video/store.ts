import type { PendingChunk, VideoManifest, VideoStore } from "./transport";

const DATABASE = "aural-video-spike-v1";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("manifests", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["id", "sequence"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("local_storage_unavailable"));
    request.onblocked = () => reject(new Error("local_storage_blocked"));
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(new Error("local_storage_failed"));
      run(tx, (result) => { value = result; });
    });
  } finally { db.close(); }
}
export const videoStore: VideoStore = {
  saveManifest: (manifest) => transaction<void>(["manifests"], "readwrite", (tx) => { tx.objectStore("manifests").put(manifest); }),
  put: (id, chunk, manifest) => transaction<void>(["chunks", "manifests"], "readwrite", (tx) => {
    tx.objectStore("chunks").put({ ...chunk, id });
    tx.objectStore("manifests").put(manifest);
  }),
  pending: (id) => transaction<PendingChunk[]>(["chunks"], "readonly", (tx, result) => {
    const request = tx.objectStore("chunks").getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    request.onsuccess = () => result(request.result);
  }),
  acknowledge: (id, sequence) => transaction<void>(["chunks"], "readwrite", (tx) => { tx.objectStore("chunks").delete([id, sequence]); }),
};
export function recoverVideoManifests(sessionId: string): Promise<VideoManifest[]> {
  return transaction<VideoManifest[]>(["manifests"], "readonly", (tx, result) => {
    const request = tx.objectStore("manifests").getAll();
    request.onsuccess = () => result(request.result.filter((m: VideoManifest) => m.sessionId === sessionId));
  });
}
export function clearVideoManifest(id: string): Promise<void> {
  return transaction<void>(["manifests", "chunks"], "readwrite", (tx) => {
    tx.objectStore("manifests").delete(id);
    tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
}
