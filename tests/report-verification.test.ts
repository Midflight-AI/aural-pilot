import assert from 'node:assert/strict';
import test from 'node:test';
import {isVerbatimQuote,participantText,verifiedInsights} from '../src/lib/report-verification';

const turns=[
 {role:'ASSISTANT',content:'Tell me about a video you edited under a tight deadline.'},
 {role:'USER',content:'Last month I cut a 90-second promo in Premiere Pro overnight, because the client moved the launch.'},
];
const said=participantText(turns);

test('a quote counts only when the participant said it word for word',()=>{
 assert.ok(isVerbatimQuote('I cut a 90-second promo in Premiere Pro',said));
 assert.ok(isVerbatimQuote('“I cut a 90 second promo” … the client moved the launch',said));
 assert.equal(isVerbatimQuote('I edited a 90-second promo in Premiere',said),false);
 assert.equal(isVerbatimQuote('Tell me about a video you edited',said),false);
 assert.equal(isVerbatimQuote('Premiere Pro',said),false);
 assert.equal(isVerbatimQuote(42,said),false);
});

test('scores without a verbatim quote are dropped, and invented quotes are removed',()=>{
 const parsed={
  keyInsights:['Works fast'],
  questionEvaluations:[
   {question:'Tight deadline',score:8,evidence:['I cut a 90-second promo in Premiere Pro overnight','I always storyboard first with the team']},
   {question:'Colour grading',score:9,evidence:['I graded the whole series in DaVinci Resolve']},
   {question:'Motion graphics',score:7},
  ],
  criteriaEvaluations:[{name:'Tools',score:6,evidence:['Premiere Pro']}],
 };
 const insights=verifiedInsights(parsed,turns,{canScore:true,supporting:[]});
 assert.deepEqual(insights.questionEvaluations,[{question:'Tight deadline',score:8,evidence:['I cut a 90-second promo in Premiere Pro overnight']}]);
 assert.equal('criteriaEvaluations' in insights,false);
 assert.deepEqual(insights.keyInsights,['Works fast']);
});

test('an empty-answer transcript can never keep a score',()=>{
 const silent=[{role:'ASSISTANT',content:'Walk me through your editing workflow from raw footage to final export.'}];
 const insights=verifiedInsights({questionEvaluations:[{question:'Workflow',score:7,evidence:['Walk me through your editing workflow']}]},silent,{canScore:true,supporting:[]});
 assert.equal('questionEvaluations' in insights,false);
});

test('an introduction stays readable and cannot supply evidence for either part of an interview', async () => {
 const { interviewSections, reportEvidence, hasCandidateAnswers } = await import('../src/lib/report-evidence');
 const intro = {role:'USER', content:'I cook with my family', introductionEndSeconds:31};
 const job = {role:'USER', content:'I tested the backup', questionId:'job'};
 const cv = {role:'USER', content:'I worked on the migration', questionId:'cv'};
 assert.equal(hasCandidateAnswers([intro]), false);
 const questions = [{id:'job',text:'How did you test recovery?'}];
 assert.deepEqual(reportEvidence(questions,[intro,job]).turns,[job]);
 const withCV = reportEvidence([...questions,{id:'cv',text:'Tell me about the migration.',source:'invite'}],[intro,job,cv]);
 assert.deepEqual(withCV.turns,[job]);
 assert.equal(withCV.supporting.length,1);
 assert.ok(!withCV.supporting[0].includes(intro.content));
 assert.deepEqual(interviewSections([intro,job,cv]),{introduction:[intro],messages:[job,cv]});
});
