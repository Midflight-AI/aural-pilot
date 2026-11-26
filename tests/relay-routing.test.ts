import assert from "node:assert/strict";
import test from "node:test";

import {
  RelayConnector,
  type RelaySocketLike,
  resolveRelayUrl,
} from "../src/lib/voice/relay-routing";

class FakeSocket implements RelaySocketLike {
  readyState = 0;
  binaryType?: string;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  emitOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emitJson(data: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  emitError(): void {
    this.onerror?.();
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await flush();
  }
}

test("the configured relay URL wins", () => {
  assert.equal(
    resolveRelayUrl({
      relayUrl: "wss://relay.example.com",
      browserProtocol: "https:",
      browserHost: "aural-ai.com",
    }),
    "wss://relay.example.com",
  );
});

test("production browsers default to the same-origin relay path", () => {
  assert.equal(
    resolveRelayUrl({ browserProtocol: "https:", browserHost: "aural-ai.com" }),
    "wss://aural-ai.com/ws/openai-voice",
  );
});

test("local browsers default to the local relay port", () => {
  assert.equal(
    resolveRelayUrl({ browserProtocol: "http:", browserHost: "localhost:3000" }),
    "ws://localhost:8767/ws/openai-voice",
  );
  assert.equal(resolveRelayUrl({}), "ws://localhost:8767");
});

function connectorFor(sockets: FakeSocket[], options: Partial<ConstructorParameters<typeof RelayConnector<Record<string, unknown>>>[0]> = {}) {
  return new RelayConnector<Record<string, unknown>>({
    url: "ws://relay:8767",
    buildInitMessage: () => ({ type: "init" }),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    onJsonMessage: () => {},
    ...options,
  });
}

test("RelayConnector sends the init message and resolves once the relay is ready", async () => {
  const sockets: FakeSocket[] = [];
  const connector = connectorFor(sockets, {
    buildInitMessage: () => ({ type: "init", context: { startQuestionIndex: 0 } }),
  });

  const connectPromise = connector.connect();
  assert.equal(sockets.length, 1);
  sockets[0].emitOpen();
  await flush();
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), {
    type: "init",
    context: { startQuestionIndex: 0 },
  });
  sockets[0].emitJson({ type: "ready" });
  await connectPromise;
  assert.equal(connector.isReady, true);
});

test("RelayConnector reconnects to the relay after a mid-session disconnect and resumes", async () => {
  const sockets: FakeSocket[] = [];
  const connected: boolean[] = [];
  let currentQuestionIndex = 0;
  const connector = connectorFor(sockets, {
    reconnectDelayMs: 1,
    buildInitMessage: () => ({ type: "init", context: { startQuestionIndex: currentQuestionIndex } }),
    onConnected: ({ isReconnect }) => connected.push(isReconnect),
  });

  const connectPromise = connector.connect();
  sockets[0].emitOpen();
  await flush();
  sockets[0].emitJson({ type: "ready" });
  await connectPromise;

  currentQuestionIndex = 2;
  sockets[0].emitClose();

  await waitFor(() => sockets.length === 2, 2_000);
  assert.equal(sockets[1].url, "ws://relay:8767");
  sockets[1].emitOpen();
  await flush();
  assert.deepEqual(JSON.parse(sockets[1].sent[0]), {
    type: "init",
    context: { startQuestionIndex: 2 },
  });
  sockets[1].emitJson({ type: "ready" });
  await flush();

  assert.deepEqual(connected, [false, true]);
  assert.equal(connector.isReady, true);
  assert.equal(connector.sendJson({ type: "ping" }), true);
  assert.deepEqual(JSON.parse(sockets[1].sent[1]), { type: "ping" });
});

test("RelayConnector reports permanent failure once reconnect attempts are spent", async () => {
  const sockets: FakeSocket[] = [];
  const reconnects: number[] = [];
  let permanentFailure: Error | null = null;
  const connector = connectorFor(sockets, {
    reconnectAttempts: 2,
    reconnectDelayMs: 1,
    readyTimeoutMs: 50,
    onReconnecting: (attempt) => reconnects.push(attempt),
    onPermanentFailure: (error) => {
      permanentFailure = error;
    },
  });

  const connectPromise = connector.connect();
  sockets[0].emitOpen();
  await flush();
  sockets[0].emitJson({ type: "ready" });
  await connectPromise;

  sockets[0].emitClose();
  await waitFor(() => sockets.length >= 2, 2_000);
  sockets[1].emitClose();
  await waitFor(() => sockets.length >= 3, 2_000);
  sockets[2].emitClose();

  await waitFor(() => permanentFailure !== null, 2_000);
  assert.deepEqual(reconnects, [1, 2]);
  assert.equal(sockets.length, 3);
});

test("RelayConnector reports permanent failure when the first connection fails", async () => {
  const sockets: FakeSocket[] = [];
  let permanentFailure: Error | null = null;
  const connector = connectorFor(sockets, {
    onPermanentFailure: (error) => {
      permanentFailure = error;
    },
  });

  const connectPromise = connector.connect();
  sockets[0].emitError();
  await assert.rejects(connectPromise);
  assert.ok(permanentFailure);
  assert.equal(connector.reconnect(), null);
});
