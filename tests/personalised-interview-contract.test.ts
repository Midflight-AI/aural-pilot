import assert from 'node:assert/strict';
import test from 'node:test';
import {initialQuestionSchema,selectInterviewProject} from '../src/lib/personalised-interview-contract';
import {questionFollowUpLimit} from '../src/lib/follow-up-depth';
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
