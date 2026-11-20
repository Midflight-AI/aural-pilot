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
rollback;
