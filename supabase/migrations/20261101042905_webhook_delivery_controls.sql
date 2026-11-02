-- Service-only API backing functions. The HTTP boundary supplies project IDs
-- from the authenticated key; no browser role may call these directly.
create table public.webhook_retry_requests (
 request_id uuid primary key, subscription_id uuid not null, event_id uuid not null,
 requested_by uuid not null, requested_at timestamptz not null default now(),
 foreign key(subscription_id,event_id) references public.webhook_deliveries(subscription_id,event_id)
);
alter table public.webhook_retry_requests enable row level security;
revoke all on public.webhook_retry_requests from public,anon,authenticated;
grant select,insert on public.webhook_retry_requests to service_role;
create index webhook_retry_delivery on public.webhook_retry_requests(subscription_id,event_id);
create function public.list_webhook_deliveries(p_projects uuid[],p_subscription uuid,p_before timestamptz default null,p_event uuid default null,p_limit integer default 21)
returns table(event_id uuid,subscription_id uuid,session_id uuid,event_type text,session_revision bigint,occurred_at timestamptz,state text,attempts integer,last_code text,last_status integer,next_attempt_at timestamptz,delivered_at timestamptz,retry_count bigint,retry_enabled boolean)
language sql stable security invoker set search_path='' as $$
 select o.id,d.subscription_id,o.session_id,o.event_type,o.session_revision,o.occurred_at,d.state,d.attempts,
 case when d.last_code in ('NETWORK_ERROR','HTTP_RETRY','RETRIES_EXHAUSTED','DESTINATION_REJECTED','CONFIGURATION') then d.last_code else null end,d.last_status,d.next_attempt_at,d.delivered_at,
 (select count(*) from public.webhook_retry_requests r where r.subscription_id=d.subscription_id and r.event_id=d.event_id),
 s.enabled and coalesce(p.enabled,false) and d.state='dead' and (d.lease_until is null or d.lease_until<now())
 from public.webhook_deliveries d join public.webhook_outbox o on o.id=d.event_id join public.webhook_subscriptions s on s.id=d.subscription_id
 left join public.webhook_projects p on p.project_id=s.project_id
 where s.id=p_subscription and s.project_id=any(p_projects) and o.project_id=s.project_id
 and (p_before is null or (o.occurred_at,o.id)<(p_before,p_event))
 order by o.occurred_at desc,o.id desc limit greatest(1,least(p_limit,101));
$$;
create function public.request_webhook_retry(p_projects uuid[],p_subscription uuid,p_event uuid,p_request uuid,p_actor uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare delivery public.webhook_deliveries; enabled boolean; prior public.webhook_retry_requests;
begin
 select d.* into delivery from public.webhook_deliveries d join public.webhook_subscriptions s on s.id=d.subscription_id join public.webhook_outbox o on o.id=d.event_id
 where d.subscription_id=p_subscription and d.event_id=p_event and s.project_id=any(p_projects) and o.project_id=s.project_id for update of d;
 if not found then return 'not_found'; end if;
 select * into prior from public.webhook_retry_requests where request_id=p_request;
 if found then
  if prior.subscription_id=p_subscription and prior.event_id=p_event and prior.requested_by=p_actor then return 'already_requested'; end if;
  return 'request_conflict';
 end if;
 select s.enabled and coalesce(p.enabled,false) into enabled from public.webhook_subscriptions s left join public.webhook_projects p on p.project_id=s.project_id where s.id=p_subscription for share of s;
 if not enabled then return 'disabled'; end if;
 if delivery.lease_until>now() then return 'in_progress'; end if;
 if delivery.state<>'dead' then return delivery.state; end if;
 insert into public.webhook_retry_requests(request_id,subscription_id,event_id,requested_by) values(p_request,p_subscription,p_event,p_actor);
 update public.webhook_deliveries set state='pending',attempts=0,next_attempt_at=now(),lease_token=null,lease_until=null where subscription_id=p_subscription and event_id=p_event;
 return 'queued';
end $$;
revoke all on function public.list_webhook_deliveries(uuid[],uuid,timestamptz,uuid,integer),public.request_webhook_retry(uuid[],uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_webhook_deliveries(uuid[],uuid,timestamptz,uuid,integer),public.request_webhook_retry(uuid[],uuid,uuid,uuid,uuid) to service_role;
