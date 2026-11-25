-- Voice sessions whose browser stopped talking to us before it sent "complete"
-- (tab closed, crash, lost connection). The finalize cron completes them so the
-- saved transcript still gets a report. Sessions with no transcript are left alone.
create function public.idle_voice_sessions(p_cutoff timestamptz, p_limit integer)
returns setof uuid language sql stable set search_path='' as $$
  select s.id
  from public.sessions s
  where s.status = 'IN_PROGRESS'
    and s."modeUsed" = 'VOICE'
    and coalesce(s."lastActivityAt", s."startedAt") < p_cutoff
    and exists (select 1 from public.messages m where m."sessionId" = s.id)
    and not exists (select 1 from public.messages m where m."sessionId" = s.id and m.timestamp >= p_cutoff)
  order by coalesce(s."lastActivityAt", s."startedAt")
  limit p_limit
$$;
revoke all on function public.idle_voice_sessions(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.idle_voice_sessions(timestamptz, integer) to service_role;
