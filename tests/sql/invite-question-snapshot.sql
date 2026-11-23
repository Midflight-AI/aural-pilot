-- Fictional records. Run only on an isolated preview.
begin;
do $$
declare actor uuid; project uuid; interview uuid; invite jsonb; plan jsonb;
  question text; plans jsonb[] := '{}'; batch jsonb; replay jsonb; item jsonb;
begin
  select "createdBy",id into strict actor,project from public.projects order by "createdAt" limit 1;
  interview := (public.create_api_interview(actor, project, 'bug18-payroll-role',
    '{"title":"AU Payroll Officer","voiceEnabled":true,"chatEnabled":false,"videoEnabled":false,"aiName":"Tester","aiTone":"FRIENDLY","followUpDepth":"LIGHT","language":"en","antiCheatingEnabled":false,"assessmentCriteria":[{"name":"Accuracy","description":"Explains reconciliation controls"}],"questions":[{"text":"How do you reconcile a payroll run?"},{"text":"How do you check award rates?"}]}')->>'id')::uuid;
  foreach question in array array['How did you reconcile your fortnightly payroll in Xero?', 'How did you check award changes in your weekly pay run?', null] loop
    if cardinality(plans) = 1 then
      update public.questions set text='Changed core' where "interviewId"=interview and "order"=0;
      update public.interviews set "assessmentCriteria"='[]' where id=interview;
    elsif cardinality(plans) = 2 then
      update public.questions set text='How do you reconcile a payroll run?' where "interviewId"=interview and "order"=0;
      update public.interviews set "assessmentCriteria"='[{"name":"Accuracy"}]' where id=interview;
    end if;
    item := jsonb_build_object('name',case cardinality(plans) when 0 then 'Fictional Alex' when 1 then 'Fictional Lee' else 'Legacy fixture' end);
    if question is not null then item := item || jsonb_build_object('followUpQuestions', jsonb_build_array(question)); end if;
    batch := jsonb_build_array(item);
    invite := public.create_api_invites(actor,interview,'bug18-attempt-'||cardinality(plans),batch);
    replay := public.create_api_invites(actor,interview,'bug18-attempt-'||cardinality(plans),batch);
    if invite <> replay then raise exception 'Replay differs'; end if;
    plan := public.create_invite_session(invite->0->>'inviteToken')::jsonb;
    if plan <> public.create_invite_session(invite->0->>'inviteToken')::jsonb then raise exception 'Resume differs'; end if;
    if (plan->>'interviewId')::uuid <> interview then raise exception 'Wrong interview'; end if;
    plan := plan->'questionPlan';
    if plan#>>'{questions,0,text}' <> 'How do you reconcile a payroll run?' or plan#>>'{questions,1,text}' <> 'How do you check award rates?'
       or plan#>>'{assessmentCriteria,0,name}' <> 'Accuracy'
       or jsonb_array_length(plan->'questions') <> (case when question is null then 2 else 3 end)
       or plan#>>'{questions,2,text}' is distinct from question then raise exception 'Unexpected question set'; end if;
    plans := array_append(plans,plan);
  end loop;
  update public.questions set text='Later template edit' where "interviewId"=interview;
  if (select count(*) from public.sessions where "interviewId"=interview and "questionPlan"=any(plans)) <> 3
     or (select count(*) from public.candidates where "interviewId"=interview) <> 3 then raise exception 'Snapshot or retry failed'; end if;
end $$;
do $$
declare actor uuid; project uuid; created jsonb; interview uuid; invite jsonb; plan jsonb;
  input jsonb := '{"title":"AU Payroll Officer","voiceEnabled":true,"chatEnabled":false,"videoEnabled":false,"aiName":"Tester","aiTone":"FRIENDLY","followUpDepth":"LIGHT","language":"en","antiCheatingEnabled":false}';
begin
  select "createdBy",id into strict actor,project from public.projects order by "createdAt" limit 1;
  created := public.create_api_interview(actor, project, 'notes-payroll-role', input || '{"questions":[{"text":"How do you reconcile a payroll run?","maxFollowUps":2,"interviewerNote":"Names a specific reconciliation step and what it caught"},{"text":"How do you check award rates?","maxFollowUps":1},{"text":"Anything to add?"}]}');
  if created <> public.create_api_interview(actor, project, 'notes-payroll-role', input || '{"questions":[{"text":"How do you reconcile a payroll run?","maxFollowUps":2,"interviewerNote":"Names a specific reconciliation step and what it caught"},{"text":"How do you check award rates?","maxFollowUps":1},{"text":"Anything to add?"}]}') then raise exception 'Replay with a note differs'; end if;
  interview := (created->>'id')::uuid;
  if (select options from public.questions where "interviewId"=interview and "order"=0) is distinct from '{"maxFollowUps":2,"interviewerNote":"Names a specific reconciliation step and what it caught"}'::jsonb
     or (select options from public.questions where "interviewId"=interview and "order"=1) is distinct from '{"maxFollowUps":1}'::jsonb
     or (select options from public.questions where "interviewId"=interview and "order"=2) is not null
     or exists (select 1 from public.questions where "interviewId"=interview and not "probeOnShort") then raise exception 'Core note or limit not stored'; end if;
  begin
    perform public.create_api_interview(actor, project, 'notes-invalid-note', input || '{"questions":[{"text":"Question","interviewerNote":""}]}');
    raise exception 'Empty note accepted';
  exception when raise_exception then if sqlerrm <> 'INVALID_INTERVIEWER_NOTE' then raise; end if; end;
  invite := public.create_api_invites(actor, interview, 'notes-attempt',
    '[{"name":"Fictional Sam","followUpQuestions":["Which payroll system did you use?",{"text":"How did you fix a missed super payment?","interviewerNote":"Explains the correction, who they told and the outcome","maxFollowUps":2},{"text":"Which award do you know best?"}]}]');
  plan := public.create_invite_session(invite->0->>'inviteToken')::jsonb->'questionPlan'->'questions';
  if jsonb_array_length(plan) <> 6
     or plan#>'{0,options}' <> '{"maxFollowUps":2,"interviewerNote":"Names a specific reconciliation step and what it caught"}'
     or (plan->3) - 'id' <> '{"order":3,"text":"Which payroll system did you use?","type":"OPEN_ENDED","source":"invite","isRequired":true,"probeOnShort":false,"options":{"maxFollowUps":0}}'
     or (plan->4) - 'id' <> '{"order":4,"text":"How did you fix a missed super payment?","type":"OPEN_ENDED","source":"invite","isRequired":true,"probeOnShort":true,"options":{"maxFollowUps":2,"interviewerNote":"Explains the correction, who they told and the outcome"}}'
     or (plan->5) - 'id' <> '{"order":5,"text":"Which award do you know best?","type":"OPEN_ENDED","source":"invite","isRequired":true,"probeOnShort":false,"options":{"maxFollowUps":0}}'
     then raise exception 'Invite note or limit not snapshotted'; end if;
end $$;
rollback;
