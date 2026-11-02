import { apiError, isAuthError, validateApiKey } from '@/lib/api-key-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sessionSnapshot } from '@/lib/session-snapshot';
export async function GET(request: Request, {params}: {params:Promise<{id:string}>}) {
  const auth = await validateApiKey(request);
  if (isAuthError(auth)) return auth;
  const {id} = await params;
  // PostgREST embeds the children in the same SQL statement/MVCC snapshot.
  const {data, error} = await supabaseAdmin.from('sessions').select('id,sync_revision,status,summary,insights,themes,sentiment,totalDurationSeconds,audioRecordingUrl,audioRecordings,interview:interviews!inner(id,title,projectId),messages(id,role,content,timestamp)').eq('id',id).in('interview.projectId',auth.projectIds).order('timestamp',{referencedTable:'messages',ascending:true}).order('id',{referencedTable:'messages',ascending:true}).maybeSingle();
  if (error) return apiError('INTERNAL_ERROR','Snapshot unavailable.',500);
  if (!data) return apiError('NOT_FOUND','Session not found.',404);
  return Response.json({data:sessionSnapshot(data)}, {headers:{'Cache-Control':'private, no-store'}});
}
