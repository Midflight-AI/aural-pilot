import { test } from "node:test";
import assert from "node:assert/strict";
import { orderedPrefetch, processingClaims } from "../src/lib/video/processing-schedule";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("prefetch overlaps four downloads, preserves order and bounds retained work", async () => {
 const started: number[] = [];
 const done = new Map<number, (n:number) => void>();
 const queue = orderedPrefetch([0,1,2,3,4,5], async n => { started.push(n); return new Promise<number>(resolve => done.set(n,resolve)); }, new AbortController().signal);
 const first = queue.next(); await tick();
 assert.deepEqual(started,[0,1,2,3]);
 done.get(3)!(3); done.get(2)!(2); done.get(1)!(1); await tick();
 assert.deepEqual(started,[0,1,2,3]);
 done.get(0)!(0); assert.equal((await first).value,0);
 assert.equal((await queue.next()).value,1); await tick();
 assert.deepEqual(started,[0,1,2,3,4]);
 assert.equal((await queue.next()).value,2); await tick();
 done.get(4)!(4); done.get(5)!(5);
 assert.equal((await queue.next()).value,3); assert.equal((await queue.next()).value,4); assert.equal((await queue.next()).value,5);
 assert.equal((await queue.next()).done,true);
});
test("early consumer exit cancels and drains remaining downloads", async()=>{
 let aborted=0;
 const queue=orderedPrefetch([0,1,2,3,4],async(n,signal)=>{
  if(n===0)return n;
  return new Promise<number>((_,reject)=>signal.addEventListener("abort",()=>{aborted++;reject(signal.reason);},{once:true}));
 },new AbortController().signal);
 for await(const n of queue){assert.equal(n,0);break;}
 assert.equal(aborted,3);
});
test("future download failure is handled and surfaced without reordering",async()=>{
 const output:number[]=[];
 await assert.rejects(async()=>{for await(const n of orderedPrefetch([0,1,2],async n=>{if(n===2)throw Error("chunk_corrupt");await tick();return n;},new AbortController().signal))output.push(n);},/chunk_corrupt/);
 assert.deepEqual(output,[0,1]);
});
test("lease cancellation prevents more downloads",async()=>{
 const control=new AbortController();let calls=0;
 const queue=orderedPrefetch([0,1,2,3,4,5],async n=>{calls++;return n;},control.signal);
 assert.equal((await queue.next()).value,0);control.abort();
 await assert.rejects(queue.next(),{name:"AbortError"});assert.equal(calls,4);
});
test("a finishing worker drains a burst beyond the former three-job limit",async()=>{
 const work=["b","c","d","e","f"];const seen:(string|undefined)[]=[];const result=[];
 for await(const job of processingClaims(async id=>{seen.push(id);return id??work.shift()??null;},100000,"a",()=>0))result.push(job);
 assert.deepEqual(result,["a","b","c","d","e","f"]);assert.equal(seen.filter(Boolean).length,1);
});
test("already claimed preferred job does not strand other work; deadline bounds draining",async()=>{
 let time=0;let calls=0;const result=[];
 for await(const job of processingClaims(async id=>{calls++;return id?null:"queued";},100000,"busy",()=>time)){result.push(job);time=70000;}
 assert.deepEqual(result,["queued"]);assert.equal(calls,2);
});
