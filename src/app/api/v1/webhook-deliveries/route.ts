import { apiError,isAuthError,validateApiKey } from '@/lib/api-key-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { deliveryQuery,decodeDeliveryCursor,encodeDeliveryCursor } from '@/lib/webhooks/api';
export async function GET(request:Request) {
  const auth=await validateApiKey(request); if(isAuthError(auth)) return auth;
  const parsed=deliveryQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success) return apiError('INVALID_REQUEST','A subscription and valid page size are required.',400);
  let cursor; try {cursor=decodeDeliveryCursor(parsed.data.cursor);} catch {return apiError('INVALID_REQUEST','Invalid cursor.',400);}
  const {data,error}=await supabaseAdmin.rpc('list_webhook_deliveries',{p_projects:auth.projectIds,p_subscription:parsed.data.subscription_id,p_before:cursor?.at ?? null,p_event:cursor?.id ?? null,p_limit:parsed.data.limit+1});
  if(error) return apiError('INTERNAL_ERROR','Delivery history unavailable.',500);
  const rows=data ?? []; const more=rows.length>parsed.data.limit; const page=rows.slice(0,parsed.data.limit);
  return Response.json({data:page,cursor:more ? encodeDeliveryCursor(page[page.length-1]) : null},{headers:{'Cache-Control':'private, no-store'}});
}
