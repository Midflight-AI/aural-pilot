-- Run inside a rollback-only transaction after applying the outbox migration.
do $$
declare template uuid; project uuid; session uuid:=gen_random_uuid(); subscription uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); event uuid; revision bigint;
begin
 select s."interviewId",i."projectId" into template,project from public.sessions s join public.interviews i on i.id=s."interviewId" where s.id='1a698808-3525-4887-91af-19f82b77a01b';
 if template is null then raise exception 'fixture missing'; end if;
 insert into public.webhook_projects(project_id,enabled) values(project,true);
 insert into public.webhook_subscriptions(id,project_id,enabled) values(subscription,project,true);
 insert into public.sessions(id,"interviewId","participantName") values(session,template,'Webhook transactional fixture');
 if (select count(*) from public.webhook_outbox where session_id=session and event_type='interview.started')<>1 then raise exception 'start not emitted'; end if;
 update public.sessions set status='COMPLETED' where id=session;
 update public.sessions set summary='Fictional report ready' where id=session;
 if (select count(*) from public.webhook_outbox where session_id=session)<>3 then raise exception 'separate lifecycle events missing'; end if;
 select sync_revision into revision from public.sessions where id=session;
 update public.sessions set summary='Fictional report ready' where id=session;
 if (select sync_revision from public.sessions where id=session)<>revision then raise exception 'no-op revision changed'; end if;
 if exists(select 1 from public.webhook_outbox where session_id=session and payload::text like '%Fictional%') then raise exception 'content leak'; end if;
 select event_id into event from public.claim_webhook_deliveries(token) limit 1;
 if event is null then raise exception 'claim failed'; end if;
 if public.finish_webhook_delivery(subscription,event,other,'delivered',null,202,1) then raise exception 'stale lease succeeded'; end if;
 if not public.finish_webhook_delivery(subscription,event,token,'dead','CONFIGURATION',401,1) then raise exception 'finish failed'; end if;
 if not public.redrive_webhook_delivery(subscription,event) then raise exception 'redrive failed'; end if;
 if (select event_id from public.webhook_deliveries where subscription_id=subscription and event_id=event)<>event then raise exception 'redrive identity changed'; end if;
 begin
  update public.webhook_outbox set payload='{}' where id=event;
  raise exception 'mutation accepted';
 exception when raise_exception then
  if sqlerrm<>'IMMUTABLE_WEBHOOK_EVENT' then raise; end if;
 end;
 if has_table_privilege('authenticated','public.webhook_outbox','SELECT') then raise exception 'browser access'; end if;
end $$;
select 'outbox lifecycle, immutable event, fenced lease, redrive and access checks passed' as result;
