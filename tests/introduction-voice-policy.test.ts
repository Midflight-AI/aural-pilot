import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { introductionPrompt, introductionStyle, transitionAllowed } from '../server/introduction-voice-policy';

test('introduction accepts short answers but never transitions before an answer or during speech',()=>{
 const base={introduction:true,speechActive:false,words:1,dwellMs:500,userRequested:false,forward:true};
 assert.equal(transitionAllowed(base),true);
 assert.equal(transitionAllowed({...base,words:0}),false);
 assert.equal(transitionAllowed({...base,speechActive:true}),false);
 assert.equal(transitionAllowed({...base,introduction:false}),false);
 assert.equal(transitionAllowed({...base,introduction:false,words:20,dwellMs:15000}),true);
 assert.equal(introductionStyle(undefined),false);
});
test('introduction policy replaces generic interviewer pressure and preserves questions and corrections',()=>{
 const p=introductionPrompt({name:'Amped',title:'Introduction',language:'English',questionList:'1. Payroll responsibility (maximum follow-ups: 0)',currentQuestion:1,questionCount:6});
 assert.match(p,/zero means ask the next question after an answer or explicit skip/);
 assert.match(p,/can be complete answers/);
 assert.match(p,/Accept corrections/);
 assert.match(p,/Do not replace these with a rotating list of filler/);
 assert.match(p,/questionIndex=6/);
 assert.doesNotMatch(p,/MUST wait for a detailed/);
});

// Exercise the actual relay callbacks with a fake clock; no network, provider or microphone.
const source=readFileSync(new URL('../server/openai-voice-relay.ts',import.meta.url),'utf8');
function callback(name:string){
 const file=ts.createSourceFile('relay.ts',source,ts.ScriptTarget.Latest,true);
 let result='';
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)result=node.getText(file);else ts.forEachChild(node,visit)};
 visit(file);assert.ok(result);return result;
}
function harness(){
 const body=`
 let vadSpeechActive=false,pendingInputFlush=null,pendingSpeechFinalize=null,queuedAssistantResponse=null,
 speechStopForwardGraceUntil=0,lastTranscriptUpdateAt=0,speechTranscriptCommitted=false;
 const USER_INPUT_FLUSH_MS=3000;
 let requests=0,commits=0,deferred=0;
 const tasks=new Map();let serial=0;
 const setTimeout=(fn)=>{tasks.set(++serial,fn);return serial};const clearTimeout=id=>tasks.delete(id);
 const log={debug(){}};const send=()=>{};const shouldSplitUserTurnOnSpeechStart=()=>false;
 const cancelOngoingResponse=()=>{};const clearSpeechFinalizeTimer=()=>{};
 const observations={emit(){deferred++}};
 const commitUserTranscript=()=>{commits++;return 'No'};
 const handleCommittedUserText=()=>{requests++};
 ${callback('flushUserInput')}
 ${callback('scheduleInputFlush')}
 ${callback('handleSpeechStartedEvent')}
 ${callback('requestAssistantResponse')}
 return {schedule:scheduleInputFlush,start:handleSpeechStartedEvent,flush:flushUserInput,
 request:()=>requestAssistantResponse('test'),advance:()=>{for(const f of tasks.values())f();tasks.clear()},
 stats:()=>({requests,commits,deferred,pending:tasks.size})};`;
 return new Function(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
}
test('resuming speech cancels the old transcript timer and prevents a stale reply',()=>{
 const h=harness();h.schedule();assert.equal(h.stats().pending,1);h.start();h.advance();
 assert.deepEqual(h.stats(),{requests:0,commits:0,deferred:0,pending:0});
});
test('all response requests and explicit flushes are blocked while speech is active',()=>{
 const h=harness();h.start();h.flush();h.request();
 assert.equal(h.stats().requests,0);assert.equal(h.stats().commits,0);assert.equal(h.stats().deferred,1);
});
test('normal finished speech still commits and requests an answer',()=>{
 const h=harness();h.schedule();h.advance();assert.equal(h.stats().requests,1);assert.equal(h.stats().commits,1);
});

test('introduction explores useful detail without treating thinking phrases as answers or pushing refusals',()=>{
 const p=introductionPrompt({name:'Amped',title:'Introduction',language:'English',questionList:'1. Responsibilities (maximum follow-ups: 1)\n2. CV example (maximum follow-ups: 2)',currentQuestion:1,questionCount:2});
 assert.match(p,/not answers or requests to skip/);
 assert.match(p,/ceilings, not targets/);
 assert.match(p,/Never ask for more detail after an explicit refusal/);
 assert.match(p,/Do not return to a completed question/);
 assert.doesNotMatch(p,/Usually go directly to the next question/);
});
