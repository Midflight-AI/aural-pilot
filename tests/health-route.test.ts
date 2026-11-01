import assert from "node:assert/strict";
import test, { mock } from "node:test";

test("health probe uses a separate read credential and reports failure and recovery", async () => {
 const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "AURAL_HEALTH_PROBE_SECRET"] as const;
 const prior = keys.map(key => process.env[key]);
 process.env.SUPABASE_URL ||= "https://test.supabase.co";
 process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
 process.env.CRON_SECRET = "test-cron";
 process.env.AURAL_HEALTH_PROBE_SECRET = "test-probe";
 const { supabaseAdmin: db } = await import("../src/lib/supabase/admin");
 const { GET } = await import("../src/app/api/internal/health/route");

 let failed = true, unavailable = false, calls = 0;
 const rpc = mock.method(db, "rpc", () => { calls++; return Promise.resolve(unavailable ? {data:null,error:{message:"unavailable"}} : {data:{windowMinutes:15,metrics:[],stuckRecordings:failed?1:0,unrecoveredUploads:0,failedRecordings:0},error:null}); }) as typeof db.rpc;
 try {
  assert.equal((await GET(new Request("https://example.test/api/internal/health"))).status,401);
  assert.equal(calls,0);
  const request = (token:string) => new Request("https://example.test/api/internal/health",{headers:{Authorization:`Bearer ${token}`}});
  const failure = await GET(request("test-probe"));
  assert.equal(failure.status,503);
  assert.deepEqual((await failure.json()).findings,["recording_completion_delayed"]);
  failed=false;
  assert.equal((await GET(request("test-probe"))).status,200);
  assert.equal((await GET(request("test-cron"))).status,200);
  unavailable=true;
  assert.equal((await GET(request("test-probe"))).status,503);
  assert.equal((await GET(request("wrong"))).status,401);
 } finally {
  rpc.mock.restore();
  keys.forEach((key,index)=>{if(prior[index]===undefined)delete process.env[key];else process.env[key]=prior[index];});
 }
});
