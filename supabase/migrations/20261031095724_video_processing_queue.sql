-- Durable processing queue. Finalization already writes processing atomically.
alter table public.video_spike_recordings add column processing_attempts integer not null default 0 check(processing_attempts>=0);
alter table public.video_spike_recordings add column next_processing_at timestamptz;
create index video_spike_processing_due on public.video_spike_recordings(state,next_processing_at,created_at) where state in ('processing','failed');

create or replace function public.video_spike_claim(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('video-spike-claim',0)) then return false;end if;
 if (select count(*) from public.video_spike_recordings where state='processing' and lease_until>now())>=2 then return false;end if;
 update public.video_spike_recordings set state='processing',processing_attempts=processing_attempts+1,
 lease_token=p_token,lease_until=now()+interval '10 minutes',next_processing_at=null
 where id=p_id and manifest_hash is not null and processing_attempts<3
 and (state='processing' or (state='failed' and next_processing_at<=now()))
 and (lease_until is null or lease_until<now());
 return found;
end; $$;

create function public.video_spike_claim_next(p_token uuid)
returns uuid language plpgsql set search_path='' as $$
declare candidate uuid;
begin
 -- A third crashed attempt becomes visible as failed rather than waiting forever.
 update public.video_spike_recordings set state='failed',failure_code='worker_timeout',next_processing_at=null,
 lease_token=null,lease_until=null,revision=revision+1
 where state='processing' and processing_attempts>=3 and lease_until<now();
 select id into candidate from public.video_spike_recordings
 where manifest_hash is not null and processing_attempts<3
 and (state='processing' or (state='failed' and next_processing_at<=now()))
 and (lease_until is null or lease_until<now())
 order by created_at for update skip locked limit 1;
 if candidate is not null and public.video_spike_claim(candidate,p_token) then return candidate;end if;
 return null;
end; $$;

create function public.video_spike_heartbeat(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set lease_until=now()+interval '10 minutes'
 where id=p_id and state='processing' and lease_token=p_token and lease_until>now();
 return found;
end; $$;

create or replace function public.video_spike_complete(p_id uuid,p_token uuid,p_path text,p_duration double precision,p_error text default null)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set
 state=case when p_error is not null then 'failed' when (manifest->>'partial')::boolean then 'partial' else 'ready' end,
 output_path=case when p_error is null then p_path else null end,
 duration_seconds=p_duration,failure_code=p_error,revision=revision+1,lease_token=null,lease_until=null,
 next_processing_at=case when p_error is not null and processing_attempts<3 and p_error not in ('chunk_corrupt','media_invalid','invalid_manifest','unsupported_container','invalid_chunk','recording_too_large') then now()+make_interval(secs=>60*processing_attempts*processing_attempts) else null end
 where id=p_id and state='processing' and lease_token=p_token and lease_until>now();
 return found;
end; $$;

create or replace function public.video_spike_retry(p_id uuid)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set state='processing',failure_code=null,lease_token=null,lease_until=null,
 processing_attempts=0,next_processing_at=null,revision=revision+1
 where id=p_id and state='failed' and manifest_hash is not null;
 return found;
end; $$;
revoke all on function public.video_spike_claim_next(uuid),public.video_spike_heartbeat(uuid,uuid) from public,anon,authenticated;
grant execute on function public.video_spike_claim_next(uuid),public.video_spike_heartbeat(uuid,uuid) to service_role;
