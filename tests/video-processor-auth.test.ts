import {test} from "node:test";
import assert from "node:assert/strict";
import {GET} from "../src/app/api/internal/video/process/route";
test("processor refuses absent, wrong and unconfigured scheduler credentials", async()=>{
 const prior=process.env.CRON_SECRET;
 try {
  process.env.CRON_SECRET="test-only-processor-secret";
  for(const authorization of [undefined,"Bearer wrong","Bearer "]) {
   const response=await GET(new Request("http://localhost/api/internal/video/process",{headers:authorization?{authorization}:{}}));
   assert.equal(response.status,401);
  }
  delete process.env.CRON_SECRET;
  assert.equal((await GET(new Request("http://localhost/api/internal/video/process",{headers:{authorization:"Bearer undefined"}}))).status,401);
 } finally {if(prior===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=prior;}
});
