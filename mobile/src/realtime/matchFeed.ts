// Real-time match feed (FR-3.2 overlays, FR-5.2 notifications, NFR-1).
// 1. WebSocket ws://<server>/ws/matches/{id}, messages {type, data}.
// 2. If the socket fails, Server-Sent Events from GET /api/v1/matches/{id}/stream.
// 3. If both fail, poll GET /audit/v1/score/{id} (public, no sign-in) every 3 s.
// Reconnects with back-off. No auth needed, so guests opened by a deep link get live scores too.
import { useEffect, useRef, useState } from 'react';
import { api, getBaseUrl } from '../api/client';
import { wsUrl } from './urls';

export type FeedMode = 'connecting' | 'websocket' | 'sse' | 'polling' | 'closed';
export type FeedEvent = { type: string; data: any; raw?: any };

const POLL_MS = 3000;

export function subscribeMatch(matchId: string, onEvent: (e: FeedEvent) => void, onMode?: (m: FeedMode) => void): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let xhr: XMLHttpRequest | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let lastPolled = '';
  const enc = encodeURIComponent(matchId);
  const setMode = (m: FeedMode) => !closed && onMode?.(m);

  const emit = (type: string, data: any, raw?: any) => {
    if (!closed) onEvent({ type, data, raw });
  };
  const handleRaw = (raw: string, fallbackType = 'message') => {
    try {
      const msg = JSON.parse(raw);
      if (msg && typeof msg === 'object' && typeof msg.type === 'string') emit(msg.type, msg.data ?? msg.payload ?? msg, msg);
      else emit(fallbackType, msg);
    } catch {
      // ignore malformed frames
    }
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
  const startPolling = () => {
    if (closed || pollTimer) return;
    setMode('polling');
    const tick = async () => {
      try {
        const p = await api<any>(`/audit/v1/score/${enc}`, { auth: false, timeoutMs: 5000 });
        const sig = JSON.stringify([p?.home?.score, p?.away?.score, p?.status, p?.version]);
        if (sig !== lastPolled) {
          const first = lastPolled === '';
          lastPolled = sig;
          if (!first) emit('score', p);
          else emit('snapshot', p);
        }
      } catch {
        // keep polling
      }
    };
    tick();
    pollTimer = setInterval(tick, POLL_MS);
  };
  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    attempts++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connectWs();
    }, Math.min(30000, 2000 * attempts));
  };

  const connectSse = () => {
    if (closed) return;
    let seen = 0;
    let buffer = '';
    let opened = false;
    xhr = new XMLHttpRequest();
    xhr.open('GET', `${getBaseUrl()}/api/v1/matches/${enc}/stream`);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    const consume = () => {
      if (!xhr) return;
      const all = xhr.responseText || '';
      if (all.length <= seen) return;
      if (!opened && xhr.status >= 200 && xhr.status < 300) {
        opened = true;
        stopPolling();
        setMode('sse');
      }
      buffer += all.slice(seen);
      seen = all.length;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let ev = 'message';
        const lines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) lines.push(line.slice(5).trim());
        }
        if (lines.length) handleRaw(lines.join('\n'), ev);
      }
    };
    xhr.onprogress = consume;
    xhr.onreadystatechange = () => {
      if (!xhr) return;
      if (xhr.readyState === 3) consume();
      if (xhr.readyState === 4) {
        consume();
        xhr = null;
        if (closed) return;
        startPolling();
        scheduleRetry();
      }
    };
    xhr.send();
  };

  const connectWs = () => {
    if (closed) return;
    setMode('connecting');
    let opened = false;
    try {
      ws = new WebSocket(wsUrl(`/ws/matches/${enc}`));
    } catch {
      ws = null;
      connectSse();
      return;
    }
    const openTimer = setTimeout(() => {
      if (!opened && ws) ws.close();
    }, 4000);
    ws.onopen = () => {
      opened = true;
      attempts = 0;
      clearTimeout(openTimer);
      stopPolling();
      setMode('websocket');
    };
    ws.onmessage = (m) => handleRaw(typeof m.data === 'string' ? m.data : '');
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(openTimer);
      ws = null;
      if (closed) return;
      // Socket refused: fall back to SSE now; socket dropped after working: reconnect.
      if (!opened) connectSse();
      else {
        startPolling();
        scheduleRetry();
      }
    };
  };

  connectWs();
  return () => {
    closed = true;
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    if (xhr) {
      xhr.onreadystatechange = null;
      xhr.onprogress = null;
      xhr.abort();
    }
    onMode?.('closed');
  };
}

/** React hook around subscribeMatch; handlers may change between renders. */
export function useMatchFeed(matchId: string | null | undefined, onEvent: (e: FeedEvent) => void): FeedMode {
  const [mode, setMode] = useState<FeedMode>('connecting');
  const h = useRef(onEvent);
  h.current = onEvent;
  useEffect(() => {
    if (!matchId) return;
    return subscribeMatch(matchId, (e) => h.current(e), setMode);
  }, [matchId]);
  return mode;
}

export function feedLabel(mode: FeedMode): string {
  return {
    connecting: 'Connecting to live updates…',
    websocket: 'Live updates on',
    sse: 'Live updates on',
    polling: 'Checking for updates every few seconds',
    closed: 'Live updates off',
  }[mode];
}
