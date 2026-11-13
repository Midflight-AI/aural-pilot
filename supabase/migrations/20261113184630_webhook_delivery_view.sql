-- The API validates the view. Only its service role can call this owner.
create function public.query_webhook_deliveries(p_projects uuid[],p_subscription uuid,p_view jsonb,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare result jsonb; filter jsonb; col text; kind text; page integer; sort_col text; direction text;
begin
 if p_limit not between 1 and 100 or jsonb_typeof(p_view) is distinct from 'object' or jsonb_typeof(p_view->'filters') is distinct from 'array'
   or jsonb_array_length(p_view->'filters')>20 or length(coalesce(p_view->>'q',''))>200
   or coalesce(p_view->>'group','status')<>'status' then raise exception 'Invalid delivery view' using errcode='22023'; end if;
 page:=(p_view->>'page')::integer;
 if page not between 1 and 1000000 then raise exception 'Invalid page' using errcode='22023'; end if;
 sort_col:=coalesce(p_view#>>'{sort,col}','occurredAt'); direction:=coalesce(p_view#>>'{sort,dir}','desc');
 if sort_col not in ('event','status','occurredAt','revision','attempts','retryCount','lastResult','sessionId','deliveredAt','nextAttemptAt') or direction not in ('asc','desc') then raise exception 'Invalid sort' using errcode='22023'; end if;
 for filter in select value from jsonb_array_elements(p_view->'filters') loop
  col:=filter->>'col'; kind:=filter->>'kind';
  if col not in ('event','status','occurredAt','revision','attempts','retryCount','lastResult','sessionId','deliveredAt','nextAttemptAt') or kind not in ('contains','doesNotContain','equals','notEquals','range','dateRange','anyOf','noneOf','isEmpty','isNotEmpty') then raise exception 'Invalid filter' using errcode='22023'; end if;
  if (kind in ('contains','doesNotContain','equals','notEquals') and (col not in ('event','lastResult','sessionId') or jsonb_typeof(filter->'q')<>'string' or length(filter->>'q')>200))
  or (kind='range' and (col not in ('revision','attempts','retryCount') or (filter ? 'min' and jsonb_typeof(filter->'min')<>'number') or (filter ? 'max' and jsonb_typeof(filter->'max')<>'number')))
  or (kind='dateRange' and (col not in ('occurredAt','deliveredAt','nextAttemptAt') or (filter ? 'from' and coalesce(filter->>'from','') !~ '^\d{4}-\d{2}-\d{2}$') or (filter ? 'to' and coalesce(filter->>'to','') !~ '^\d{4}-\d{2}-\d{2}$')))
  or (kind in ('anyOf','noneOf') and (col<>'status' or jsonb_typeof(filter->'values')<>'array' or jsonb_array_length(filter->'values')>3 or exists(select 1 from jsonb_array_elements_text(filter->'values') v where v not in ('Delivered','Queued','Failed')))) then
   raise exception 'Invalid filter' using errcode='22023'; end if;
 end loop;
 with authorised_subscription as materialized (
  select s.id,s.project_id,s.enabled from public.webhook_subscriptions s where s.id=p_subscription and s.project_id=any(p_projects)
 ), retries as materialized (
  select r.event_id,count(*) retry_count from public.webhook_retry_requests r join authorised_subscription s on s.id=r.subscription_id group by r.event_id
 ), source as materialized (
  select o.id event_id,d.subscription_id,o.session_id,o.event_type,o.session_revision,o.occurred_at,d.state,d.attempts,
   case when d.last_code in ('NETWORK_ERROR','HTTP_RETRY','RETRIES_EXHAUSTED','DESTINATION_REJECTED','CONFIGURATION') then d.last_code end last_code,
   d.last_status,d.next_attempt_at,d.delivered_at,coalesce(r.retry_count,0) retry_count,
   s.enabled and coalesce(p.enabled,false) and d.state='dead' and (d.lease_until is null or d.lease_until<now()) retry_enabled
  from public.webhook_deliveries d join public.webhook_outbox o on o.id=d.event_id join authorised_subscription s on s.id=d.subscription_id
  left join public.webhook_projects p on p.project_id=s.project_id left join retries r on r.event_id=d.event_id
  where o.project_id=s.project_id
 ), mapped as materialized (
  select source.*,jsonb_build_object(
    'event',case event_type when 'interview.started' then 'Interview started' when 'interview.completed' then 'Interview completed' when 'report.ready' then 'Report ready' else 'Interview update' end,
    'status',case state when 'dead' then 'Failed' when 'delivered' then 'Delivered' else 'Queued' end,
    'occurredAt',occurred_at,'revision',session_revision,'attempts',attempts,'retryCount',retry_count,
    'lastResult',case when state='delivered' then 'Accepted' when last_code is null then '—' else
      (case last_code when 'NETWORK_ERROR' then 'Connection failed' when 'HTTP_RETRY' then 'Receiver temporarily unavailable' when 'RETRIES_EXHAUSTED' then 'Automatic retries exhausted' when 'DESTINATION_REJECTED' then 'Receiver rejected delivery' when 'CONFIGURATION' then 'Connection configuration needs attention' else 'Needs attention' end)||case when last_status is null then '' else ' (HTTP '||last_status||')' end end,
    'sessionId',session_id,'deliveredAt',delivered_at,'nextAttemptAt',next_attempt_at) fields
  from source
 ), filtered as materialized (
  select m.* from mapped m where
   (trim(coalesce(p_view->>'q',''))='' or exists(select 1 from jsonb_each_text(m.fields) e where position(lower(trim(p_view->>'q')) in lower(e.value))>0))
   and not exists(select 1 from jsonb_array_elements(p_view->'filters') f where (
    case f->>'kind'
     when 'contains' then trim(f->>'q')='' or position(lower(trim(f->>'q')) in lower(coalesce(m.fields->>(f->>'col'),'')))>0
     when 'doesNotContain' then trim(f->>'q')='' or position(lower(trim(f->>'q')) in lower(coalesce(m.fields->>(f->>'col'),'')))=0
     when 'equals' then trim(f->>'q')='' or lower(m.fields->>(f->>'col'))=lower(trim(f->>'q'))
     when 'notEquals' then trim(f->>'q')='' or lower(coalesce(m.fields->>(f->>'col'),''))<>lower(trim(f->>'q'))
     when 'range' then (not(f ? 'min') and not(f ? 'max')) or ((m.fields->>(f->>'col')) is not null and (not(f ? 'min') or (m.fields->>(f->>'col'))::numeric >= (f->>'min')::numeric) and (not(f ? 'max') or (m.fields->>(f->>'col'))::numeric <= (f->>'max')::numeric))
     when 'dateRange' then (not(f ? 'from') and not(f ? 'to')) or ((m.fields->>(f->>'col')) is not null and (not(f ? 'from') or (m.fields->>(f->>'col'))::timestamptz >= (f->>'from')::date::timestamptz) and (not(f ? 'to') or (m.fields->>(f->>'col'))::timestamptz < ((f->>'to')::date+1)::timestamptz))
     when 'anyOf' then jsonb_array_length(f->'values')=0 or f->'values' ? (m.fields->>(f->>'col'))
     when 'noneOf' then not(f->'values' ? (m.fields->>(f->>'col')))
     when 'isEmpty' then coalesce(m.fields->>(f->>'col'),'')=''
     when 'isNotEmpty' then coalesce(m.fields->>(f->>'col'),'')<>''
     else false end) is not true)
 ), ordered as materialized (
  select f.*,row_number() over(order by
   case when p_view->>'group'='status' then case f.fields->>'status' when 'Delivered' then 0 when 'Queued' then 1 when 'Failed' then 2 else 3 end end,
   case when sort_col in ('event','status','lastResult','sessionId') and direction='asc' then lower(f.fields->>sort_col) end asc nulls last,
   case when sort_col in ('event','status','lastResult','sessionId') and direction='desc' then lower(f.fields->>sort_col) end desc nulls last,
   case when sort_col in ('revision','attempts','retryCount') and direction='asc' then (f.fields->>sort_col)::numeric end asc nulls last,
   case when sort_col in ('revision','attempts','retryCount') and direction='desc' then (f.fields->>sort_col)::numeric end desc nulls last,
   case when sort_col in ('occurredAt','deliveredAt','nextAttemptAt') and direction='asc' then (f.fields->>sort_col)::timestamptz end asc nulls last,
   case when sort_col in ('occurredAt','deliveredAt','nextAttemptAt') and direction='desc' then (f.fields->>sort_col)::timestamptz end desc nulls last,
   f.event_id desc) rn from filtered f
 ), groups as (select fields->>'status' key,count(*) n from filtered group by fields->>'status')
 select jsonb_build_object('data',coalesce((select jsonb_agg(to_jsonb(o)-'fields'-'rn' order by rn) from ordered o where rn > ((page-1)::bigint*p_limit) and rn <= (page::bigint*p_limit)),'[]'::jsonb),
  'total',(select count(*) from filtered),'groupCounts',case when p_view->>'group'='status' then coalesce((select jsonb_object_agg(key,n) from groups),'{}'::jsonb) else '{}'::jsonb end,'page',page,'pageSize',p_limit) into result;
 return result;
end $$;
revoke all on function public.query_webhook_deliveries(uuid[],uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.query_webhook_deliveries(uuid[],uuid,jsonb,integer) to service_role;
notify pgrst,'reload schema';
