import assert from "node:assert/strict";
import test from "node:test";
import { invitationActionSchema, invitationResponse, invitationUnavailable, validIdempotencyKey } from "../src/lib/invite-lifecycle";

test("invitation validation and deadline boundaries", () => {
  assert.ok(validIdempotencyKey("ramp-attempt:00000000"));
  for (const key of [null, "short", "spaces invalid", "x".repeat(129)]) assert.equal(validIdempotencyKey(key), false);
  assert.equal(invitationActionSchema.safeParse({action:"reissue",version:1}).success,false);
  assert.equal(invitationActionSchema.safeParse({action:"cancel",version:0}).success,false);
  assert.equal(invitationActionSchema.safeParse({action:"cancel",version:1,inviteToken:"injected"}).success,false);
  assert.equal(invitationUnavailable({inviteStatus:"active",inviteExpiresAt:"2026-10-31T00:00:00Z"},Date.parse("2026-10-31T00:00:00Z")),true);
  assert.equal(invitationUnavailable({sessionId:"started",inviteStatus:"active",inviteExpiresAt:"2020-01-01T00:00:00Z"}),false);
  assert.equal(invitationResponse({inviteStatus:"cancelled",inviteToken:"old"},"https://test.example").inviteUrl,null);
});

process.env.SUPABASE_URL="http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY="test-key";
test("invitation route authenticates, scopes, validates and preserves idempotency", async () => {
  const original=globalThis.fetch; let role="OWNER",outside=false, rpcCalls=0, last:Record<string,unknown>={};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)); assert.equal(url.origin,"http://127.0.0.1:1");
    if(url.pathname.endsWith("api_keys"))return Response.json({userId:"actor",isActive:true});
    if(url.pathname.endsWith("organization_members"))return Response.json({workspaceId:"org",role});
    if(url.pathname.endsWith("projects"))return Response.json([{id:"project"}]);
    if(url.pathname.endsWith("project_members"))return Response.json(null);
    if(url.pathname.endsWith("interviews"))return Response.json({projectId:outside?"other":"project"});
    if(url.pathname.endsWith("change_api_invite")){rpcCalls++;last=JSON.parse(String(init?.body));return Response.json({id:"candidate",inviteStatus:"cancelled",inviteVersion:2});}
    throw new Error("Unexpected database path");
  };
  try {
    const {POST}=await import("../src/app/api/v1/interviews/[id]/candidates/[candidateId]/invitation/route");
    const params={params:Promise.resolve({id:"template",candidateId:"candidate"})};
    const request=(body:unknown,key="retry-key-123")=>new Request("https://test.example",{method:"POST",headers:{authorization:"Bearer dlv_test","Idempotency-Key":key},body:JSON.stringify(body)});
    assert.equal((await POST(request({action:"cancel",version:1}),params)).status,404);
    process.env.AURAL_INVITE_LIFECYCLE_ENABLED="true";
    assert.equal((await POST(request({action:"cancel",version:1}),params)).status,200);
    assert.equal(last.p_key,"retry-key-123");assert.equal(last.p_candidate,"candidate");
    assert.equal((await POST(request({action:"reissue",version:1}),params)).status,400);
    role="VIEWER";assert.equal((await POST(request({action:"cancel",version:1}),params)).status,403);
    role="OWNER";outside=true;assert.equal((await POST(request({action:"cancel",version:1}),params)).status,403);
    assert.equal(rpcCalls,1);
  } finally {globalThis.fetch=original;delete process.env.AURAL_INVITE_LIFECYCLE_ENABLED;}
});
