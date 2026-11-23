-- Preserve the pilot's existing grants and ownership rules. This migration
-- only fixes the advisor warnings; it does not expose browser capabilities.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter function public.update_updated_at() set search_path = '';

alter policy "Users can create their own tickets" on public.support_tickets
  with check ((select auth.uid()) = user_id);
alter policy "Users can view their own tickets" on public.support_tickets
  using ((select auth.uid()) = user_id);
alter policy "Users manage own prep sessions" on public.prep_sessions
  using ("userId" = (select auth.uid()))
  with check ("userId" = (select auth.uid()));
alter policy "Users manage own prep attempts" on public.prep_attempts
  using ("userId" = (select auth.uid()))
  with check ("userId" = (select auth.uid()));
alter policy "Users manage own answer bank" on public.prep_answer_bank
  using ("userId" = (select auth.uid()))
  with check ("userId" = (select auth.uid()));

-- The existing member SELECT policy includes owners and admins. Keep that
-- single read path and split the identical admin predicate by write operation.
drop policy "Org admins can manage project members" on public.project_members;
create policy "Org admins can insert project members" on public.project_members
  for insert with check (exists (
    select 1 from public.projects p
    join public.organization_members om on om."workspaceId" = p."organizationId"
    where p.id = project_members."projectId"
      and om."userId" = (select auth.uid()) and om.role in ('OWNER', 'ADMIN')
  ));
create policy "Org admins can update project members" on public.project_members
  for update using (exists (
    select 1 from public.projects p
    join public.organization_members om on om."workspaceId" = p."organizationId"
    where p.id = project_members."projectId"
      and om."userId" = (select auth.uid()) and om.role in ('OWNER', 'ADMIN')
  )) with check (exists (
    select 1 from public.projects p
    join public.organization_members om on om."workspaceId" = p."organizationId"
    where p.id = project_members."projectId"
      and om."userId" = (select auth.uid()) and om.role in ('OWNER', 'ADMIN')
  ));
create policy "Org admins can delete project members" on public.project_members
  for delete using (exists (
    select 1 from public.projects p
    join public.organization_members om on om."workspaceId" = p."organizationId"
    where p.id = project_members."projectId"
      and om."userId" = (select auth.uid()) and om.role in ('OWNER', 'ADMIN')
  ));

-- Retain the identically keyed index. Fail closed if the retained index has
-- drifted, rather than removing the only usable project lookup index.
do $$
begin
  if not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
    where i.indexrelid='public.idx_interviews_project'::regclass
      and i.indrelid='public.interviews'::regclass
      and i.indisvalid and i.indisready and i.indnkeyatts=1
      and i.indpred is null and i.indexprs is null and a.attname='projectId'
  ) then raise exception 'Retained interviews project index is not usable'; end if;
end $$;
drop index public.idx_interviews_organization;
