-- Disabled until an operator enables a project and a matching subscription.
create table public.webhook_projects(project_id uuid primary key references public.projects(id), enabled boolean not null default false);
create table public.webhook_subscriptions(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id), enabled boolean not null default false);
alter table public.sessions add column sync_revision bigint not null default 0;
create table public.webhook_outbox (
 id uuid primary key default gen_random_uuid(), project_id uuid not null,
 session_id uuid not null, interview_id uuid not null, event_type text not null,
 session_revision bigint not null, occurred_at timestamptz not null default clock_timestamp(),
 payload jsonb not null, unique(session_id,session_revision,event_type)
);
create table public.webhook_deliveries (
 subscription_id uuid not null references public.webhook_subscriptions(id), event_id uuid not null references public.webhook_outbox(id),
 state text not null default 'pending' check(state in ('pending','delivered','dead')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, last_code text, last_status integer,
 delivered_at timestamptz, primary key(subscription_id,event_id)
);
create index webhook_due on public.webhook_deliveries(next_attempt_at) where state='pending';
do $$ declare t text; begin
 foreach t in array array['webhook_projects','webhook_subscriptions','webhook_outbox','webhook_deliveries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.webhook_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.sync_revision:=1;
 elsif row(new.status,new.summary,new.insights,new.themes,new.sentiment,new."audioRecordingUrl",new."audioRecordings",new."totalDurationSeconds") is distinct from row(old.status,old.summary,old.insights,old.themes,old.sentiment,old."audioRecordingUrl",old."audioRecordings",old."totalDurationSeconds") or new.sync_revision>old.sync_revision then new.sync_revision:=old.sync_revision+1;
 else new.sync_revision:=old.sync_revision; end if;
 return new;
end $$;
create trigger webhook_revision before insert or update on public.sessions for each row execute function public.webhook_revision();
-- Transcript mutations invalidate the snapshot revision without creating an event
-- per speech fragment. Later completion/report events advertise the latest value.
create function public.webhook_message_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then update public.sessions set sync_revision=sync_revision+1 where id=old."sessionId"; return old; end if;
 update public.sessions set sync_revision=sync_revision+1 where id=new."sessionId";
 return new;
end $$;
create trigger webhook_message_revision after insert or update or delete on public.messages for each row execute function public.webhook_message_revision();
create function public.emit_session_webhooks() returns trigger language plpgsql set search_path='' as $$
declare project uuid; types text[]:='{}'; kind text; eid uuid; occurred timestamptz; envelope jsonb;
begin
 select "projectId" into project from public.interviews where id=new."interviewId";
 if not exists(select 1 from public.webhook_projects where project_id=project and enabled) then return new; end if;
 if tg_op='INSERT' then types:=array_append(types,'interview.started');
 else
  if new.status='COMPLETED' and old.status is distinct from new.status then types:=array_append(types,'interview.completed'); end if;
  if nullif(btrim(new.summary),'') is not null and row(new.summary,new.insights,new.themes,new.sentiment) is distinct from row(old.summary,old.insights,old.themes,old.sentiment) then types:=array_append(types,'report.ready'); end if;
 end if;
 foreach kind in array types loop
  eid:=gen_random_uuid(); occurred:=clock_timestamp();
  envelope:=jsonb_build_object('spec_version','1','id',eid::text,'type',kind,'occurred_at',occurred,'project_id',project::text,'session_id',new.id::text,'interview_id',new."interviewId"::text,'session_revision',new.sync_revision,'subject',jsonb_build_object('type',case when kind='report.ready' then 'report' else 'interview' end,'id',new.id::text,'revision',new.sync_revision));
  insert into public.webhook_outbox(id,project_id,session_id,interview_id,event_type,session_revision,occurred_at,payload) values(eid,project,new.id,new."interviewId",kind,new.sync_revision,occurred,envelope);
  insert into public.webhook_deliveries(subscription_id,event_id) select id,eid from public.webhook_subscriptions where project_id=project and enabled;
 end loop;
 return new;
end $$;
create trigger emit_session_webhooks after insert or update on public.sessions for each row execute function public.emit_session_webhooks();
create function public.immutable_webhook_event() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'IMMUTABLE_WEBHOOK_EVENT'; end $$;
create trigger immutable_webhook_event before update on public.webhook_outbox for each row execute function public.immutable_webhook_event();
create function public.claim_webhook_deliveries(p_token uuid) returns table(subscription_id uuid,event_id uuid,payload jsonb,attempts integer)
language sql security invoker set search_path='' as $$
 with due as(select d.subscription_id,d.event_id from public.webhook_deliveries d join public.webhook_subscriptions s on s.id=d.subscription_id where d.state='pending' and s.enabled and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now()) order by d.next_attempt_at limit 3 for update of d skip locked), claimed as(
 update public.webhook_deliveries d set lease_token=p_token,lease_until=now()+interval '2 minutes',attempts=d.attempts+1 from due where d.subscription_id=due.subscription_id and d.event_id=due.event_id returning d.*)
 select c.subscription_id,c.event_id,o.payload,c.attempts from claimed c join public.webhook_outbox o on o.id=c.event_id;
$$;
create function public.finish_webhook_delivery(p_subscription uuid,p_event uuid,p_token uuid,p_state text,p_code text,p_status integer,p_delay integer) returns boolean
language sql security invoker set search_path='' as $$
 with changed as(update public.webhook_deliveries set state=p_state,last_code=p_code,last_status=p_status,next_attempt_at=now()+make_interval(secs=>greatest(1,least(p_delay,86400))),lease_token=null,lease_until=null,delivered_at=case when p_state='delivered' then now() end where subscription_id=p_subscription and event_id=p_event and lease_token=p_token and lease_until>now() returning 1) select exists(select 1 from changed);
$$;
create function public.redrive_webhook_delivery(p_subscription uuid,p_event uuid) returns boolean
language sql security invoker set search_path='' as $$
 with changed as(update public.webhook_deliveries set state='pending',attempts=0,next_attempt_at=now(),last_code=null where subscription_id=p_subscription and event_id=p_event and state='dead' and (lease_until is null or lease_until<now()) returning 1) select exists(select 1 from changed);
$$;
revoke all on function public.webhook_revision(),public.webhook_message_revision(),public.emit_session_webhooks(),public.immutable_webhook_event(),public.claim_webhook_deliveries(uuid),public.finish_webhook_delivery(uuid,uuid,uuid,text,text,integer,integer),public.redrive_webhook_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_webhook_deliveries(uuid),public.finish_webhook_delivery(uuid,uuid,uuid,text,text,integer,integer),public.redrive_webhook_delivery(uuid,uuid) to service_role;
