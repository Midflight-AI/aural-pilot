import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";

test("lost acknowledgement recovers existing immutable bytes, never corrupt or missing data", async t => {
 process.env.SUPABASE_URL ||= "https://test.supabase.co";
 process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-only";
 const {supabaseAdmin:db}=await import("../src/lib/supabase/admin");
 const {grantChunkUpload}=await import("../src/lib/video/server");
 const bytes=new Blob(["uploaded before the network dropped"]);
 const descriptor={sequence:0,bytes:bytes.size,sha256:createHash("sha256").update(Buffer.from(await bytes.arrayBuffer())).digest("hex"),endMs:5000};
 let mode="existing";let acks=0;
 t.mock.method(db.storage,"from",()=>({
  async createSignedUploadUrl(){return mode==="new"?{data:{signedUrl:"https://storage.example/upload"},error:null}:{data:null,error:{message:"object already exists"}};},
  async download(){return mode==="missing"?{data:null,error:{message:"missing"}}:{data:mode==="corrupt"?new Blob(["bad"]):bytes,error:null};},
 }));
 t.mock.method(db,"rpc",async(_name:string,args:Record<string,unknown>)=>{assert.equal(args?.p_ack,true);acks++;return {data:true,error:null};});
 assert.deepEqual(await grantChunkUpload("recording",descriptor),{acknowledged:true});assert.equal(acks,1);
 mode="corrupt";await assert.rejects(grantChunkUpload("recording",descriptor),/chunk_corrupt/);
 mode="missing";await assert.rejects(grantChunkUpload("recording",descriptor),/upload_unavailable/);assert.equal(acks,1);
 mode="new";assert.deepEqual(await grantChunkUpload("recording",descriptor),{url:"https://storage.example/upload",acknowledged:false});assert.equal(acks,1);
});
