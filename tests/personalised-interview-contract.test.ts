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
