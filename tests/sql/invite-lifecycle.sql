-- Rollback-only targeted test on the isolated preview; never production.
begin;
do $$
declare actor uuid; project uuid; template uuid; result jsonb; again jsonb; c uuid; token text; changed jsonb; started json; input jsonb;
begin
 select "createdBy",id into actor,project from public.projects order by "createdAt" limit 1;
 if actor is null then raise exception 'A preview project fixture is required'; end if;
 input := jsonb_build_object('title','Invitation lifecycle synthetic test','chatEnabled',false,'voiceEnabled',true,'videoEnabled',false,'aiName','Test','aiTone','FRIENDLY','followUpDepth','LIGHT','language','en','antiCheatingEnabled',false,'questions',jsonb_build_array(jsonb_build_object('text','Synthetic question')));
 result:=public.create_api_interview(actor,project,'test-template-key',input);
 again:=public.create_api_interview(actor,project,'test-template-key',input);
 if result<>again then raise exception 'Template replay changed response'; end if;
 template:=(result->>'id')::uuid;
 if (select count(*) from public.questions where "interviewId"=template)<>1 then raise exception 'Questions not atomic'; end if;
 result:=public.create_api_invites(actor,template,'test-create-key','[{"name":"Synthetic tester","notes":"Synthetic only"}]');
 again:=public.create_api_invites(actor,template,'test-create-key','[{"notes":"Synthetic only","name":"Synthetic tester"}]');
 if result<>again then raise exception 'Replay changed response'; end if;
 if (select count(*) from public.candidates where "interviewId"=template)<>1 then raise exception 'Duplicate invitation'; end if;
 begin
  perform public.create_api_invites(actor,template,'test-create-key','[{"name":"Different"}]'); raise exception 'Expected key conflict';
 exception when raise_exception then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
 c:=(result->0->>'id')::uuid; token:=result->0->>'inviteToken';
 changed:=public.change_api_invite(actor,template,c,'test-cancel-key','{"action":"cancel","version":1}');
 if changed->>'inviteStatus'<>'cancelled' then raise exception 'Cancel not persisted'; end if;
 begin perform public.create_invite_session(token); raise exception 'Cancelled invite started'; exception when raise_exception then if sqlerrm<>'Invitation is cancelled or expired' then raise; end if; end;
 input:=jsonb_build_object('action','reissue','version',2,'expiresAt',now()+interval '1 day');
 changed:=public.change_api_invite(actor,template,c,'test-reissue-key',input);
 again:=public.change_api_invite(actor,template,c,'test-reissue-key',input);
 if changed<>again or changed->>'inviteToken'=token then raise exception 'Rotation replay failed'; end if;
 begin perform public.create_invite_session(token); raise exception 'Old token accepted'; exception when raise_exception then if sqlerrm<>'Invalid invite link' then raise; end if; end;
 token:=changed->>'inviteToken';
 changed:=public.change_api_invite(actor,template,c,'test-expire-key','{"action":"expire","version":3}');
 begin perform public.create_invite_session(token); raise exception 'Expired invite started'; exception when raise_exception then if sqlerrm<>'Invitation is cancelled or expired' then raise; end if; end;
 changed:=public.change_api_invite(actor,template,c,'test-reissue-again',jsonb_build_object('action','reissue','version',4,'expiresAt',now()+interval '1 day'));
 token:=changed->>'inviteToken';
 started:=public.create_invite_session(token);
 if public.create_invite_session(token)::jsonb <> started::jsonb then raise exception 'Double start created duplicate'; end if;
 begin perform public.change_api_invite(actor,template,c,'test-started-key','{"action":"cancel","version":5}'); raise exception 'Started invite cancelled'; exception when raise_exception then if sqlerrm<>'INTERVIEW_ALREADY_STARTED' then raise; end if; end;
 if (select count(*) from public.sessions where "interviewId"=template)<>1 then raise exception 'Session duplication'; end if;
 if has_table_privilege('authenticated','public.api_idempotency','SELECT') or has_function_privilege('anon','public.change_api_invite(uuid,uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'Browser privileges exposed'; end if;
end $$;
select 'template replay, invite replay/conflict, cancel, expiry, rotation, old-token denial, duplicate start, started protection and privileges passed' as result;
rollback;
