-- Isolated fixture tests; always roll back all mutations.
begin;
do $$
declare sub uuid; project uuid; event uuid; actor uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); got text; n integer;
begin
 select id,project_id into sub,project from public.webhook_subscriptions limit 1;
 if sub is null then raise exception 'Fixture subscription required'; end if;
 select event_id into event from public.webhook_deliveries where subscription_id=sub limit 1;
 if event is null then raise exception 'Fixture delivery required'; end if;
 if has_function_privilege('anon','public.request_webhook_retry(uuid[],uuid,uuid,uuid,uuid)','execute') or has_table_privilege('authenticated','public.webhook_retry_requests','select') then raise exception 'Public access'; end if;
 select count(*) into n from public.list_webhook_deliveries('{}',sub);
 if n<>0 then raise exception 'Cross-project history exposed'; end if;
 got:=public.request_webhook_retry('{}',sub,event,request,actor);
 if got<>'not_found' then raise exception 'Cross-project retry accepted'; end if;
 update public.webhook_deliveries set state='dead',attempts=8,lease_token=null,lease_until=null where subscription_id=sub and event_id=event;
 update public.webhook_subscriptions set enabled=false where id=sub;
 got:=public.request_webhook_retry(array[project],sub,event,request,actor);
 if got<>'disabled' then raise exception 'Disabled accepted'; end if;
 update public.webhook_subscriptions set enabled=true where id=sub;
 update public.webhook_projects set enabled=true where project_id=project;
 update public.webhook_deliveries set lease_until=now()+interval '1 minute' where subscription_id=sub and event_id=event;
 got:=public.request_webhook_retry(array[project],sub,event,request,actor);
 if got<>'in_progress' then raise exception 'Lease stolen'; end if;
 update public.webhook_deliveries set lease_until=null where subscription_id=sub and event_id=event;
 got:=public.request_webhook_retry(array[project],sub,event,request,actor);
 if got<>'queued' then raise exception 'Retry not queued: %',got; end if;
 -- Lost response replay after another failure must not reset the new cycle.
 update public.webhook_deliveries set state='dead',attempts=8 where subscription_id=sub and event_id=event;
 got:=public.request_webhook_retry(array[project],sub,event,request,actor);
 if got<>'already_requested' or (select attempts from public.webhook_deliveries where subscription_id=sub and event_id=event)<>8 then raise exception 'Replay reset cycle'; end if;
 select count(*) into n from public.webhook_retry_requests where request_id=request;
 if n<>1 then raise exception 'Duplicate audit'; end if;
 got:=public.request_webhook_retry(array[project],sub,event,request,gen_random_uuid());
 if got<>'request_conflict' then raise exception 'Conflicting actor accepted'; end if;
 update public.webhook_deliveries set state='delivered' where subscription_id=sub and event_id=event;
 got:=public.request_webhook_retry(array[project],sub,event,gen_random_uuid(),actor);
 if got<>'delivered' then raise exception 'Delivered event reset'; end if;
end $$;
rollback;
