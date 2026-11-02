import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicIPv4,destinationUrl,deliveryOutcome,deliveryHeaders} from '../src/lib/webhooks/delivery';
test('public-only pinned egress and exact destinations',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1']) assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('8.8.8.8'),true);
 const url='https://ramp.example/api/integrations/aural/webhooks/endpoint';
 assert.equal(destinationUrl(url,[url]).href,url);
 for(const value of ['http://ramp.example/api/integrations/aural/webhooks/endpoint',url+'?token=secret',url.replace('ramp.example','127.0.0.1'),url.replace('ramp.example','other.example')]) assert.throws(()=>destinationUrl(value,[url]));
});
test('bounded retries, dead letters and independent delivery signatures',()=>{
 assert.equal(deliveryOutcome(202,1).state,'delivered');
 for(const status of [null,408,429,500,503]) assert.equal(deliveryOutcome(status,1).state,'pending');
 for(const status of [301,400,401,403,404,409]) assert.equal(deliveryOutcome(status,1).state,'dead');
 assert.equal(deliveryOutcome(503,8).state,'dead');
 assert.equal(deliveryOutcome(429,1,'99999999').delay,86400);
 assert.equal(deliveryOutcome(503,1,undefined,0,0).delay,60);
 const destination={id:'subscription',projectId:'project',url:'https://example.test',keyId:'current',secret:'x'.repeat(32),expiresAt:'2027-01-01'};
 const first=deliveryHeaders('{"id":"event"}','event',destination,1000000);
 const retry=deliveryHeaders('{"id":"event"}','event',destination,1060000);
 assert.equal(first['Aural-Event-Id'],retry['Aural-Event-Id']);
 assert.notEqual(first['Aural-Signature'],retry['Aural-Signature']);
});
