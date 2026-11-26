import { videoRequestHeaders } from "../video/client";

export interface RelayUrlOptions {
  relayUrl?: string;
  browserProtocol?: string;
  browserHost?: string;
}

export interface RelaySocketLike {
  readyState: number;
  binaryType?: string;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface RelayMessageContext<TJsonMessage extends Record<string, unknown>> {
  connector: RelayConnector<TJsonMessage>;
}

interface RelayConnectedContext {
  isReconnect: boolean;
  connector: RelayConnector<Record<string, unknown>>;
}

interface RelayConnectorOptions<TJsonMessage extends Record<string, unknown>> {
  url: string;
  buildInitMessage: () => unknown;
  createSocket?: (url: string) => RelaySocketLike;
  readyTimeoutMs?: number;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  binaryType?: string;
  onJsonMessage: (
    message: TJsonMessage,
    context: RelayMessageContext<TJsonMessage>
  ) => void;
  onBinaryMessage?: (
    data: ArrayBuffer,
    context: RelayMessageContext<TJsonMessage>
  ) => void;
  onConnected?: (context: RelayConnectedContext) => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onPermanentFailure?: (error: Error) => void;
}

const DEFAULT_RELAY_PORT = "8767";
const DEFAULT_RELAY_PATH = "/ws/openai-voice";
const READY_STATE_OPEN = 1;

function isLocalBrowserHost(browserHost: string): boolean {
  const normalized = browserHost.replace(/:\d+$/, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/** The configured relay URL, else the same-origin relay path (or the local relay port in dev). */
export function resolveRelayUrl(options: RelayUrlOptions): string {
  if (options.relayUrl) return options.relayUrl;
  const { browserProtocol, browserHost } = options;
  if (!browserProtocol || !browserHost) return `ws://localhost:${DEFAULT_RELAY_PORT}`;
  try {
    const url = new URL(`${browserProtocol === "https:" ? "wss:" : "ws:"}//${browserHost}${DEFAULT_RELAY_PATH}`);
    if (isLocalBrowserHost(browserHost)) url.port = DEFAULT_RELAY_PORT;
    return url.toString();
  } catch {
    return `ws://localhost:${DEFAULT_RELAY_PORT}`;
  }
}

export function isRecoverableRelayErrorMessage(message?: string): boolean {
  if (!message) return false;
  return /(connection failed|connect timeout|websocket error|disconnected|timeout|failed to connect|mic test failed)/i.test(
    message
  );
}

function normalizeBinaryData(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    ) as ArrayBuffer;
  }
  return null;
}

export class RelayConnector<TJsonMessage extends Record<string, unknown>> {
  private readonly url: string;
  private readonly buildInitMessage: () => unknown;
  private readonly createSocket: (url: string) => RelaySocketLike;
  private readonly readyTimeoutMs: number;
  private readonly reconnectAttempts: number;
  private readonly reconnectDelayMs: number;
  private readonly binaryType?: string;
  private readonly onJsonMessage: RelayConnectorOptions<TJsonMessage>["onJsonMessage"];
  private readonly onBinaryMessage: RelayConnectorOptions<TJsonMessage>["onBinaryMessage"];
  private readonly onConnected?: RelayConnectorOptions<TJsonMessage>["onConnected"];
  private readonly onReconnecting?: RelayConnectorOptions<TJsonMessage>["onReconnecting"];
  private readonly onPermanentFailure?: RelayConnectorOptions<TJsonMessage>["onPermanentFailure"];

  private socket: RelaySocketLike | null = null;
  private ready = false;
  private destroyed = false;
  private connectedOnce = false;
  private reconnectPromise: Promise<void> | null = null;
  private attemptSerial = 0;

  constructor(options: RelayConnectorOptions<TJsonMessage>) {
    this.url = options.url;
    this.buildInitMessage = options.buildInitMessage;
    this.createSocket =
      options.createSocket ||
      ((url: string) => new WebSocket(url) as unknown as RelaySocketLike);
    this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
    this.reconnectAttempts = options.reconnectAttempts ?? 2;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1500;
    this.binaryType = options.binaryType;
    this.onJsonMessage = options.onJsonMessage;
    this.onBinaryMessage = options.onBinaryMessage;
    this.onConnected = options.onConnected;
    this.onReconnecting = options.onReconnecting;
    this.onPermanentFailure = options.onPermanentFailure;
  }

  get isReady(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    this.destroyed = false;
    try {
      await this.open();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.onPermanentFailure?.(failure);
      throw failure;
    }
  }

  /** Drop the current socket and retry the relay, then report permanent failure. */
  reconnect(): Promise<void> | null {
    if (this.destroyed || !this.connectedOnce) return null;
    if (this.reconnectPromise) return this.reconnectPromise;

    this.ready = false;
    const activeSocket = this.socket;
    this.socket = null;
    if (activeSocket) {
      try {
        activeSocket.close();
      } catch {
        // noop
      }
    }

    this.reconnectPromise = this.retry().finally(() => {
      this.reconnectPromise = null;
    });
    return this.reconnectPromise;
  }

  private async retry(): Promise<void> {
    for (let attempt = 1; attempt <= this.reconnectAttempts; attempt++) {
      if (this.destroyed) break;
      this.onReconnecting?.(attempt, this.reconnectAttempts);
      await new Promise((r) => setTimeout(r, this.reconnectDelayMs * attempt));
      if (this.destroyed) break;
      try {
        await this.open();
        return;
      } catch {
        // retry
      }
    }
    if (this.destroyed) throw new Error("Connector destroyed during reconnect");
    const err = new Error("Voice relay reconnect failed");
    this.onPermanentFailure?.(err);
    throw err;
  }

  sendJson(payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== READY_STATE_OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  close(): void {
    this.destroyed = true;
    this.ready = false;
    const activeSocket = this.socket;
    this.socket = null;
    if (!activeSocket) return;
    try {
      activeSocket.close();
    } catch {
      // noop
    }
  }

  private open(): Promise<void> {
    const attemptId = ++this.attemptSerial;
    const isReconnect = this.connectedOnce;

    return new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(this.url);
      if (this.binaryType) {
        socket.binaryType = this.binaryType;
      }

      this.socket = socket;
      this.ready = false;

      let settled = false;
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // noop
        }
        if (!settled) {
          settled = true;
          reject(new Error("Voice relay timed out before ready"));
        }
      }, this.readyTimeoutMs);

      const clear = () => clearTimeout(timer);

      socket.onopen = async () => {
        if (this.destroyed || attemptId !== this.attemptSerial) return;
        try {
          const init = this.buildInitMessage();
          if (process.env.NEXT_PUBLIC_VOICE_RELAY_AUTH_ENABLED === "true") {
            const response = await fetch("/api/voice/ticket", { method: "POST", headers: { "Content-Type": "application/json", ...videoRequestHeaders() }, body: JSON.stringify(init), signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error("Voice access could not be verified");
            const { ticket } = await response.json();
            if (this.destroyed || attemptId !== this.attemptSerial) return;
            socket.send(JSON.stringify({ ...(init as object), ticket }));
          } else socket.send(JSON.stringify(init));
        } catch {
          clear();
          socket.close();
          if (!settled) { settled = true; reject(new Error("Voice access could not be verified")); }
        }
      };

      socket.onmessage = (event) => {
        if (this.destroyed) return;
        if (socket !== this.socket || attemptId !== this.attemptSerial) return;

        const binary = normalizeBinaryData(event.data);
        if (binary) {
          this.onBinaryMessage?.(binary, { connector: this });
          return;
        }

        if (typeof event.data !== "string") return;

        let message: TJsonMessage;
        try {
          message = JSON.parse(event.data) as TJsonMessage;
        } catch {
          return;
        }

        if (message.type === "ready" && !this.ready) {
          this.ready = true;
          this.connectedOnce = true;
          clear();
          if (!settled) {
            settled = true;
            this.onConnected?.({
              isReconnect,
              connector: this as unknown as RelayConnector<Record<string, unknown>>,
            });
            resolve();
          }
        }

        this.onJsonMessage(message, { connector: this });
      };

      socket.onerror = () => {
        if (settled || this.destroyed || this.ready) return;
        clear();
        settled = true;
        reject(new Error("Voice relay websocket error"));
      };

      socket.onclose = () => {
        clear();
        if (this.destroyed) return;

        if (!this.ready) {
          if (!settled) {
            settled = true;
            reject(new Error("Voice relay closed before ready"));
          }
          return;
        }

        if (socket !== this.socket) return;
        this.socket = null;
        this.ready = false;
        void this.reconnect()?.catch(() => {
          // onPermanentFailure already handles the user-facing surface
        });
      };
    });
  }
}
