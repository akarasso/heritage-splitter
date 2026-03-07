import { createSignal, onCleanup } from "solid-js";
import { api } from "~/lib/api-client";

export interface WsMessage {
  kind: string;
  payload: Record<string, unknown>;
}

let ws: WebSocket | null = null;
let listeners: Set<(msg: WsMessage) => void> = new Set();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastToken: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000; // 1 second

function connect() {
  const token = api.getToken();
  if (!token) return;
  lastToken = token;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/ws`;

  try {
    ws = new WebSocket(url, ["bearer", token]);

    ws.onopen = () => {
      // Reset attempts on successful connection
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        const handlers = Array.from(listeners);
        handlers.forEach((fn) => fn(msg));
      } catch (e) {
        console.warn("[WS] Failed to parse message:", e instanceof Error ? e.message : "parse error");
      }
    };

    ws.onclose = () => {
      ws = null;
      // Auto-reconnect with exponential backoff, only if there are active listeners
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (listeners.size > 0 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(() => {
          if (api.getToken() && listeners.size > 0) connect();
        }, delay);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  } catch {
    // connection failed, will retry
  }
}

function ensureConnected() {
  const currentToken = api.getToken();
  // Reconnect if token has changed (e.g. re-auth)
  if (currentToken && lastToken && currentToken !== lastToken && ws) {
    ws.close();
    ws = null;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connect();
  }
}

export function useWebSocket(onEvent?: (msg: WsMessage) => void) {
  const [lastEvent, setLastEvent] = createSignal<WsMessage | null>(null);

  const handler = (msg: WsMessage) => {
    setLastEvent(msg);
    onEvent?.(msg);
  };

  listeners.add(handler);
  ensureConnected();

  const cleanup = () => {
    // Remove this component's handler from the shared listener set.
    // This ensures that on component unmount (or HMR remount), the old
    // handler is properly cleaned up. When the component remounts, it
    // re-registers a new handler — the old one is already deleted here.
    listeners.delete(handler);
    // Don't close the WS, it's shared across components
  };

  onCleanup(cleanup);

  return { lastEvent, cleanup };
}

export function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  listeners.clear();
}
