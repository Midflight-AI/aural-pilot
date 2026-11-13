-- Disposable CI PostgreSQL only. Never run against a hosted project.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key, bucket_id text, name text);
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
\ir ../../supabase/migrations/001_initial_schema.sql
\ir ../../supabase/migrations/002_activity_segments.sql
\ir ../../supabase/migrations/003_audio_recordings.sql
\ir ../../supabase/migrations/20261031081728_webhook_outbox.sql
\ir ../../supabase/migrations/20261031092022_invite_lifecycle.sql
\ir ../../supabase/migrations/20261101042905_webhook_delivery_controls.sql
\ir ../../supabase/migrations/20261102015331_personalised_interview_contract.sql
\ir ../../supabase/migrations/20261113184630_webhook_delivery_view.sql

insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','provider-ci@example.invalid');
insert into public.interviews(id,title,"userId","projectId")
select '22222222-2222-4222-8222-222222222222','Provider CI',"createdBy",id from public.projects limit 1;
insert into public.sessions(id,"interviewId","participantName")
values('1a698808-3525-4887-91af-19f82b77a01b','22222222-2222-4222-8222-222222222222','Synthetic CI');
\ir webhook-outbox.sql
\ir webhook-controls.sql
\ir webhook-delivery-view.sql
\ir invite-lifecycle.sql
\ir ../../supabase/migrations/004_interview_prep.sql
\ir ../../supabase/migrations/005_account_delete_and_answer_bank.sql
\ir ../../supabase/migrations/006_internal_pilot_access.sql
\ir database-advisor-hardening.sql
