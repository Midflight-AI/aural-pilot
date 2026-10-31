"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { canCaptureVideo,WebcamCapture,VIDEO_MIME } from "@/lib/video/capture";
import { clearVideoManifest,recoverVideoManifests,videoStore } from "@/lib/video/store";
import { VideoUploadQueue,type VideoManifest } from "@/lib/video/transport";
import { videoRequest,videoRequestHeaders,videoTransport } from "@/lib/video/client";

export function useVideoSpike(sessionId:string,onInterrupted:()=>void, consent = false) {
 const [enabled,setEnabled]=useState(false);
 const [state,setState]=useState<"idle"|"capturing"|"uploading"|"processing"|"attention">("idle");
 const [camera,setCamera]=useState<MediaStream|null>(null);
 const [recovery,setRecovery]=useState<VideoManifest[]>([]);
 const retryTaskRef=useRef<Promise<void>|null>(null);
 const captureRef=useRef<WebcamCapture|null>(null);
 const queueRef=useRef<VideoUploadQueue|null>(null);
 const preparedRef=useRef<{camera:MediaStream;queue:VideoUploadQueue}|null>(null);
 const interruptionRef=useRef(onInterrupted);
 interruptionRef.current=onInterrupted;
 useEffect(()=>{
  let cancelled=false;
  fetch(`/api/session/video?sessionId=${encodeURIComponent(sessionId)}`,{cache:"no-store",headers:videoRequestHeaders()}).then(async response=>{
   if(!response.ok||cancelled) return;
   setEnabled(true);
   const manifests=await recoverVideoManifests(sessionId);
   if(!cancelled) setRecovery(manifests);
  }).catch(()=>{});
  return()=>{cancelled=true;};
 },[sessionId]);
 const prepare=useCallback(async()=>{
  if(preparedRef.current?.camera.getVideoTracks()[0]?.readyState === "live") return;
  if(!enabled||!consent) return;
  const emptyAttempt=recovery.length===1 && !recovery[0].sealed && recovery[0].chunks.length===0 ? recovery[0] : null;
  if(recovery.length && !emptyAttempt && !preparedRef.current) throw new Error("Recover the existing recording before starting another interview.");
  if(!canCaptureVideo()) throw new Error("This video preview needs desktop Chrome or Edge with local storage available.");
  let cam:MediaStream|null=null;
  try {
   cam=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}},audio:false});
   if(preparedRef.current) {
    preparedRef.current={camera:cam,queue:preparedRef.current.queue};setCamera(cam);return;
   }
   const manifest:VideoManifest=emptyAttempt ?? {id:crypto.randomUUID(),sessionId,generation:1,mimeType:VIDEO_MIME,chunks:[],sealed:false,partial:false};
   // Persist the stable ID before a network write can have an ambiguous outcome.
   await videoStore.saveManifest(manifest);
   setRecovery([manifest]);
   await videoRequest("/api/session/video",{id:manifest.id,sessionId,consent:true,consentVersion:"internal-video-spike-v1"});
   const queue=new VideoUploadQueue(manifest,videoStore,videoTransport,()=>captureRef.current?.interrupt());
   queueRef.current=queue;
   preparedRef.current={camera:cam,queue};setCamera(cam);
  } catch(error) {cam?.getTracks().forEach(track=>track.stop());setState("attention");throw error;}
 },[enabled,consent,recovery,sessionId]);
 const start=useCallback(async(mixed:MediaStream)=>{
  const prepared=preparedRef.current;
  if(!prepared) throw new Error("Camera preparation is required.");
  const capture=new WebcamCapture(prepared.camera,mixed,prepared.queue,()=>{setState("attention");interruptionRef.current();},()=>setState("attention"),()=>setState("capturing"));
  captureRef.current=capture;capture.start();setState("capturing");
 },[]);
 const finish=useCallback(async()=>{
  if(!captureRef.current) return;
  setState("uploading");
  try {
   await captureRef.current.stop();
   if(queueRef.current) await clearVideoManifest(queueRef.current.manifest.id);
   setRecovery([]);setState("processing");setCamera(null);
  } catch {setState("attention");throw new Error("Video upload needs recovery.");}
 },[]);
 const retry=useCallback(()=>{
  if(retryTaskRef.current) return retryTaskRef.current;
  retryTaskRef.current=(async()=>{
  setState("uploading");
  try {
   for(const manifest of await recoverVideoManifests(sessionId)) {
    // Reauthorize a possibly lost start response using the original ID and consent.
    await videoRequest("/api/session/video",{id:manifest.id,sessionId,consent:true,consentVersion:"internal-video-spike-v1"});
    const queue=new VideoUploadQueue(manifest,videoStore,videoTransport,()=>{});
    if(!manifest.sealed) await queue.seal(true); // Reload loses the undelivered tail.
    await queue.retry();await clearVideoManifest(manifest.id);
   }
   setRecovery([]);setState("processing");
  } catch {setState("attention");throw new Error("Recording still needs recovery. Keep this browser data and retry.");}
  })().finally(()=>{retryTaskRef.current=null;});
  return retryTaskRef.current;
 },[sessionId]);
 useEffect(()=>{
  if(state!=="attention" || captureRef.current?.isRecording()) return;
  const resume=()=>{if(navigator.onLine) void retry().catch(()=>{});};
  const timer=setInterval(resume,15000);
  window.addEventListener("online",resume);
  return()=>{clearInterval(timer);window.removeEventListener("online",resume);};
 },[state,retry]);
 useEffect(()=>()=>{captureRef.current?.interrupt();if(!captureRef.current) preparedRef.current?.camera.getTracks().forEach(track=>track.stop());},[]);
 const releasePreparedCamera=useCallback(()=>{
  if(captureRef.current) return;
  preparedRef.current?.camera.getTracks().forEach(track=>track.stop());setCamera(null);
 },[]);
 return {prepared:()=>!!preparedRef.current,releasePreparedCamera,enabled,consent,state,camera,recovery,prepare,start,finish,retry,active:()=>!!captureRef.current};
}
