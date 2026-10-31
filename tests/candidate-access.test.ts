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
