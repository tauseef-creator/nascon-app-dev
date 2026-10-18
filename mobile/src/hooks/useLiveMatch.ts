// Live score, pinned product and match status via Server-Sent Events (XMLHttpRequest streaming). Falls back to polling
// every 5 s if the stream fails or delivers nothing.
import { useEffect, useRef, useState } from 'react';
import { getBaseUrl } from '../api/client';

export type LiveMode = 'connecting' | 'live' | 'polling' | 'offline';

type Handlers = {
  onScore: (projection: any) => void;
  onPinned: () => void;
  /** FR-1.3 status object pushed when an organizer postpones, reschedules, abandons or cancels. */
  onStatus?: (status: any) => void;
  poll: () => void;
};

export function useLiveMatch(matchId: string | undefined, online: boolean, handlers: Handlers): LiveMode {
  const [mode, setMode] = useState<LiveMode>('connecting');
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!matchId) return;
    if (!online) {
      setMode('offline');
      return;
    }
    let closed = false;
    let xhr: XMLHttpRequest | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const startPolling = () => {
      if (closed || pollTimer) return;
      setMode('polling');
      pollTimer = setInterval(() => h.current.poll(), 5000);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const connect = () => {
      if (closed) return;
      attempts++;
      let seen = 0;
      let buffer = '';
      let gotEvent = false;
      xhr = new XMLHttpRequest();
      xhr.open('GET', `${getBaseUrl()}/realtime/matches/${encodeURIComponent(matchId)}`);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      const consume = () => {
        if (!xhr) return;
        const textAll = xhr.responseText || '';
        if (textAll.length <= seen) return;
        buffer += textAll.slice(seen);
        seen = textAll.length;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let ev = 'message';
          const dataLines: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          gotEvent = true;
          if (watchdog) clearTimeout(watchdog);
          stopPolling();
          setMode('live');
          attempts = 0;
          try {
            const data = JSON.parse(dataLines.join('\n'));
            if (ev === 'score' && data && data.match_id) h.current.onScore(data);
            else if (ev === 'pinned_product') h.current.onPinned();
            else if (ev === 'status' && data && data.match_id) h.current.onStatus?.(data);
          } catch {
            // ignore malformed chunk
          }
        }
      };
      xhr.onprogress = consume;
      xhr.onreadystatechange = () => {
        if (!xhr) return;
        if (xhr.readyState === 3) consume();
        if (xhr.readyState === 4) {
          consume();
          if (closed) return;
          // Stream ended or failed: poll meanwhile and reconnect with back-off.
          startPolling();
          retryTimer = setTimeout(connect, Math.min(30000, 2000 * attempts));
        }
      };
      xhr.onerror = () => {
        // readyState 4 handler takes care of retry
      };
      xhr.send();
      // If nothing arrives quickly, keep the score fresh by polling.
      watchdog = setTimeout(() => {
        if (!gotEvent) startPolling();
      }, 6000);
    };

    setMode('connecting');
    connect();
    return () => {
      closed = true;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      if (watchdog) clearTimeout(watchdog);
      if (xhr) {
        xhr.onreadystatechange = null;
        xhr.onprogress = null;
        xhr.abort();
      }
    };
  }, [matchId, online]);

  return mode;
}
