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
 return <VideoRecoveryPanel uploading={video.state === "uploading"} error={error} onRetry={async()=>{setError("");try{await video.retry();}catch{setError("Upload paused. Retrying automatically when connected. Keep this browser data.");}}} />;
}

/** Presentation shared with the data-free branding preview; retry stays owned by the hook. */
export function VideoRecoveryPanel({ uploading, error, onRetry }: { uploading: boolean; error: string; onRetry: () => void }) {
 return <div className="mx-auto w-full max-w-2xl px-4 pt-4">
  <Card><CardContent className="space-y-3 p-5">
   <h2 className="text-base font-semibold">Finish uploading your recorded interview</h2>
   <p className="text-sm text-muted-foreground">Saved video chunks are still in this browser. Resume the upload here without recording again. Keep this tab open until it finishes.</p>
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
   <Button disabled={uploading} onClick={onRetry}>
    {uploading?"Uploading saved video…":"Resume video upload"}
   </Button>
  </CardContent></Card>
 </div>;
}
