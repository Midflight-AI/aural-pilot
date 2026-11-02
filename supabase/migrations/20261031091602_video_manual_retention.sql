-- Recordings are retained until explicitly deleted; signed playback links still expire.
alter table public.video_spike_recordings alter column expires_at drop not null;
alter table public.video_spike_recordings alter column expires_at drop default;
update public.video_spike_recordings set expires_at=null where expires_at is not null;

create or replace function public.video_spike_chunk(p_id uuid,p_sequence integer,p_bytes integer,p_sha256 text,p_end_ms double precision,p_ack boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare r public.video_spike_recordings; c public.video_spike_chunks;
begin
 select * into strict r from public.video_spike_recordings where id=p_id for update;
 if r.state not in ('capturing','uploading') then raise exception 'recording_closed'; end if;
 insert into public.video_spike_chunks(recording_id,sequence,bytes,sha256,end_ms)
 values(p_id,p_sequence,p_bytes,p_sha256,p_end_ms) on conflict do nothing;
 select * into strict c from public.video_spike_chunks where recording_id=p_id and sequence=p_sequence;
 if c.bytes<>p_bytes or c.sha256<>p_sha256 or c.end_ms<>p_end_ms then raise exception 'chunk_conflict'; end if;
 if p_ack then update public.video_spike_chunks set acknowledged=true where recording_id=p_id and sequence=p_sequence; end if;
 update public.video_spike_recordings set state='uploading' where id=p_id;
 return c.acknowledged or p_ack;
end; $$;
create or replace function public.video_spike_finalize(p_id uuid,p_manifest jsonb,p_hash text)
returns text language plpgsql set search_path='' as $$
declare r public.video_spike_recordings; item jsonb; c public.video_spike_chunks; n integer:=0;
begin
 select * into strict r from public.video_spike_recordings where id=p_id for update;
 if r.state in ('deleted','expired') then raise exception 'recording_closed'; end if;
 if r.manifest_hash is not null then
  if r.manifest_hash<>p_hash then raise exception 'manifest_conflict'; end if;
  return r.state;
 end if;
 if r.state not in ('capturing','uploading') then raise exception 'recording_closed'; end if;
 for item in select value from jsonb_array_elements(p_manifest->'chunks') loop
  select * into c from public.video_spike_chunks where recording_id=p_id and sequence=n;
  if not found or not c.acknowledged or (item->>'sequence')::integer<>n or c.sha256<>item->>'sha256' or c.bytes<>(item->>'bytes')::integer or c.end_ms<>(item->>'endMs')::double precision then raise exception 'chunk_missing_or_conflicting'; end if;
  n:=n+1;
 end loop;
 if n=0 or n<>(select count(*) from public.video_spike_chunks where recording_id=p_id) then raise exception 'manifest_incomplete'; end if;
 update public.video_spike_recordings set manifest=p_manifest,manifest_hash=p_hash,state='processing',revision=revision+1 where id=p_id;
 return 'processing';
end; $$;
create or replace function public.video_spike_claim(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set lease_token=p_token,lease_until=now()+interval '10 minutes'
 where id=p_id and state='processing' and (lease_until is null or lease_until<now());
 return found;
end; $$;
create or replace function public.video_spike_complete(p_id uuid,p_token uuid,p_path text,p_duration double precision,p_error text default null)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set
 state=case when p_error is not null then 'failed' when (manifest->>'partial')::boolean then 'partial' else 'ready' end,
 output_path=case when p_error is null then p_path else null end,
 duration_seconds=p_duration,failure_code=p_error,revision=revision+1,lease_token=null,lease_until=null
 where id=p_id and state='processing' and lease_token=p_token and lease_until>now();
 return found;
end; $$;
create or replace function public.video_spike_retry(p_id uuid)
returns boolean language plpgsql set search_path='' as $$
begin
 update public.video_spike_recordings set state='processing',failure_code=null,lease_token=null,lease_until=null,revision=revision+1
 where id=p_id and state='failed' and manifest_hash is not null;
 return found;
end; $$;
