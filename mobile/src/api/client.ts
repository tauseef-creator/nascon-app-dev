// HTTP client: configurable base URL, 8 s timeout, Bearer token, error mapping.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppError } from './errors';

export const DEFAULT_BASE_URL = 'http://10.0.2.2:8080';
const BASE_URL_KEY = 'nascon.baseUrl';
const TIMEOUT_MS = 8000;

let baseUrl = DEFAULT_BASE_URL;
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onReachability: ((reachable: boolean) => void) | null = null;

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

export async function loadBaseUrl(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(BASE_URL_KEY);
    if (v) baseUrl = v;
  } catch {
    // keep default
  }
  return baseUrl;
}

export async function saveBaseUrl(url: string): Promise<string> {
  baseUrl = normalizeBaseUrl(url) || DEFAULT_BASE_URL;
  await AsyncStorage.setItem(BASE_URL_KEY, baseUrl);
  return baseUrl;
}

export const getBaseUrl = () => baseUrl;
/** Current member token (for WebSocket query strings, which cannot carry headers). */
export const getToken = () => token;
export const setToken = (t: string | null) => {
  token = t;
};
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};
export const setReachabilityHandler = (fn: ((reachable: boolean) => void) | null) => {
  onReachability = fn;
};

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  base?: string;
};

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = TIMEOUT_MS } = opts;
  const url = (opts.base ?? baseUrl) + path;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    onReachability?.(false);
    // A timeout and a dropped connection are both treated as "offline" so actions get queued.
    throw new AppError(timedOut ? 'NETWORK' : 'NETWORK', 0);
  }
  clearTimeout(timer);
  onReachability?.(true);

  const raw = await res.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const code: string = data?.error?.code ?? (res.status >= 500 ? 'SERVER' : 'UNKNOWN');
    if (code === 'UNAUTHENTICATED' && auth && token && path !== '/api/v1/auth/login') {
      onUnauthorized?.();
    }
    throw new AppError(code, res.status, data?.error?.details ?? null);
  }
  return data as T;
}

/** GET /health against an arbitrary base URL (Settings "Test connection"). */
export async function testConnection(url: string): Promise<boolean> {
  const data = await api<{ status?: string }>('/health', { auth: false, base: normalizeBaseUrl(url), timeoutMs: 5000 });
  return data?.status === 'ok' || data != null;
}
