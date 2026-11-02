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
 let introductionPlanEpoch=0,introductionPlanAbort=null;
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

test('hard follow-up ceiling advances after the answer, while thinking and refusals remain distinct',async()=>{
 const {introductionTurnAction}=await import('../server/introduction-voice-policy');
 assert.equal(introductionTurnAction('A supportive team',1,1),'respond');
 assert.equal(introductionTurnAction('Growth and more responsibility',2,1),'advance');
 assert.equal(introductionTurnAction('I checked three months of records and raised the concern',2,2),'respond');
 assert.equal(introductionTurnAction('My tip-off started the investigation',3,2),'advance');
 assert.equal(introductionTurnAction("That's a good one.",3,2),'wait');
 assert.equal(introductionTurnAction("I can't remember.",1,2),'advance');
});

test('participant contribution remains available after advancing to another question',async()=>{
 const {introductionEvidence}=await import('../server/introduction-voice-policy');
 const evidence=introductionEvidence([{question:3,text:'I reviewed three months of timesheets and initiated the investigation.'}]);
 assert.match(evidence,/initiated the investigation/);
 assert.match(evidence,/Ask only for genuinely missing information/);
});

test('skip and budget transitions reset counters and complete the last question',()=>{
 const body=callback('requestTransition');
 const code=`let introductionPlanEpoch=0,introductionPlanAbort=null,plannedIntroductionSpeech=null; let isTransitioning=false,queuedAssistantResponse=null,currentQuestionIndex=0,userCommittedWordsThisQuestion=6,assistantTurnsThisQuestion=3,followUpLimitNoticeSent=true,questionEnteredAt=0,interviewDone=false,pendingInterviewComplete=false,interviewCompleteTimer=null;
 const sortedQuestions=[{text:'Team'},{text:'Contribution'}],log={info(){}},events=[],prompts=[],timers=[];
 const clearPendingTransition=()=>{},clearQuestionPrompt=()=>{},cancelOngoingResponse=()=>{},disableTools=()=>{},pushHistory=()=>{},markInterviewComplete=()=>{};
 const send=x=>events.push(x),sendQuestionPrompt=x=>prompts.push(x),setTimeout=(f)=>{timers.push(f);return 1};
 ${body}
 requestTransition(1,'Next Question','budget');timers.shift()();
 const moved={currentQuestionIndex,assistantTurnsThisQuestion,followUpLimitNoticeSent};
 requestTransition(2,'Next Question','budget');timers.shift()();
 return {moved,interviewDone,prompts};`;
 const result=new Function(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();
 assert.deepEqual(result.moved,{currentQuestionIndex:1,assistantTurnsThisQuestion:0,followUpLimitNoticeSent:false});
 assert.equal(result.interviewDone,true);
 assert.match(result.prompts[1],/farewell only/);
});


test('introduction responses exclude stale interviewer turns and request the authoritative question',()=>{
 const code=callback('requestAssistantResponse');
 assert.match(code,/conversation:\s*"none"/);
 assert.match(code,/text-to-speech reader/);
 assert.match(code,/tools:\[\],tool_choice:"none"/);
});


test('structured planner rejects missing information and malformed decisions',async()=>{
 const {validateIntroductionPlan}=await import('../server/introduction-planner');
 assert.throws(()=>validateIntroductionPlan({action:'follow_up',question:'What did you contribute?',recognition:'',missingDetail:''}));
 assert.throws(()=>validateIntroductionPlan({action:'unknown',question:'',recognition:'',missingDetail:''}));
 assert.deepEqual(validateIntroductionPlan({action:'advance',question:'',recognition:'You initiated the investigation.',missingDetail:''}),{action:'advance',question:'',recognition:'You initiated the investigation.',missingDetail:''});
});
