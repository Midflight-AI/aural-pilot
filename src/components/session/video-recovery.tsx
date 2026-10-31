"use client";
import { useState } from "react";
import { useVideoSpike } from "@/hooks/use-video-spike";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Recovery remains reachable after reload, even when the interview is complete. */
export function VideoRecovery({sessionId}:{sessionId:string}) {
 const video=useVideoSpike(sessionId,()=>{});
 const [error,setError]=useState("");
 if(!video.recovery.some(manifest=>manifest.chunks.length>0||manifest.sealed)) return null;
 return <div className="mx-auto w-full max-w-2xl px-4 pt-4">
  <Card><CardContent className="space-y-3 p-5">
   <p className="text-sm font-medium">Finish uploading your recorded interview</p>
   <p className="text-xs text-muted-foreground">Saved video chunks are still in this browser. Resume the upload here without recording again. Keep this tab open until it finishes.</p>
   {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
   <Button disabled={video.state==="uploading"} onClick={async()=>{setError("");try{await video.retry();}catch{setError("Upload paused. Retrying automatically when connected. Keep this browser data.");}}}>
    {video.state==="uploading"?"Uploading saved video…":"Resume video upload"}
   </Button>
  </CardContent></Card>
 </div>;
}
