import {test} from "node:test";
import assert from "node:assert/strict";
import {isolatedVideoDatabase,videoDatabaseAllowed} from "../src/lib/video/isolation";
test("video cannot inherit Aural baseline or Ramp production databases",()=>{
 for(const ref of ["knbbkrfatygusjqjcjcy","eaamqnakereqidmaxwvp"]) assert.equal(isolatedVideoDatabase(`https://${ref}.supabase.co`,ref),false);
 assert.equal(isolatedVideoDatabase("https://abcdefghijklmnopqrst.supabase.co","abcdefghijklmnopqrst"),true);
 assert.equal(isolatedVideoDatabase("https://other.supabase.co","abcdefghijklmnopqrst"),false);
 assert.equal(isolatedVideoDatabase("https://abcdefghijklmnopqrst.supabase.co",undefined),false);
});

test("production video requires an explicit matching Aural configuration",()=>{
 assert.equal(videoDatabaseAllowed("https://knbbkrfatygusjqjcjcy.supabase.co","knbbkrfatygusjqjcjcy","production"),true);
 for(const env of [undefined,"development","preview"]) assert.equal(videoDatabaseAllowed("https://knbbkrfatygusjqjcjcy.supabase.co","knbbkrfatygusjqjcjcy",env),false);
 assert.equal(videoDatabaseAllowed("https://eaamqnakereqidmaxwvp.supabase.co","eaamqnakereqidmaxwvp","production"),false);
 assert.equal(videoDatabaseAllowed("https://abcdefghijklmnopqrst.supabase.co","abcdefghijklmnopqrst","production"),false);
});
