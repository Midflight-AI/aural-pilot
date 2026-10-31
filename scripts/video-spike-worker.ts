/** Operator entry point for the same processor used by Vercel. */
import { createClient } from "@supabase/supabase-js";
import { processVideoQueue } from "../src/lib/video/processor";
import { videoDatabaseAllowed } from "../src/lib/video/isolation";
async function main() {
 const id = process.argv[2];
 if (process.argv.includes("--retry")) {
  const url = process.env.SUPABASE_URL;
  if (!url || !videoDatabaseAllowed(url,process.env.AURAL_VIDEO_SPIKE_DATABASE_REF,process.env.VERCEL_ENV??process.env.AURAL_VIDEO_ENVIRONMENT) || process.env.AURAL_VIDEO_SPIKE_ENABLED!=="true" || !id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("video_environment_not_configured");
  const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("video_spike_retry",{p_id:id});
  if(error||!data) throw new Error("retry_not_accepted");
 }
 await processVideoQueue(id);
}
main().catch(()=>{console.error("video_worker_unavailable");process.exitCode=1;});
