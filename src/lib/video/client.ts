import type { VideoManifest, VideoTransport } from "./transport";
/** The invite link is the candidate credential; never send it to storage or playback APIs. */
export function videoRequestHeaders(pathname = typeof window === "undefined" ? "" : window.location.pathname): Record<string, string> {
 const match = /^\/i\/invite\/([A-Za-z0-9_-]{12,128})\/session\/?$/.exec(pathname);
 return match ? { "x-aural-video-invite": match[1] } : {};
}
export async function videoRequest(path: string, body: unknown) {
 const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",...videoRequestHeaders()},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(!response.ok) throw new Error("video_request_failed");
 return response.json();
}
export const videoTransport: VideoTransport = {
 async upload(manifest,chunk) {
  const descriptor={sequence:chunk.sequence,bytes:chunk.bytes,sha256:chunk.sha256,endMs:chunk.endMs};
  const path=`/api/session/video/${manifest.id}`;
  const grant=await videoRequest(path,{action:"upload",chunk:descriptor});
  if(grant.acknowledged) return;
  // An ambiguous response may mean the immutable object already exists. In either
  // case the authenticated acknowledgement endpoint verifies its bytes and hash.
  try {
   await fetch(grant.url,{method:"PUT",headers:{"Content-Type":"application/octet-stream"},body:chunk.blob,signal:AbortSignal.timeout(30000)});
  } catch { /* Acknowledgement resolves a lost response without overwriting an object. */ }
  await videoRequest(path,{action:"acknowledge",chunk:descriptor});
 },
 async finalize(manifest:VideoManifest) { await videoRequest(`/api/session/video/${manifest.id}`,{action:"finalize",manifest}); },
};
