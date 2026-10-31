import {test} from "node:test";
import assert from "node:assert/strict";
import {isolatedVideoDatabase} from "../src/lib/video/isolation";
test("video cannot inherit Aural baseline or Ramp production databases",()=>{
 for(const ref of ["knbbkrfatygusjqjcjcy","eaamqnakereqidmaxwvp"]) assert.equal(isolatedVideoDatabase(`https://${ref}.supabase.co`,ref),false);
 assert.equal(isolatedVideoDatabase("https://abcdefghijklmnopqrst.supabase.co","abcdefghijklmnopqrst"),true);
 assert.equal(isolatedVideoDatabase("https://other.supabase.co","abcdefghijklmnopqrst"),false);
 assert.equal(isolatedVideoDatabase("https://abcdefghijklmnopqrst.supabase.co",undefined),false);
});
