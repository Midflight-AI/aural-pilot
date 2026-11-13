import { z } from 'zod';
export const deliveryQuery = z.object({subscription_id:z.uuid(), limit:z.coerce.number().int().min(1).max(100).default(20), cursor:z.string().max(500).optional(), view:z.string().max(12000).optional()}).refine(v=>!(v.cursor && v.view));
export const retryRequest = z.object({subscription_id:z.uuid(), request_id:z.uuid()}).strict();
const cursorSchema = z.object({at:z.iso.datetime({offset:true}),id:z.uuid()}).strict();
export function decodeDeliveryCursor(value?:string) {
  if (!value) return null;
  return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8')));
}
export function encodeDeliveryCursor(row:{occurred_at:string;event_id:string}) {
  return Buffer.from(JSON.stringify({at:row.occurred_at,id:row.event_id})).toString('base64url');
}

const textColumns = ['event', 'lastResult', 'sessionId', 'eventId'] as const;
const numberColumns = ['revision', 'attempts', 'retryCount', 'httpStatus'] as const;
const dateColumns = ['occurredAt', 'deliveredAt', 'nextAttemptAt'] as const;
const columns = [...textColumns, 'status', ...numberColumns, ...dateColumns] as const;
const textFilter = z.object({col:z.enum(textColumns),kind:z.enum(['contains','doesNotContain','equals','notEquals']),q:z.string().max(200)}).strict();
const emptyFilter = z.object({col:z.enum(columns),kind:z.enum(['isEmpty','isNotEmpty'])}).strict();
const numberFilter = z.object({col:z.enum(numberColumns),kind:z.literal('range'),min:z.number().finite().optional(),max:z.number().finite().optional()}).strict();
const dateFilter = z.object({col:z.enum(dateColumns),kind:z.literal('dateRange'),from:z.iso.date().optional(),to:z.iso.date().optional()}).strict();
const selectFilter = z.object({col:z.literal('status'),kind:z.enum(['anyOf','noneOf']),values:z.array(z.enum(['Delivered','Queued','Failed'])).max(3)}).strict();
export const deliveryView = z.object({
 q:z.string().max(200).default(''),
 sort:z.object({col:z.enum(columns),dir:z.enum(['asc','desc'])}).strict().nullable().default(null),
 filters:z.array(z.union([textFilter,emptyFilter,numberFilter,dateFilter,selectFilter])).max(20).default([]),
 group:z.literal('status').nullable().default(null),
 page:z.number().int().min(1).max(1000000).default(1),
}).strict();
export function parseDeliveryView(value:string) { return deliveryView.parse(JSON.parse(value)); }
