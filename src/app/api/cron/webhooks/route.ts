import { getVercelOidcToken } from "@vercel/oidc";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deliveryHeaders, deliveryOutcome, destinationUrl, sendDelivery, type Destination } from "@/lib/webhooks/delivery";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret=process.env.WEBHOOK_CRON_SECRET;
  const supplied=Buffer.from(request.headers.get('authorization') ?? '');
  const expected=Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length<32 || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return Response.json({error:'unauthorized'},{status:401});
  if(process.env.AURAL_WEBHOOKS_ENABLED!=='true') return Response.json({disabled:true});
  try {
    const destinations: Destination[]=JSON.parse(process.env.AURAL_WEBHOOK_DESTINATIONS ?? '[]');
    const allowlist: string[]=JSON.parse(process.env.AURAL_WEBHOOK_ALLOWED_URLS ?? '[]');
    if(!Array.isArray(destinations)||destinations.length>10||!Array.isArray(allowlist)) throw new Error('CONFIGURATION');
    const token=randomUUID();
    const {data,error}=await supabaseAdmin.rpc('claim_webhook_deliveries',{p_token:token});
    if(error) throw new Error('QUEUE_UNAVAILABLE');
    let delivered=0,failed=0;
    for(const row of data ?? []) {
      let status:number|null=null; let retryAfter:string|undefined; let configurationFailure=false;
      const destination=destinations.find(d=>d.id===row.subscription_id);
      try {
        if(!destination || destination.projectId!==row.payload.project_id || typeof destination.secret!=='string' || destination.secret.length<32 || !/^[a-zA-Z0-9_-]{1,128}$/.test(destination.keyId) || !(Date.parse(destination.expiresAt)>Date.now())) { configurationFailure=true; throw new Error('CONFIGURATION'); }
        let url:URL;
        try {url=destinationUrl(destination.url,allowlist);} catch {configurationFailure=true; throw new Error('CONFIGURATION');}
        const body=JSON.stringify(row.payload);
        const headers: Record<string,string> = deliveryHeaders(body,row.event_id,destination);
        if(destination.vercelTrustedSource) headers["x-vercel-trusted-oidc-idp-token"] = await getVercelOidcToken();
        const response=await sendDelivery(url,body,headers);
        status=response.status;retryAfter=response.retryAfter;
      } catch { /* Never log upstream content, credentials or transport URLs. */ }
      const outcome=configurationFailure ? {state:'dead',code:'CONFIGURATION',delay:86400} : deliveryOutcome(status,row.attempts,retryAfter);
      const finished=await supabaseAdmin.rpc('finish_webhook_delivery',{p_subscription:row.subscription_id,p_event:row.event_id,p_token:token,p_state:outcome.state,p_code:outcome.code,p_status:status,p_delay:outcome.delay});
      if(finished.error || finished.data!==true) throw new Error('LEASE_OR_QUEUE_FAILURE');
      if(outcome.state==='delivered') delivered++; else failed++;
    }
    return Response.json({delivered,failed});
  } catch { return Response.json({error:'WEBHOOK_WORKER_FAILED'},{status:503}); }
}
