-- Disposable CI only. No customer data.
begin;
do $$
declare project uuid; sub uuid:=gen_random_uuid(); interview uuid; result jsonb; plan json; v jsonb:='{"q":"","sort":{"col":"attempts","dir":"desc"},"filters":[],"group":null,"page":1}';
begin
 select "projectId",id into project,interview from public.interviews where id='22222222-2222-4222-8222-222222222222';
 insert into public.webhook_subscriptions(id,project_id,enabled) values(sub,project,true);
 insert into public.webhook_outbox(id,project_id,session_id,interview_id,event_type,session_revision,occurred_at,payload)
 select md5('delivery-view-'||n)::uuid,project,gen_random_uuid(),interview,case when n=1001 then 'report.ready' else 'interview.started' end,n,'2026-01-01T00:00:00Z','{"private":"never return"}' from generate_series(1,1001)n;
 insert into public.webhook_deliveries(subscription_id,event_id,state,attempts,last_code,last_status)
 select sub,md5('delivery-view-'||n)::uuid,case when n=1001 then 'dead' else 'delivered' end,n,case when n=1001 then 'HTTP_RETRY' end,case when n=1001 then 503 end from generate_series(1,1001)n;
 result:=public.query_webhook_deliveries(array[project],sub,v,20);
 if (result->>'total')::int<>1001 or result#>>'{data,0,event_id}'<>md5('delivery-view-1001')::uuid::text then raise exception 'full-result sort failed'; end if;
 execute 'explain (analyze,buffers,format json) select public.query_webhook_deliveries($1,$2,$3,$4)' into plan using array[project],sub,v,20;
 raise notice 'Delivery view plan: %',plan;
 raise notice 'Delivery view page bytes: %',octet_length(result::text);
 if result::text like '%private%' or result::text like '%payload%' then raise exception 'payload exposed'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,jsonb_set(v,'{page}','51'),20);
 if jsonb_array_length(result->'data')<>1 then raise exception 'later page missing'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"sort":{"col":"occurredAt","dir":"desc"}}',20);
 if result#>>'{data,0,event_id}'<>(select event_id::text from public.list_webhook_deliveries(array[project],sub,null,null,20) limit 1) then raise exception 'tie order differs from cursor owner'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"filters":[{"col":"deliveredAt","kind":"dateRange","from":"2026-01-01"}]}',20);
 if (result->>'total')::int<>0 then raise exception 'null date matched'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"q":"receiver temporarily unavailable","group":"status"}',20);
 if (result->>'total')::int<>1 or (result#>>'{groupCounts,Failed}')::int<>1 then raise exception 'display label search or group failed'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"filters":[{"col":"deliveredAt","kind":"isEmpty"},{"col":"occurredAt","kind":"dateRange","from":"2026-01-01","to":"2026-01-01"}]}',20);
 if (result->>'total')::int<>1001 then raise exception 'empty or inclusive date range failed'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"filters":[{"col":"event","kind":"notEquals","q":"report ready"},{"col":"status","kind":"noneOf","values":["Failed"]}],"group":"status"}',20);
 if (result->>'total')::int<>1000 or (result#>>'{groupCounts,Delivered}')::int<>1000 then raise exception 'not equals, none-of or group counts failed'; end if;
 result:=public.query_webhook_deliveries(array[project],sub,v||'{"filters":[{"col":"event","kind":"equals","q":"Report ready"},{"col":"status","kind":"anyOf","values":["Failed"]}]}',20);
 if (result->>'total')::int<>1 then raise exception 'display label filters failed'; end if;
 result:=public.query_webhook_deliveries('{}',sub,v,20);
 if (result->>'total')::int<>0 then raise exception 'other project exposed'; end if;
 result:=public.query_webhook_deliveries(array[project],gen_random_uuid(),v,20);
 if (result->>'total')::int<>0 then raise exception 'other subscription exposed'; end if;
 begin
  perform public.query_webhook_deliveries(array[project],sub,v||'{"filters":[{"col":"payload","kind":"contains","q":"private"}]}',20);
  raise exception 'invalid filter accepted';
 exception when sqlstate '22023' then null; end;
 if has_function_privilege('anon','public.query_webhook_deliveries(uuid[],uuid,jsonb,integer)','execute') or has_function_privilege('authenticated','public.query_webhook_deliveries(uuid[],uuid,jsonb,integer)','execute') then raise exception 'browser access'; end if;
 begin
  perform public.query_webhook_deliveries(array[project],sub,v||'{"sort":{"col":"payload","dir":"asc"}}',20);
  raise exception 'invalid sort accepted';
 exception when sqlstate '22023' then null; end;
end $$;
rollback;
