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
do $$
declare v_id uuid:='33333333-3333-4333-8333-333333333333'; token uuid:='44444444-4444-4444-8444-444444444444'; m jsonb;
begin
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
rollback;
