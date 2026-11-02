-- Numeric operational measurements only. Browser roles cannot read/write directly.
create table public.interview_observations (
 id uuid primary key,
 session_id uuid not null references public.sessions(id) on delete cascade,
 source text not null check(source in ('client','relay','worker','database')),
 kind text not null check(kind in ('voice_connect','voice_connect_failed','voice_reconnect','voice_response','voice_timeout','voice_asr_timeout','voice_model_first_audio','voice_provider_error','voice_empty_response','video_upload','video_upload_failed','video_backlog','video_finalize','video_finalize_failed','video_processing','video_processing_failed','video_ready')),
 duration_ms double precision check(duration_ms>=0 and duration_ms<=3600000),
 bytes bigint check(bytes>=0 and bytes<=420000000),
 created_at timestamptz not null default now()
);
create index interview_observations_time on public.interview_observations(created_at);
create index interview_observations_session on public.interview_observations(session_id);
alter table public.interview_observations enable row level security;
revoke all on public.interview_observations from public,anon,authenticated;
grant all on public.interview_observations to service_role;

create function public.record_interview_observations(p_session uuid,p_source text,p_events jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if p_source not in ('client','relay','worker') or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 16 then raise exception 'invalid_observations';end if;
 -- Serialize per-session accounting across instances; a valid invitation cannot grow storage forever.
 perform 1 from public.sessions where id=p_session for update;
 if not found then raise exception 'session_missing';end if;
 if (select count(*) from public.interview_observations where session_id=p_session)+jsonb_array_length(p_events)>4096 then return;end if;
 insert into public.interview_observations(id,session_id,source,kind,duration_ms,bytes)
 select (e->>'id')::uuid,p_session,p_source,e->>'kind',(e->>'durationMs')::double precision,(e->>'bytes')::bigint
 from jsonb_array_elements(p_events) e on conflict(id) do nothing;
end $$;
revoke all on function public.record_interview_observations(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_interview_observations(uuid,text,jsonb) to service_role;

alter table public.video_spike_recordings add column finalized_at timestamptz, add column ready_at timestamptz;
create function public.observe_video_state() returns trigger language plpgsql set search_path='' as $$
begin
 if new.manifest_hash is not null and old.manifest_hash is null then new.finalized_at:=clock_timestamp();end if;
 if new.state in ('ready','partial') and old.state not in ('ready','partial') then
  new.ready_at:=clock_timestamp();
  if new.finalized_at is not null then
   insert into public.interview_observations(id,session_id,source,kind,duration_ms)
   values(gen_random_uuid(),new.session_id,'database','video_ready',least(3600000,greatest(0,extract(epoch from (new.ready_at-new.finalized_at))*1000)));
  end if;
 end if;
 return new;
end $$;
revoke all on function public.observe_video_state() from public,anon,authenticated;
create trigger observe_video_state before update on public.video_spike_recordings for each row execute function public.observe_video_state();

create function public.interview_health() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'windowMinutes',15,
  'metrics',(select coalesce(jsonb_agg(m),'[]'::jsonb) from (
   select source,kind,count(*) as samples,percentile_cont(0.5) within group(order by duration_ms) as p50_ms,percentile_cont(0.95) within group(order by duration_ms) as p95_ms,sum(bytes) as bytes
   from public.interview_observations where created_at>now()-interval '15 minutes' group by source,kind
  ) m),
  'stuckRecordings',(select count(*) from public.video_spike_recordings where state in ('processing','failed') and finalized_at<now()-interval '2 minutes'),
  'unrecoveredUploads',(select count(*) from public.video_spike_recordings where state in ('capturing','uploading') and created_at<now()-interval '40 minutes'),
  'failedRecordings',(select count(*) from public.video_spike_recordings where state='failed' and manifest_hash is not null)
 );
$$;
revoke all on function public.interview_health() from public,anon,authenticated;
grant execute on function public.interview_health() to service_role;
