// Unified co-stream chat (FR-3.3): one room per session (chat-{session_id}) with server-assigned,
// monotonically increasing sequence numbers. Reads GET /api/v1/chat?room=..., posts
// POST /api/v1/chat {room, text} with the member token. Messages are shown in sequence order.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { errorText } from '../api/errors';

export type ChatMessage = { key: string; seq: number; sender: string; text: string; at: string | null };

const POLL_MS = 1000;

function pick<T>(...vals: T[]): T | undefined {
  return vals.find((v) => v !== undefined && v !== null && (v as any) !== '');
}

export function toChatMessage(m: any, fallbackSeq: number): ChatMessage | null {
  if (!m || typeof m !== 'object') return null;
  const body = pick<string>(m.masked_text, m.display_text, m.text, m.message, m.body);
  if (typeof body !== 'string') return null;
  const seqRaw = pick<any>(m.seq, m.sequence, m.sequence_number, m.seq_no);
  const seq = typeof seqRaw === 'number' ? seqRaw : Number(seqRaw ?? fallbackSeq);
  const sender = pick<string>(m.display_name, m.sender_name, m.sender, m.user_id, m.sender_id, m.author) ?? 'Someone';
  return {
    // Sequence numbers are unique per room, so they also de-duplicate pushed and polled copies.
    key: seqRaw !== undefined && Number.isFinite(seq) ? `s${seq}` : String(pick(m.message_id, m.id, `f${fallbackSeq}`)),
    seq: Number.isFinite(seq) ? seq : fallbackSeq,
    sender: String(sender),
    text: body,
    at: pick<string>(m.created_at, m.timestamp, m.at) ?? null,
  };
}

function listOf(r: any): any[] {
  if (Array.isArray(r)) return r;
  return r?.messages ?? r?.items ?? r?.data ?? [];
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of prev) map.set(m.key, m);
  for (const m of incoming) map.set(m.key, m);
  return [...map.values()].sort((a, b) => a.seq - b.seq).slice(-200);
}

/**
 * Chat for one room. Messages pushed over a WebSocket go in through `push`; a 1 s poll of
 * GET /api/v1/chat?room=&after=<last seq> fills any gap, so delivery never depends on one channel.
 */
export function useChatRoom(room: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const roomRef = useRef(room);
  roomRef.current = room;
  const lastSeq = useRef(0);

  const add = useCallback((list: ChatMessage[]) => {
    if (!list.length) return;
    for (const m of list) if (m.seq > lastSeq.current && m.seq < Number.MAX_SAFE_INTEGER) lastSeq.current = m.seq;
    setMessages((prev) => mergeMessages(prev, list));
  }, []);

  const fetchOnce = useCallback(async () => {
    if (!room) return;
    try {
      const r = await api<any>(`/api/v1/chat?room=${encodeURIComponent(room)}&after=${lastSeq.current}&limit=200`, { timeoutMs: 5000 });
      if (roomRef.current !== room) return;
      add(
        listOf(r)
          .map((m, i) => toChatMessage(m, lastSeq.current + i + 1))
          .filter((m): m is ChatMessage => !!m),
      );
      setError(null);
    } catch (e: any) {
      setError(errorText(e));
    }
  }, [room, add]);

  useEffect(() => {
    setMessages([]);
    lastSeq.current = 0;
    if (!room) return;
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(t);
  }, [room, fetchOnce]);

  /** A message object pushed by the server (WebSocket 'chat' frame). */
  const push = useCallback(
    (raw: any) => {
      const m = toChatMessage(raw, lastSeq.current + 1);
      if (m) add([m]);
    },
    [add],
  );

  const send = useCallback(
    async (text: string) => {
      if (!room || !text.trim()) return;
      setSending(true);
      try {
        const r = await api<any>('/api/v1/chat', { method: 'POST', body: { room, text: text.trim() } });
        const m = toChatMessage(r?.message ?? r, Number.MAX_SAFE_INTEGER);
        if (m && m.seq !== Number.MAX_SAFE_INTEGER) add([m]);
      } finally {
        setSending(false);
      }
    },
    [room, add],
  );

  return { messages, error, sending, send, push, refresh: fetchOnce };
}
