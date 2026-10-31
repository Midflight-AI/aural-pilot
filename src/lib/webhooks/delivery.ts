import { createHmac } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export type Destination = { id: string; projectId: string; url: string; keyId: string; secret: string; expiresAt: string };
export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function destinationUrl(value: string, allowed: string[]) {
  const url = new URL(value);
  if (!allowed.includes(url.href) || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || isIP(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname) || !/^\/api\/integrations\/aural\/webhooks\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname)) throw new Error('DESTINATION_REJECTED');
  return url;
}
export function deliveryHeaders(body: string, eventId: string, destination: Destination, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  return { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'Aural-Event-Id': eventId, 'Aural-Timestamp': timestamp, 'Aural-Key-Id': destination.keyId, 'Aural-Signature': createHmac('sha256',destination.secret).update(timestamp+'.'+body).digest('hex') };
}
export function deliveryOutcome(status: number | null, attempt: number, retryAfter?: string, now = Date.now(), jitter = Math.random()) {
  if (status !== null && status >= 200 && status < 300) return { state:'delivered', code:null, delay:1 };
  const retryable = status === null || status === 408 || status === 429 || status >= 500;
  if (!retryable || attempt >= 8) return { state:'dead', code:retryable ? 'RETRIES_EXHAUSTED' : 'DESTINATION_REJECTED', delay:86400 };
  const schedule = [60,300,900,3600,21600,86400,86400];
  const hinted = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter)-now)/1000) : 0;
  const delay = Math.min(86400, Math.max(schedule[Math.min(attempt-1,6)]*(1+Math.max(0,Math.min(jitter,1))*.1),Number.isFinite(hinted) ? hinted : 0));
  return {state:'pending',code:status === null ? 'NETWORK_ERROR' : 'HTTP_RETRY',delay:Math.ceil(delay)};
}
/** Resolve once, reject nonpublic addresses, and pin the checked IP at connect.
 * TLS still verifies the configured hostname. Native HTTPS never follows redirects.
 */
export async function sendDelivery(url: URL, body: string, headers: Record<string,string>) {
  const addresses = await resolve4(url.hostname);
  if (!addresses.length || addresses.some((ip) => !publicIPv4(ip))) throw new Error('DESTINATION_REJECTED');
  return new Promise<{status:number;retryAfter?:string}>((resolve,reject) => {
    const req = request(url, {method:'POST',headers,lookup:(_host,_options,callback) => callback(null,addresses[0],4)}, (res) => {
      res.resume();
      resolve({status:res.statusCode ?? 500,retryAfter:typeof res.headers['retry-after']==='string' ? res.headers['retry-after'] : undefined});
    });
    const timer = setTimeout(() => req.destroy(new Error('DELIVERY_TIMEOUT')),10_000);
    req.on('error',reject); req.on('close',()=>clearTimeout(timer)); req.end(body);
  });
}
