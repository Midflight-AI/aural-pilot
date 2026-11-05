-- Included by provider-release.sql on disposable CI PostgreSQL only.
-- Compare the actual grants before/after; policy exercises temporarily grant
-- access inside a rolled-back transaction and never change the pilot boundary.
begin;
create temp table grants_before as
select oid,relacl from pg_class where relnamespace='public'::regnamespace;
\ir ../../supabase/migrations/20261105093133_database_advisor_hardening.sql
do $$
begin
  if exists(select 1 from grants_before b join pg_class c on c.oid=b.oid
    where b.relacl is distinct from c.relacl) then raise exception 'migration changed table grants'; end if;
  if to_regclass('public.idx_interviews_organization') is not null
    or to_regclass('public.idx_interviews_project') is null then raise exception 'duplicate index cleanup failed'; end if;
  if not exists(select 1 from pg_proc where oid='public.update_updated_at()'::regprocedure
    and proconfig @> array['search_path=""']) then raise exception 'trigger search path not pinned'; end if;
  if (select count(*) from pg_policy where polrelid='public.project_members'::regclass and polcmd in ('r','*'))<>1
    then raise exception 'overlapping member read policies remain'; end if;
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename in ('support_tickets','prep_sessions','prep_attempts','prep_answer_bank')
    and coalesce(qual,with_check) not like '%SELECT auth.uid()%') then raise exception 'per-row auth call remains'; end if;
  if has_table_privilege('authenticated','public.project_members','select')
    or has_table_privilege('anon','public.prep_sessions','select')
    then raise exception 'pilot browser access expanded'; end if;
end $$;

-- Exercise identity-sensitive RLS with real claims and three isolated users.
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant select,insert,update,delete on public.support_tickets,public.prep_sessions,
  public.prep_attempts,public.prep_answer_bank,public.project_members to authenticated;
grant select on public.projects,public.organization_members,public.organizations to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
insert into pilot_private.allowed_emails values
  ('advisor-owner@example.invalid'),('advisor-member@example.invalid'),('advisor-other@example.invalid');
insert into auth.users(id,email) values
  ('a0000000-0000-4000-8000-000000000001','advisor-owner@example.invalid'),
  ('a0000000-0000-4000-8000-000000000002','advisor-member@example.invalid'),
  ('a0000000-0000-4000-8000-000000000003','advisor-other@example.invalid');
-- The real signup trigger creates a personal organization and project per user.
insert into public.organization_members("workspaceId","userId",role)
select "organizationId",'a0000000-0000-4000-8000-000000000002','MEMBER'
from public.projects where "createdBy"='a0000000-0000-4000-8000-000000000001';
insert into public.interviews(id,title,"userId","projectId")
select 'b0000000-0000-4000-8000-000000000001','Advisor CI',"createdBy",id
from public.projects where "createdBy"='a0000000-0000-4000-8000-000000000001';
insert into public.questions(id,"interviewId",text,type,"order") values
  ('c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','CI question','OPEN_ENDED',0);

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare pid uuid; foreign_pid uuid;
begin
  select id into strict pid from public.projects where "createdBy"=auth.uid();
  insert into public.project_members("projectId","userId") values(pid,'a0000000-0000-4000-8000-000000000002');
  update public.project_members set role='VIEWER' where "projectId"=pid;
  if not exists(select 1 from public.project_members where "projectId"=pid and role='VIEWER')
    then raise exception 'admin update did not read back'; end if;
  insert into public.support_tickets(user_id,message) values(auth.uid(),'Normal support ticket');
  begin
    insert into public.support_tickets(user_id,message) values('a0000000-0000-4000-8000-000000000003','Forbidden');
    raise exception 'cross-user ticket accepted';
  exception when insufficient_privilege then null; end;
  insert into public.support_tickets(user_id,message) values(auth.uid(),'Retry after refusal');
  if (select count(*) from public.support_tickets)<>2 then raise exception 'ticket read/retry failed'; end if;
  insert into public.prep_sessions(id,"interviewId","userId","updatedAt") values
    ('d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',auth.uid(),'2000-01-01');
  update public.prep_sessions set status='COMPLETED' where "userId"=auth.uid();
  if not exists(select 1 from public.prep_sessions where status='COMPLETED' and "updatedAt">'2000-01-01')
    then raise exception 'search-path-hardened trigger or session update failed'; end if;
  insert into public.prep_attempts(id,"sessionId","interviewId","questionId","userId","answerText") values
    ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',
     'b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',auth.uid(),'First answer');
  update public.prep_attempts set "answerText"='Saved answer' where "userId"=auth.uid();
  insert into public.prep_answer_bank("userId","questionText","answerText",note)
    values(auth.uid(),'Question','Answer','First');
  update public.prep_answer_bank set note='Saved' where "userId"=auth.uid();
  if not exists(select 1 from public.prep_attempts where "answerText"='Saved answer')
    or not exists(select 1 from public.prep_answer_bank where note='Saved')
    then raise exception 'prep updates did not read back'; end if;
end $$;

-- Ordinary organization members retain read access without admin writes.
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
do $$
declare pid uuid; affected int; target regclass;
begin
  select id into strict pid from public.projects where "createdBy"='a0000000-0000-4000-8000-000000000001';
  if (select count(*) from public.project_members where "projectId"=pid)<>1 then raise exception 'member read lost'; end if;
  begin
    insert into public.project_members("projectId","userId") values(pid,auth.uid());
    raise exception 'ordinary member created membership';
  exception when insufficient_privilege then null; end;
  update public.project_members set role='ADMIN' where "projectId"=pid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'ordinary member escalated membership'; end if;
  delete from public.project_members where "projectId"=pid;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'ordinary member deleted membership'; end if;
  if exists(select 1 from public.support_tickets) then raise exception 'cross-user ticket read'; end if;
  foreach target in array array['public.prep_sessions'::regclass,'public.prep_attempts'::regclass,'public.prep_answer_bank'::regclass] loop
    execute format('select count(*) from %s',target) into affected;
    if affected<>0 then raise exception 'cross-user prep read: %',target; end if;
    execute format('delete from %s',target);
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'cross-user prep delete: %',target; end if;
  end loop;
  begin
    insert into public.prep_sessions("interviewId","userId") values('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001');
    raise exception 'cross-user prep session accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.prep_attempts("sessionId","interviewId","questionId","userId","answerText") values
      ('d0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',
       'c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Forbidden');
    raise exception 'cross-user prep attempt accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.prep_answer_bank("userId","questionText","answerText") values
      ('a0000000-0000-4000-8000-000000000001','Question','Forbidden');
    raise exception 'cross-user answer bank accepted';
  exception when insufficient_privilege then null; end;
end $$;

-- A member of a different organization cannot see or write the first org.
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000003',true);
do $$ begin
  if exists(select 1 from public.project_members) then raise exception 'cross-org member read'; end if;
end $$;
reset role;
-- Check WITH CHECK rejects moving an existing membership into another org.
select set_config('advisor.foreign_project',(select id::text from public.projects
  where "createdBy"='a0000000-0000-4000-8000-000000000003'),true);
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  begin
    update public.project_members set "projectId"=current_setting('advisor.foreign_project')::uuid;
    raise exception 'admin moved membership across organizations';
  exception when insufficient_privilege then null; end;
  delete from public.project_members;
  if exists(select 1 from public.project_members) then raise exception 'admin delete failed'; end if;
  delete from public.prep_answer_bank;
  delete from public.prep_attempts;
  delete from public.prep_sessions;
  if exists(select 1 from public.prep_sessions) or exists(select 1 from public.prep_attempts)
    or exists(select 1 from public.prep_answer_bank) then raise exception 'owner prep delete failed'; end if;
end $$;
reset role;
rollback;
\echo 'Database advisor hardening: access, denial, retry, trigger and index checks passed'
