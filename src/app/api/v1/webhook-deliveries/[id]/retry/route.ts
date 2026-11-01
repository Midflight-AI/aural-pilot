import { z } from 'zod';
import { apiError,isAuthError,validateApiKey } from '@/lib/api-key-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { retryRequest } from '@/lib/webhooks/api';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const auth=await validateApiKey(request); if(isAuthError(auth)) return auth;
  const {id}=await params; if(!z.uuid().safeParse(id).success) return apiError('INVALID_REQUEST','Invalid delivery.',400);
  // Small fixed request: no payload, destination, or signing key is accepted.
  const raw=await request.text(); if(raw.length>1024) return apiError('INVALID_REQUEST','Request too large.',413);
  let body; try {body=retryRequest.parse(JSON.parse(raw));} catch {return apiError('INVALID_REQUEST','A subscription and retry request ID are required.',400);}
  const {data,error}=await supabaseAdmin.rpc('request_webhook_retry',{p_projects:auth.projectIds,p_subscription:body.subscription_id,p_event:id,p_request:body.request_id,p_actor:auth.userId});
  if(error) return apiError('INTERNAL_ERROR','Retry could not be confirmed. Reuse the same request ID.',500);
  if(data==='not_found') return apiError('NOT_FOUND','Delivery not found.',404);
  if(data==='disabled' || data==='in_progress' || data==='request_conflict') return apiError('CONFLICT','Delivery is disabled, busy, or the request ID was already used.',409);
  return Response.json({data:{status:data}}, {status:data==='queued'?202:200,headers:{'Cache-Control':'private, no-store'}});
}
