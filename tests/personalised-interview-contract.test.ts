import assert from 'node:assert/strict';
import test from 'node:test';
import {initialQuestionSchema,selectInterviewProject} from '../src/lib/personalised-interview-contract';
import {questionFollowUpLimit} from '../src/lib/follow-up-depth';
import {interviewerNote,interviewerNoteLine} from '../src/lib/follow-up-policy';
import {apiInviteSchema} from '../src/lib/api-feature-schemas';
test('project selection never silently chooses among multiple projects',()=>{
 assert.equal(selectInterviewProject(undefined,['a','b']),null);
 assert.equal(selectInterviewProject('b',['a','b']),'b');
 assert.equal(selectInterviewProject('other',['a','b']),null);
 assert.equal(selectInterviewProject(undefined,['a']),'a');
});
test('atomic question contract preserves legacy replay and supports optional closing',()=>{
 const old=[{text:'Tell us about your work'}];assert.deepEqual(initialQuestionSchema.parse(old),old);
 assert.ok(initialQuestionSchema.safeParse([{text:'Anything to add?',isRequired:false,maxFollowUps:0}]).success);
 for(const maxFollowUps of [-1,3,1.5,'1'])assert.equal(initialQuestionSchema.safeParse([{text:'Question',maxFollowUps}]).success,false);
});
test('core questions accept a private interviewer note',()=>{
 assert.deepEqual(initialQuestionSchema.parse([{text:'Reconcile a pay run',maxFollowUps:2,interviewerNote:'  Names a specific check  '}]),[{text:'Reconcile a pay run',maxFollowUps:2,interviewerNote:'Names a specific check'}]);
 for(const note of ['',' ','x'.repeat(1201),42])assert.equal(initialQuestionSchema.safeParse([{text:'Question',interviewerNote:note}]).success,false);
 assert.equal(initialQuestionSchema.safeParse([{text:'Question',note:'Unknown key'}]).success,false);
});
test('invite questions accept legacy strings and objects with a note and limit',()=>{
 const followUpQuestions=['Which payroll system did you use?',{text:'How did you fix a missed super payment?',interviewerNote:'Explains the fix and the outcome',maxFollowUps:2},{text:'Which award do you know best?'}];
 assert.deepEqual(apiInviteSchema.parse({followUpQuestions}).followUpQuestions,followUpQuestions);
 for(const item of [{text:'Q',maxFollowUps:3},{text:'Q',interviewerNote:'x'.repeat(1201)},{text:'Q',extra:true},{interviewerNote:'No text'},{text:''},''])
  assert.equal(apiInviteSchema.safeParse({followUpQuestions:[item]}).success,false);
 assert.equal(apiInviteSchema.safeParse({followUpQuestions:Array(6).fill('Q')}).success,false);
});
test('the interviewer note is read from options only when it is a real string',()=>{
 assert.equal(interviewerNote({maxFollowUps:2,interviewerNote:' Shows the result '}),'Shows the result');
 for(const options of [null,undefined,{},{interviewerNote:''},{interviewerNote:42},'note'])assert.equal(interviewerNote(options),null);
 assert.match(interviewerNoteLine('Shows the result'),/^Private interviewer note .*never reveal.*: Shows the result$/);
});
test('per-question limit overrides depth without changing legacy behavior',()=>{
 assert.equal(questionFollowUpLimit('DEEP',{options:{maxFollowUps:0}}),0);
 assert.equal(questionFollowUpLimit('LIGHT',{options:{maxFollowUps:1}}),1);
 assert.equal(questionFollowUpLimit('MODERATE',{}),2);
 assert.equal(questionFollowUpLimit('LIGHT',{options:{maxFollowUps:99}}),0);
});

process.env.SUPABASE_URL='http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
test('creation route passes scoped atomic payload and rejects ambiguous or foreign projects',async()=>{
 const original=globalThis.fetch;let calls=0;let payload:Record<string,unknown>={};
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'http://127.0.0.1:1');
  if(url.pathname.endsWith('api_keys'))return Response.json({userId:'actor',isActive:true});
  if(url.pathname.endsWith('organization_members'))return Response.json({workspaceId:'org',role:'OWNER'});
  if(url.pathname.endsWith('projects'))return Response.json([{id:'a'},{id:'b'}]);
  if(url.pathname.endsWith('project_members'))return Response.json(null);
  if(url.pathname.endsWith('create_api_interview')){calls++;payload=JSON.parse(String(init?.body));return Response.json({id:'created',projectId:payload.p_project});}
  throw new Error('Unexpected database access');
 };
 process.env.AURAL_INVITE_LIFECYCLE_ENABLED='true';
 try{
  const {POST}=await import('../src/app/api/v1/interviews/route');
  const req=(extra:Record<string,unknown>)=>new Request('https://test.example',{method:'POST',headers:{authorization:'Bearer dlv_test','Idempotency-Key':'introduction:test'},body:JSON.stringify({title:'Introduction',questions:[{text:'Anything else?',isRequired:false,maxFollowUps:0}],...extra})});
  assert.equal((await POST(req({}))).status,400);
  assert.equal((await POST(req({projectId:'outside'}))).status,400);
  assert.equal((await POST(req({projectId:'b'}))).status,200);
  assert.equal(calls,1);assert.equal(payload.p_project,'b');
  assert.deepEqual((payload.p_input as Record<string,unknown>).questions,[{text:'Anything else?',isRequired:false,maxFollowUps:0}]);
 }finally{globalThis.fetch=original;delete process.env.AURAL_INVITE_LIFECYCLE_ENABLED;}
});

import { reportEvidence } from "../src/lib/report-evidence";
test("only core turns reach the scorer and private answers remain supporting evidence", () => {
  const plan = [{ id: "1", text: "Reconcile a pay run" }, { id: "2", text: "Check an award" }, { id: "3", text: "Explain your Xero reconciliation", source: "invite" }];
  const turns = [
    { questionId: "1", role: "USER", content: "I compare the register with the ledger." },
    { questionId: "3", role: "USER", content: "I used the Xero clearing account." },
  ];
  const evidence = reportEvidence(plan, turns);
  assert.equal(reportEvidence(plan, [turns[1]]).canScore, false);
  assert.deepEqual(evidence.questions, [plan[0]]);
  assert.deepEqual(evidence.turns, [turns[0]]);
  assert.deepEqual(evidence.supporting, ["Supporting evidence — Explain your Xero reconciliation\nApplicant: I used the Xero clearing account."]);
});
