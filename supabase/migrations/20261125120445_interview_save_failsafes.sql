-- The voice relay's own copy of each committed turn. The browser's transcript
-- stays the record; these turns only fill in what the browser failed to save.
create table public.relay_transcript_turns (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 20000),
  question_index integer,
  spoken_at timestamptz not null
);
create index relay_transcript_turns_session on public.relay_transcript_turns(session_id, spoken_at);
alter table public.relay_transcript_turns enable row level security;
revoke all on public.relay_transcript_turns from public, anon, authenticated;
grant all on public.relay_transcript_turns to service_role;

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
    and (exists (select 1 from public.messages m where m."sessionId" = s.id)
      or exists (select 1 from public.relay_transcript_turns r where r.session_id = s.id))
    and not exists (select 1 from public.messages m where m."sessionId" = s.id and m.timestamp >= p_cutoff)
    and not exists (select 1 from public.relay_transcript_turns r where r.session_id = s.id and r.spoken_at >= p_cutoff)
  order by coalesce(s."lastActivityAt", s."startedAt")
  limit p_limit
$$;
revoke all on function public.idle_voice_sessions(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.idle_voice_sessions(timestamptz, integer) to service_role;
