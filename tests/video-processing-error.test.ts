import {test} from "node:test";
import assert from "node:assert/strict";
import {processingErrorCode} from "../src/lib/video/processing-error";

test("decoder rejection is terminal without leaking subprocess output",()=>{
 const error=Object.assign(new Error("Command failed: ffmpeg private-media-path raw stderr"),{code:1,killed:false,signal:null});
 assert.equal(processingErrorCode(error),"media_invalid");
 assert.equal(processingErrorCode(Object.assign(error,{code:69})),"media_invalid");
});
test("timeouts, cancellation, resource exhaustion and infrastructure failures remain retryable",()=>{
 assert.equal(processingErrorCode(Object.assign(new Error("Command failed"),{code:1,killed:true,signal:"SIGTERM"})),"processing_timeout");
 assert.equal(processingErrorCode(new DOMException("deadline expired","TimeoutError")),"processing_timeout");
 assert.equal(processingErrorCode(new DOMException("lease lost","AbortError")),"processing_timeout");
 assert.equal(processingErrorCode(Object.assign(new Error("disk full"),{code:"ENOSPC"})),"scratch_space_unavailable");
 assert.equal(processingErrorCode(new Error("network unavailable")),"processing_failed");
 assert.equal(processingErrorCode(new Error("chunk_corrupt")),"chunk_corrupt");
});
