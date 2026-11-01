// Prefetch a bounded window, but always consume in manifest order. Failed future
// downloads are handled immediately, and cancellation drains all outstanding work.
export async function* orderedPrefetch<T, R>(
 items: readonly T[], load: (item: T, signal: AbortSignal) => Promise<R>,
 signal: AbortSignal, concurrency = 4,
): AsyncGenerator<R> {
 if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("invalid_prefetch_limit");
 const controller = new AbortController();
 const combined = AbortSignal.any([signal, controller.signal]);
 type Result = { ok: true; value: R } | { ok: false; error: unknown };
 const pending = new Map<number, Promise<Result>>();
 let next = 0;
 const fill = () => {
  while (next < items.length && pending.size < concurrency && !combined.aborted) {
   const index = next++;
   pending.set(index, Promise.resolve().then(() => { combined.throwIfAborted(); return load(items[index], combined); })
    .then(value => ({ ok: true, value }) as Result, error => ({ ok: false, error }) as Result));
  }
 };
 try {
  fill();
  for (let index = 0; index < items.length; index++) {
   combined.throwIfAborted();
   const result = await pending.get(index)!;
   pending.delete(index);
   if (!result.ok) throw result.error;
   yield result.value;
   fill();
  }
 } finally {
  controller.abort();
  await Promise.all(pending.values());
 }
}

// Drain waiting work within this invocation's deadline. Concurrent finalizations
// can share a busy process; the durable queue must not wait for cron unnecessarily.
export async function* processingClaims<T>(
 claim: (requestedId?: string) => Promise<T | null>, deadline: number,
 requestedId?: string, now: () => number = Date.now,
): AsyncGenerator<T> {
 while (deadline - now() > 30_000) {
  const preferred = requestedId;
  requestedId = undefined;
  const job = await claim(preferred);
  if (job === null) { if (preferred) continue; return; }
  yield job;
 }
}
