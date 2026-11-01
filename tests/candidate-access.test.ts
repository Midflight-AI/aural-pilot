import test from "node:test";
import assert from "node:assert/strict";
import { candidateProcedureAllowed as allowed } from "../src/lib/candidate-access";
const scope = { inviteToken: "valid-invitation", sessionId: "own-session" };
test("candidate access requires an invitation and binds every session operation", () => {
 assert.equal(allowed("session.getById",{id:"own-session"},null),false);
 for(const path of ["session.getById","session.complete","session.sendMessage","session.saveRecording","session.saveWhiteboard","session.deleteCode"]){
  assert.equal(allowed(path,{sessionId:"other-session"},scope),false);
  assert.equal(allowed(path,{sessionId:"own-session",id:"own-session"},scope),true);
 }
 assert.equal(allowed("candidate.getByToken",{token:"another-invite"},scope),false);
 assert.equal(allowed("candidate.getByToken",{token:scope.inviteToken},scope),true);
 assert.equal(allowed("session.createFromInvite",{inviteToken:scope.inviteToken},scope),true);
 assert.equal(allowed("session.create",{interviewId:"anything"},scope),false);
 assert.equal(allowed("interview.getBySlug",{slug:"anything"},scope),false);
 assert.equal(allowed("session.complete",{id:"own-session"},{...scope,sessionId:null}),false);
});

test("unknown fields cannot override the procedure's actual session identifier", () => {
 assert.equal(allowed("session.getById",{id:"other-session",sessionId:"own-session"},scope),false);
 assert.equal(allowed("session.complete",{id:"other-session",sessionId:"own-session"},scope),false);
 assert.equal(allowed("session.saveRecording",{sessionId:"other-session",id:"own-session"},scope),false);
});

test("tRPC middleware enforces scope before invoking a procedure", async () => {
 const {router,publicProcedure}=await import("../src/server/trpc");
 const {z}=await import("zod");
 const app=router({session:router({getById:publicProcedure.input(z.object({id:z.string()})).query(({input})=>input.id)})});
 const previous=process.env.AURAL_EXTERNAL_CANDIDATES;
 process.env.AURAL_EXTERNAL_CANDIDATES="true";
 try {
  // The resolver uses no database; the fake context verifies the real middleware.
  const caller=app.createCaller({user:null,candidate:scope,supabase:null as never});
  assert.equal(await caller.session.getById({id:"own-session"}),"own-session");
  await assert.rejects(caller.session.getById({id:"other-session"}),/FORBIDDEN/);
 } finally {if(previous===undefined)delete process.env.AURAL_EXTERNAL_CANDIDATES;else process.env.AURAL_EXTERNAL_CANDIDATES=previous;}
});


test("monitoring reaches its own authentication without bypassing other API gates", async () => {
 const envKeys = ["AURAL_EXTERNAL_CANDIDATES", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
 const previous = envKeys.map(key => process.env[key]);
 process.env.AURAL_EXTERNAL_CANDIDATES = "true";
 process.env.SUPABASE_URL ||= "https://test.supabase.co";
 process.env.SUPABASE_ANON_KEY ||= "test-placeholder";
 process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-placeholder";
 try {
  const { proxy } = await import("../src/proxy");
  const { NextRequest } = await import("next/server");
  for (const path of ["/api/internal/health", "/api/internal/observations", "/api/session/observations"]) {
   const response = await proxy(new NextRequest("https://example.test" + path));
   assert.equal(response.headers.get("x-middleware-next"), "1");
  }
  for (const path of ["/api/internal/unknown", "/api/internal/health/unknown", "/api/session/observations/unknown"]) {
   const response = await proxy(new NextRequest("https://example.test" + path));
   assert.equal(response.status, 401);
   assert.equal((await response.json()).error, "sign_in_required");
  }
 } finally { envKeys.forEach((key, index) => { if(previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
});
