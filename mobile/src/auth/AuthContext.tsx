// Authentication state. Token in expo-secure-store (Android Keystore); user and tenant
// in AsyncStorage so the app opens offline after a previous sign-in.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteToken as deleteStoredToken, getToken as getStoredToken, setToken as storeToken } from './tokenStore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, loadBaseUrl, setToken, setUnauthorizedHandler } from '../api/client';
import { AppError } from '../api/errors';
import { Role, Tenant, User } from '../api/types';
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, isValidHex, onColor, readableOnDark } from '../theme';

const TOKEN_KEY = 'nascon_token';
const PROFILE_KEY = 'nascon.profile';

type AuthState = {
  ready: boolean;
  user: User | null;
  tenant: Tenant | null;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const clear = useCallback(async () => {
    setToken(null);
    setUser(null);
    setTenant(null);
    try {
      await deleteStoredToken(TOKEN_KEY);
    } catch {
      // ignore
    }
    await AsyncStorage.removeItem(PROFILE_KEY);
  }, []);

  useEffect(() => {
    (async () => {
      await loadBaseUrl();
      try {
        const token = await getStoredToken(TOKEN_KEY);
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        if (token && raw) {
          const p = JSON.parse(raw) as { user: User; tenant: Tenant };
          setToken(token);
          setUser(p.user);
          setTenant(p.tenant);
        }
      } catch {
        // start signed out
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await api<{ token: string; user: User; tenant: Tenant }>('/api/v1/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
        auth: false,
      });
      await storeToken(TOKEN_KEY, res.token);
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ user: res.user, tenant: res.tenant }));
      setToken(res.token);
      setSessionExpired(false);
      setUser(res.user);
      setTenant(res.tenant);
    } catch (e) {
      if (e instanceof AppError && e.code === 'UNAUTHENTICATED') {
        throw new AppError('UNAUTHENTICATED', 401, null, 'That email or password is not correct.');
      }
      if (e instanceof AppError && e.isNetwork) {
        throw new AppError(
          'NETWORK',
          0,
          null,
          "We can't reach the server. Check your connection, or open Settings to change the server address.",
        );
      }
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    setSessionExpired(false);
    await clear();
  }, [clear]);

  const value = useMemo(
    () => ({ ready, user, tenant, sessionExpired, login, logout }),
    [ready, user, tenant, sessionExpired, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export type Brand = {
  primary: string;
  secondary: string;
  onPrimary: string;
  onSecondary: string;
  /** Brand colour darkened until it is readable as text on white. */
  primaryText: string;
  tenantName: string;
  logoUrl: string | null;
};

export function useBrand(): Brand {
  const { tenant } = useAuth();
  return useMemo(() => {
    const p = isValidHex(tenant?.primary_color) ? normalize(tenant!.primary_color!) : DEFAULT_PRIMARY;
    const s = isValidHex(tenant?.secondary_color) ? normalize(tenant!.secondary_color!) : DEFAULT_SECONDARY;
    return {
      primary: p,
      secondary: s,
      onPrimary: onColor(p),
      onSecondary: onColor(s),
      primaryText: readableOnDark(p),
      tenantName: tenant?.name ?? 'NaSCon League',
      logoUrl: tenant?.logo_url ?? null,
    };
  }, [tenant]);
}

function normalize(hex: string) {
  const h = hex.trim();
  return h.startsWith('#') ? h : '#' + h;
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Platform Super-Admin',
  league_organizer: 'League Organizer',
  club_manager: 'Club Manager',
  player: 'Player',
  viewer: 'Viewer',
};

export function canScore(role?: Role | null) {
  return role === 'league_organizer' || role === 'super_admin';
}
/**
 * League management (scoring, match status) is scoped to the organizer's own league (spec 5.13:
 * "the league organizer owns only league-alpha-1"); the super admin manages every league.
 */
export function managesLeague(user: { role: Role; league_id?: string | null } | null | undefined, leagueId?: string | null) {
  if (!user || !leagueId) return false;
  if (user.role === 'super_admin') return true;
  return user.role === 'league_organizer' && user.league_id === leagueId;
}
export function canManageRoster(role?: Role | null) {
  return role === 'club_manager' || role === 'super_admin';
}
export function canPin(role?: Role | null) {
  return role === 'league_organizer' || role === 'super_admin' || role === 'club_manager';
}
