-- Pre-start invitation controls. Existing sessions and retained evidence are untouched.
alter table public.candidates add column "inviteStatus" text not null default 'active' check ("inviteStatus" in ('active','cancelled','expired'));
alter table public.candidates add column "inviteExpiresAt" timestamptz;
alter table public.candidates add column "inviteVersion" integer not null default 1 check ("inviteVersion" > 0);
create table public.api_idempotency (
 actor_id uuid not null references auth.users(id) on delete cascade,
 scope text not null, key text not null, request jsonb not null, response jsonb not null,
 created_at timestamptz not null default now(), primary key(actor_id,scope,key)
);
alter table public.api_idempotency enable row level security;
revoke all on public.api_idempotency from public, anon, authenticated;
grant all on public.api_idempotency to service_role;

create function public.create_api_invites(p_actor uuid, p_interview uuid, p_key text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare prior api_idempotency; result jsonb; item jsonb; c candidates; scope_key text := 'candidates:'||p_interview; begin
 if length(p_key) not between 8 and 128 or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||scope_key||':'||p_key,0));
 select * into prior from api_idempotency where actor_id=p_actor and scope=scope_key and key=p_key;
 if found then
  if prior.request <> p_rows then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.response;
 end if;
 result := '[]'::jsonb;
 for item in select value from jsonb_array_elements(p_rows) loop
  if item->>'name' is null or length(trim(item->>'name'))=0 then raise exception 'INVALID_REQUEST'; end if;
  if item->>'inviteExpiresAt' is not null and (item->>'inviteExpiresAt')::timestamptz <= now() then raise exception 'INVALID_EXPIRY'; end if;
  insert into candidates("interviewId",name,email,phone,notes,gender,birthday,education,school,major,"graduationYear","workExperience","inviteToken","inviteExpiresAt")
  values(p_interview,item->>'name',item->>'email',item->>'phone',item->>'notes',item->>'gender',item->>'birthday',item->>'education',item->>'school',item->>'major',(item->>'graduationYear')::int,item->>'workExperience',replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),(item->>'inviteExpiresAt')::timestamptz) returning * into c;
  result := result || jsonb_build_array(to_jsonb(c));
 end loop;
 insert into api_idempotency(actor_id,scope,key,request,response) values(p_actor,scope_key,p_key,p_rows,result);
 return result;
end $$;

create function public.change_api_invite(p_actor uuid,p_interview uuid,p_candidate uuid,p_key text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare prior api_idempotency; c candidates; scope_key text := 'invite:'||p_candidate; action text := p_request->>'action'; result jsonb; begin
 if length(p_key) not between 8 and 128 or action not in ('cancel','expire','reissue') then raise exception 'INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||scope_key||':'||p_key,0));
 select * into prior from api_idempotency where actor_id=p_actor and scope=scope_key and key=p_key;
 if found then
  if prior.request <> p_request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.response;
 end if;
 select * into c from candidates where id=p_candidate and "interviewId"=p_interview for update;
 if not found then raise exception 'INVITE_NOT_FOUND'; end if;
 if c."sessionId" is not null then raise exception 'INTERVIEW_ALREADY_STARTED'; end if;
 if c."inviteVersion" <> (p_request->>'version')::int then raise exception 'INVITE_VERSION_CONFLICT'; end if;
 if action='reissue' and ((p_request->>'expiresAt') is null or (p_request->>'expiresAt')::timestamptz <= now()) then raise exception 'INVALID_EXPIRY'; end if;
 update candidates set "inviteStatus"=case action when 'cancel' then 'cancelled' when 'expire' then 'expired' else 'active' end,
 "inviteToken"=case when action='reissue' then replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') else "inviteToken" end,
 "inviteExpiresAt"=case when action='reissue' then (p_request->>'expiresAt')::timestamptz when action='expire' then now() else "inviteExpiresAt" end,
 "inviteVersion"="inviteVersion"+1,"updatedAt"=now() where id=c.id returning * into c;
 result:=to_jsonb(c);
 insert into api_idempotency(actor_id,scope,key,request,response) values(p_actor,scope_key,p_key,p_request,result);
 return result;
end $$;

-- Lock the invite before checking validity and linking a session: double starts
-- and cancellation versus start are serialized, not application-level guesses.
create or replace function public.create_invite_session(p_invite_token text,p_mode_used "InterviewMode" default 'CHAT',p_current_question_id uuid default null)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare c candidates; i interviews; s sessions; begin
 select * into c from candidates where "inviteToken"=p_invite_token for update;
 if not found then raise exception 'Invalid invite link'; end if;
 if c."sessionId" is not null then
  select * into s from sessions where id=c."sessionId"; return row_to_json(s);
 end if;
 if c."inviteStatus" <> 'active' or c."inviteExpiresAt" <= now() then raise exception 'Invitation is cancelled or expired'; end if;
 select * into i from interviews where id=c."interviewId";
 if not found or not i."isActive" then raise exception 'Interview not available'; end if;
 insert into sessions("interviewId","participantName","participantEmail","modeUsed","currentQuestionId")
 values(i.id,c.name,c.email,coalesce(p_mode_used,i.mode),p_current_question_id) returning * into s;
 update candidates set "sessionId"=s.id,"updatedAt"=now() where id=c.id;
 return row_to_json(s);
end $$;
revoke all on function public.create_api_invites(uuid,uuid,text,jsonb), public.change_api_invite(uuid,uuid,uuid,text,jsonb),public.create_invite_session(text,"InterviewMode",uuid) from public,anon,authenticated;
grant execute on function public.create_api_invites(uuid,uuid,text,jsonb), public.change_api_invite(uuid,uuid,uuid,text,jsonb),public.create_invite_session(text,"InterviewMode",uuid) to service_role;

-- Template plus initial questions commit together, so a lost response can be replayed.
create function public.create_api_interview(p_actor uuid,p_project uuid,p_key text,p_input jsonb)
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
 for q in select value from jsonb_array_elements(coalesce(p_input->'questions','[]'::jsonb)) loop
  insert into questions("interviewId","order",text,type,"isRequired","probeOnShort") values(i.id,n,q->>'text','OPEN_ENDED',true,true);
  n:=n+1;
 end loop;
 insert into api_idempotency(actor_id,scope,key,request,response) values(p_actor,scope_key,p_key,p_input,to_jsonb(i));
 return to_jsonb(i);
end $$;
revoke all on function public.create_api_interview(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_api_interview(uuid,uuid,text,jsonb) to service_role;
