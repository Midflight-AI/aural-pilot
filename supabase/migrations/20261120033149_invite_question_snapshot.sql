alter table public.candidates add column "followUpQuestions" jsonb not null default '[]'
 check (jsonb_typeof("followUpQuestions") = 'array' and jsonb_array_length("followUpQuestions") <= 5);
alter table public.sessions add column "questionPlan" jsonb;

create or replace function public.create_api_invites(p_actor uuid, p_interview uuid, p_key text, p_rows jsonb)
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
  insert into candidates("interviewId",name,email,phone,notes,gender,birthday,education,school,major,"graduationYear","workExperience","inviteToken","inviteExpiresAt","followUpQuestions")
  values(p_interview,item->>'name',item->>'email',item->>'phone',item->>'notes',item->>'gender',item->>'birthday',item->>'education',item->>'school',item->>'major',(item->>'graduationYear')::int,item->>'workExperience',replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),(item->>'inviteExpiresAt')::timestamptz,coalesce(item->'followUpQuestions','[]'::jsonb)) returning * into c;
  result := result || jsonb_build_array(to_jsonb(c));
 end loop;
 insert into api_idempotency(actor_id,scope,key,request,response) values(p_actor,scope_key,p_key,p_rows,result);
 return result;
end $$;

create or replace function public.create_invite_session(p_invite_token text,p_mode_used "InterviewMode" default 'CHAT',p_current_question_id uuid default null)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare c candidates; i interviews; s sessions; plan jsonb; begin
 select * into c from candidates where "inviteToken"=p_invite_token for update;
 if not found then raise exception 'Invalid invite link'; end if;
 if c."sessionId" is not null then
  select * into s from sessions where id=c."sessionId"; return row_to_json(s);
 end if;
 if c."inviteStatus" <> 'active' or c."inviteExpiresAt" <= now() then raise exception 'Invitation is cancelled or expired'; end if;
 select * into i from interviews where id=c."interviewId";
 if not found or not i."isActive" then raise exception 'Interview not available'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q."order", q.id), '[]'::jsonb)
 into plan from questions q where q."interviewId" = i.id;
 select plan || coalesce(jsonb_agg(jsonb_build_object(
   'id', gen_random_uuid(), 'order', coalesce((plan->-1->>'order')::int, -1) + n,
   'text', question, 'type', 'OPEN_ENDED', 'source', 'invite', 'isRequired', true,
   'probeOnShort', false, 'options', jsonb_build_object('maxFollowUps', 0)
 ) order by n), '[]'::jsonb) into plan
 from jsonb_array_elements_text(c."followUpQuestions") with ordinality as f(question,n);
 insert into sessions("interviewId","participantName","participantEmail","modeUsed","currentQuestionId","questionPlan")
 values(i.id,c.name,c.email,coalesce(p_mode_used,i.mode),(plan->0->>'id')::uuid,jsonb_build_object('questions',plan,'assessmentCriteria',i."assessmentCriteria")) returning * into s;
 update candidates set "sessionId"=s.id,"updatedAt"=now() where id=c.id;
 return row_to_json(s);
end $$;
