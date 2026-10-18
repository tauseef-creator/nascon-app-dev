// URL helpers for Phase II media and real-time endpoints. The backend returns media URLs with
// host "localhost" (spec 5.4 / 5.5); on a phone that host is the phone itself, so we swap in the
// host of the server address configured in Settings, keeping the media port and path.
import { getBaseUrl } from '../api/client';

/** Hostname of the configured API server, e.g. "10.0.2.2" or "192.168.1.20". */
export function serverHost(): string {
  const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(getBaseUrl());
  return m ? m[1]! : 'localhost';
}

/** Replaces a localhost / 127.0.0.1 host in a media URL with the configured server host. */
export function forDevice(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = serverHost();
  return url.replace(/^([a-z]+:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `$1${host}`);
}

/** ws:// (or wss://) URL on the configured server for a path such as /ws/matches/match-m1. */
export function wsUrl(path: string): string {
  return getBaseUrl().replace(/^http/i, 'ws') + path;
}

/** RTMP URL split into the "Server" and "Stream key" fields that OBS asks for. */
export function splitRtmp(rtmp: string): { server: string; key: string } {
  const i = rtmp.lastIndexOf('/');
  return i > 0 ? { server: rtmp.slice(0, i), key: rtmp.slice(i + 1) } : { server: rtmp, key: '' };
}

export type InAppTarget = { pathname: string; label: string } | null;

/**
 * Maps a scanned or tapped link to an in-app route.
 *  nascon://entity/{id}, nascon://stream/{id}, and resolved Guest Web Player routes
 *  (/web/matches/{id}/..., /web/clubs/{id}, /web/players/{id}, /web/costream/{id}).
 */
export function routeForLink(raw: string): InAppTarget {
  const url = raw.trim();
  const custom = /^nascon:\/\/(entity|stream)\/([A-Za-z0-9._-]+)/i.exec(url);
  if (custom) {
    const id = custom[2]!;
    return custom[1]!.toLowerCase() === 'stream'
      ? { pathname: `/stream/${id}`, label: 'Co-stream' }
      : { pathname: `/entity/${id}`, label: labelFor(id) };
  }
  const web = /\/web\/(matches|clubs|players|costream)\/([A-Za-z0-9._-]+)/i.exec(url);
  if (web) {
    const id = web[2]!;
    if (web[1]!.toLowerCase() === 'costream') return { pathname: `/stream/${id}`, label: 'Co-stream' };
    return { pathname: `/entity/${id}`, label: labelFor(id) };
  }
  return null;
}

/** True for the backend's short QR links, http(s)://host:port/q/{code}. */
export function isShortLink(raw: string): boolean {
  return /^https?:\/\/[^/]+\/q\/[A-Za-z0-9._-]+/i.test(raw.trim());
}

export function entityKind(id: string): 'match' | 'club' | 'player' | 'costream' | 'unknown' {
  if (id.startsWith('match-')) return 'match';
  if (id.startsWith('club-')) return 'club';
  if (id.startsWith('player-')) return 'player';
  if (id.startsWith('cs-session-')) return 'costream';
  return 'unknown';
}

function labelFor(id: string): string {
  return { match: 'Match', club: 'Club', player: 'Athlete', costream: 'Co-stream', unknown: 'Link' }[entityKind(id)];
}
