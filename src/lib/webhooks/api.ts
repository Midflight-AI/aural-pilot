import { z } from 'zod';
export const deliveryQuery = z.object({subscription_id:z.uuid(), limit:z.coerce.number().int().min(1).max(100).default(20), cursor:z.string().max(500).optional()});
export const retryRequest = z.object({subscription_id:z.uuid(), request_id:z.uuid()}).strict();
const cursorSchema = z.object({at:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
export function decodeDeliveryCursor(value?:string) {
  if (!value) return null;
  return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));
}
export function encodeDeliveryCursor(row:{occurred_at:string;event_id:string}) {
  return Buffer.from(JSON.stringify({at:row.occurred_at,id:row.event_id})).toString('base64url');
}
