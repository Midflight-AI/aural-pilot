-- Disposable CI PostgreSQL only: minimal Supabase API schemas, never a remote project.
\set ON_ERROR_STOP on
begin;
create role anon; create role authenticated; create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table public.sessions(id uuid primary key);
\ir ../supabase/migrations/20261031082242_video_spike.sql
insert into auth.users values('11111111-1111-4111-8111-111111111111');
insert into sessions values('22222222-2222-4222-8222-222222222222');
insert into video_spike_recordings(id,session_id,owner_id,consent_version) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','internal-video-spike-v1');
-- Simulate a recording created before the old 30-day cutoff, then upgrade it.
update video_spike_recordings set created_at=now()-interval '90 days',expires_at=now()-interval '60 days';
\ir ../supabase/migrations/20261031091602_video_manual_retention.sql
\ir ../supabase/migrations/20261031095724_video_processing_queue.sql
\ir ../supabase/migrations/20261101051116_video_reservation_budget.sql
\ir ../supabase/migrations/20261101062051_interview_observability.sql
do $$
declare v_id uuid:='33333333-3333-4333-8333-333333333333'; token uuid:='44444444-4444-4444-8444-444444444444'; m jsonb;
begin
 if (select expires_at from video_spike_recordings where id=v_id) is not null then raise exception 'legacy expiry retained';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='video_spike_recordings' and column_name='expires_at' and (is_nullable<>'YES' or column_default is not null)) then raise exception 'new recordings still expire';end if;
 if has_table_privilege('authenticated','public.video_spike_recordings','select') or has_function_privilege('authenticated','public.video_spike_finalize(uuid,jsonb,text)','execute') then raise exception 'browser privileges leaked'; end if;
 if not (select relrowsecurity from pg_class where oid='public.video_spike_recordings'::regclass) then raise exception 'RLS missing'; end if;
 perform video_spike_chunk(v_id,0,10,repeat('a',64),5000,false);
 begin perform video_spike_chunk(v_id,0,11,repeat('a',64),5000,false);raise exception 'accepted conflicting chunk';exception when raise_exception then if sqlerrm<>'chunk_conflict' then raise;end if;end;
 m:=jsonb_build_object('id',v_id,'sessionId','22222222-2222-4222-8222-222222222222','generation',1,'mimeType','video/webm;codecs=vp8,opus','sealed',true,'partial',false,'chunks',jsonb_build_array(jsonb_build_object('sequence',0,'bytes',10,'sha256',repeat('a',64),'endMs',5000)));
 begin perform video_spike_finalize(v_id,m,'manifest-hash');raise exception 'finalized unacknowledged chunk';exception when raise_exception then if sqlerrm<>'chunk_missing_or_conflicting' then raise;end if;end;
 perform video_spike_chunk(v_id,0,10,repeat('a',64),5000,true);
 if video_spike_finalize(v_id,m,'manifest-hash')<>'processing' then raise exception 'not processing';end if;
 if video_spike_finalize(v_id,m,'manifest-hash')<>'processing' then raise exception 'duplicate finalize changed state';end if;
 begin perform video_spike_finalize(v_id,m,'different-hash');raise exception 'accepted changed manifest';exception when raise_exception then if sqlerrm<>'manifest_conflict' then raise;end if;end;
 if not video_spike_claim(v_id,token) then raise exception 'claim failed';end if;
 if video_spike_claim(v_id,gen_random_uuid()) then raise exception 'double claimed';end if;
 if video_spike_complete(v_id,gen_random_uuid(),'wrong.webm',5,null) then raise exception 'stale worker committed';end if;
 if not video_spike_complete(v_id,token,null,null,'processing_failed') then raise exception 'failure not saved';end if;
 if not video_spike_retry(v_id) or not video_spike_claim(v_id,token) then raise exception 'retry failed';end if;
 if not video_spike_complete(v_id,token,'valid.webm',5,null) then raise exception 'ready not saved';end if;
 if (select state from video_spike_recordings where video_spike_recordings.id=v_id)<>'ready' then raise exception 'not ready';end if;
 update video_spike_recordings set state='deleted',output_path=null where video_spike_recordings.id=v_id;
 begin perform video_spike_finalize(v_id,m,'manifest-hash');raise exception 'resurrected tombstone';exception when raise_exception then if sqlerrm<>'recording_closed' then raise;end if;end;
 if video_spike_claim(v_id,token) or video_spike_retry(v_id) or video_spike_complete(v_id,token,'stale.webm',5,null) then raise exception 'worker resurrected tombstone';end if;
end $$;
-- Scheduled queue: retries back off, crashed leases recover, and exhausted work stops.
do $$
declare sid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();
begin
 insert into sessions values(sid);
 insert into video_spike_recordings(id,session_id,owner_id,consent_version,state,manifest_hash,manifest)
 values(rid,sid,'11111111-1111-4111-8111-111111111111','internal-video-spike-v1','processing','sealed','{"partial":true}');
 if video_spike_claim_next(t1) is distinct from rid then raise exception 'queue missed finalized work';end if;
 if video_spike_claim_next(t2) is not null then raise exception 'queue double claimed';end if;
 if not video_spike_heartbeat(rid,t1) or video_spike_heartbeat(rid,t2) then raise exception 'heartbeat fencing failed';end if;
 perform video_spike_complete(rid,t1,null,null,'output_upload_failed');
 if video_spike_claim_next(t2) is not null then raise exception 'retry ignored backoff';end if;
 update video_spike_recordings set next_processing_at=now()-interval '1 second' where id=rid;
 if video_spike_claim_next(t2) is distinct from rid then raise exception 'retry not scheduled';end if;
 update video_spike_recordings set lease_until=now()-interval '1 second' where id=rid;
 if video_spike_claim_next(t1) is distinct from rid then raise exception 'crash not recovered';end if;
 if video_spike_complete(rid,t2,'stale.webm',5,null) then raise exception 'stale worker published';end if;
 update video_spike_recordings set lease_until=now()-interval '1 second' where id=rid;
 if video_spike_claim_next(t2) is not null then raise exception 'unbounded retries';end if;
 if (select state from video_spike_recordings where id=rid)<>'failed' then raise exception 'exhausted work not failed';end if;
 if not video_spike_retry(rid) or not video_spike_claim(rid,t1) then raise exception 'operator retry failed';end if;
 if not video_spike_complete(rid,t1,'partial.webm',5,null) then raise exception 'partial completion failed';end if;
 if (select state from video_spike_recordings where id=rid)<>'partial' then raise exception 'partial became complete';end if;
 if has_function_privilege('authenticated','public.video_spike_claim_next(uuid)','execute') or has_function_privilege('anon','public.video_spike_heartbeat(uuid,uuid)','execute') then raise exception 'queue grants leaked';end if;
end $$;
-- Corruption is terminal; infrastructure timeouts schedule recovery without deleting media.
do $$
declare sid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();token uuid:=gen_random_uuid();
begin
 insert into sessions values(sid);
 insert into video_spike_recordings(id,session_id,owner_id,consent_version,state,manifest_hash,manifest)
 values(rid,sid,'11111111-1111-4111-8111-111111111111','internal-video-spike-v1','processing','sealed','{"partial":false}');
 perform video_spike_claim(rid,token);
 perform video_spike_complete(rid,token,null,null,'media_invalid');
 if (select next_processing_at from video_spike_recordings where id=rid) is not null then raise exception 'corrupt media retried automatically';end if;
 if not video_spike_retry(rid) or not video_spike_claim(rid,token) then raise exception 'operator recovery unavailable';end if;
 perform video_spike_complete(rid,token,null,null,'processing_timeout');
 if (select next_processing_at from video_spike_recordings where id=rid) is null then raise exception 'timeout not retried';end if;
end $$;
-- Reservations cannot consume more storage than the final recording budget.
do $$
declare sid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();i integer;
begin
 insert into sessions values(sid);
 insert into video_spike_recordings(id,session_id,owner_id,consent_version)
 values(rid,sid,'11111111-1111-4111-8111-111111111111','internal-video-spike-v1');
 for i in 0..19 loop perform video_spike_chunk(rid,i,20971520,repeat('b',64),(i+1)*5000,false);end loop;
 if (select sum(bytes) from video_spike_chunks where recording_id=rid)<>419430400 then raise exception 'budget boundary rejected';end if;
 -- Exact retries and acknowledgements do not reserve bytes twice at the limit.
 perform video_spike_chunk(rid,0,20971520,repeat('b',64),5000,true);
 if not video_spike_chunk(rid,0,20971520,repeat('b',64),5000,false) then raise exception 'lost acknowledgement cannot recover';end if;
 begin
  perform video_spike_chunk(rid,20,1,repeat('b',64),105000,false);
  raise exception 'reserved beyond recording budget';
 exception when raise_exception then if sqlerrm<>'recording_too_large' then raise;end if;end;
 if (select count(*) from video_spike_chunks where recording_id=rid)<>20 then raise exception 'failed reservation persisted';end if;
 if (select expires_at from video_spike_recordings where id=rid) is not null then raise exception 'retention changed';end if;
end $$;
-- Numeric measurements are idempotent, private, and do not alter retention.
do $$
declare sid uuid:='22222222-2222-4222-8222-222222222222'; eid uuid:=gen_random_uuid(); events jsonb;
begin
 events:=jsonb_build_array(jsonb_build_object('id',eid,'kind','voice_response','durationMs',1500));
 perform record_interview_observations(sid,'client',events);
 perform record_interview_observations(sid,'client',events);
 if (select count(*) from interview_observations where id=eid)<>1 then raise exception 'duplicate telemetry';end if;
 if has_table_privilege('anon','public.interview_observations','select') or has_table_privilege('authenticated','public.interview_observations','insert') or has_function_privilege('anon','public.interview_health()','execute') then raise exception 'telemetry grants leaked';end if;
 if not (select relrowsecurity from pg_class where oid='public.interview_observations'::regclass) then raise exception 'telemetry RLS missing';end if;
 if (interview_health()->>'windowMinutes')::int<>15 then raise exception 'health query failed';end if;
 if exists(select 1 from video_spike_recordings where expires_at is not null) then raise exception 'retention changed';end if;
end $$;
rollback;
