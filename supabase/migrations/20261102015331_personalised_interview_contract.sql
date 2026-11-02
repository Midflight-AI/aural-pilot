-- Atomic optional questions and bounded per-question follow-ups. Existing replay payloads are unchanged.
create or replace function public.create_api_interview(p_actor uuid,p_project uuid,p_key text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior api_idempotency; i interviews; q jsonb; n integer:=0; scope_key text:='interviews:'||p_project; begin
 if length(p_key) not between 8 and 128 then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||scope_key||':'||p_key,0));
 select * into prior from api_idempotency where actor_id=p_actor and scope=scope_key and key=p_key;
 if found then
  if prior.request<>p_input then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.response;
 end if;
 insert into interviews(title,description,objective,"assessmentCriteria","userId","projectId","chatEnabled","voiceEnabled","videoEnabled","aiName","aiTone","followUpDepth",language,"timeLimitMinutes","antiCheatingEnabled","requireInvite","publicSlug")
 values(p_input->>'title',p_input->>'description',p_input->>'objective',p_input->'assessmentCriteria',p_actor,p_project,
 (p_input->>'chatEnabled')::boolean,(p_input->>'voiceEnabled')::boolean,(p_input->>'videoEnabled')::boolean,p_input->>'aiName',(p_input->>'aiTone')::"ToneLevel",(p_input->>'followUpDepth')::"FollowUpDepth",p_input->>'language',(p_input->>'timeLimitMinutes')::int,(p_input->>'antiCheatingEnabled')::boolean,true,replace(gen_random_uuid()::text,'-','')) returning * into i;
 if jsonb_typeof(p_input->'questions') <> 'array' then raise exception 'INVALID_QUESTIONS'; end if;
 for q in select value from jsonb_array_elements(coalesce(p_input->'questions','[]'::jsonb)) loop
  if q ? 'maxFollowUps' and ((q->>'maxFollowUps')::integer not between 0 and 2) then raise exception 'INVALID_FOLLOW_UP_LIMIT'; end if;
  insert into questions("interviewId","order",text,type,"isRequired","probeOnShort",options) values(i.id,n,q->>'text','OPEN_ENDED',coalesce((q->>'isRequired')::boolean,true),coalesce((q->>'maxFollowUps')::integer>0,true),case when q ? 'maxFollowUps' then jsonb_build_object('maxFollowUps',(q->>'maxFollowUps')::integer) else null end);
  n:=n+1;
 end loop;
 insert into api_idempotency(actor_id,scope,key,request,response) values(p_actor,scope_key,p_key,p_input,to_jsonb(i));
 return to_jsonb(i);
end $$;
revoke all on function public.create_api_interview(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_api_interview(uuid,uuid,text,jsonb) to service_role;
