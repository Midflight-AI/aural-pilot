import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionSnapshot} from '../src/lib/session-snapshot';
import {decodeDeliveryCursor,encodeDeliveryCursor,retryRequest} from '../src/lib/webhooks/api';
test('snapshot reports partial completion and excludes identity, URLs and surveillance fields',()=>{
 const row={id:'s',sync_revision:8,status:'COMPLETED',interview:{id:'i',title:'Interview',projectId:'private'},participantEmail:'private@example.test',summary:null,messages:[{id:'m',role:'USER',content:'Answer',timestamp:'now',secret:'hidden'}],audioRecordingUrl:'https://example.test/private?token=secret',audioRecordings:[{url:'https://example.test/private?token=secret'}],screenshots:['private']};
 const result=sessionSnapshot(row);
 assert.deepEqual(result.readiness,{report:'processing',transcript:'available',recording:'registered'});
 assert.equal(result.session_revision,result.report.session_revision);assert.equal(result.report.audioCount,1);
 for(const secret of ['private@example','token=secret','screenshots','hidden','projectId']) assert.ok(!JSON.stringify(result).includes(secret));
 assert.equal(sessionSnapshot({...row,summary:'Report'}).readiness.report,'ready');
 assert.equal(sessionSnapshot({...row,audioRecordingUrl:null,audioRecordings:[]}).readiness.recording,'missing');
});
test('delivery cursors preserve timestamp precision and reject malformed IDs; retries reject payload changes',()=>{
 const row={occurred_at:'2026-11-01T00:00:00.123456+00:00',event_id:'29e49545-5781-4c3b-b559-cd3bc77a96ae'};
 assert.deepEqual(decodeDeliveryCursor(encodeDeliveryCursor(row)),{at:row.occurred_at,id:row.event_id});
 assert.throws(()=>decodeDeliveryCursor('junk'));
 assert.equal(retryRequest.safeParse({subscription_id:row.event_id,request_id:row.event_id,payload:{}}).success,false);
});
