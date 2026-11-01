-- Enforce the existing 400 MiB recording budget before issuing upload grants.
-- The recording row lock serializes reservations, including different sequences.
-- Source/output objects and manual retention are unchanged.
create or replace function public.video_spike_chunk(p_id uuid,p_sequence integer,p_bytes integer,p_sha256 text,p_end_ms double precision,p_ack boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare r public.video_spike_recordings; c public.video_spike_chunks;
begin
 select * into strict r from public.video_spike_recordings where id=p_id for update;
 if r.state not in ('capturing','uploading') then raise exception 'recording_closed'; end if;
 select * into c from public.video_spike_chunks where recording_id=p_id and sequence=p_sequence;
 if not found then
  if p_bytes + (select coalesce(sum(bytes),0) from public.video_spike_chunks where recording_id=p_id) > 419430400 then
   raise exception 'recording_too_large';
  end if;
  insert into public.video_spike_chunks(recording_id,sequence,bytes,sha256,end_ms)
  values(p_id,p_sequence,p_bytes,p_sha256,p_end_ms) returning * into c;
 end if;
 if c.bytes<>p_bytes or c.sha256<>p_sha256 or c.end_ms<>p_end_ms then raise exception 'chunk_conflict'; end if;
 if p_ack and not c.acknowledged then
  update public.video_spike_chunks set acknowledged=true where recording_id=p_id and sequence=p_sequence;
 end if;
 if r.state<>'uploading' then update public.video_spike_recordings set state='uploading' where id=p_id;end if;
 return c.acknowledged or p_ack;
end; $$;
revoke all on function public.video_spike_chunk(uuid,integer,integer,text,double precision,boolean) from public,anon,authenticated;
grant execute on function public.video_spike_chunk(uuid,integer,integer,text,double precision,boolean) to service_role;
