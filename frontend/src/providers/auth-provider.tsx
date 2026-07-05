"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getProfile, loginRequest } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { User } from "@/lib/types";

const STORAGE_KEY = "transparentrag.jwt";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(
    async (authToken?: string) => {
      const resolvedToken = authToken || token;
      if (!resolvedToken) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const profile = await getProfile(resolvedToken);
        setUser(profile);
        setError(null);
      } catch (err) {
        setUser(null);
        setToken(null);
        window.localStorage.removeItem(STORAGE_KEY);
        setError(getErrorMessage(err, "Unable to load profile."));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    /* c8 ignore next -- window is always defined in jsdom tests */
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) {
      setToken(stored);
      fetchProfile(stored);
    } else {
      setLoading(false);
    }
  }, [fetchProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const result = await loginRequest(email, password);
      window.localStorage.setItem(STORAGE_KEY, result.access_token);
      setToken(result.access_token);
      await fetchProfile(result.access_token);
    },
    [fetchProfile],
  );

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      error,
      signIn,
      signOut,
      refreshProfile: () => fetchProfile(),
    }),
    [user, token, loading, error, signIn, signOut, fetchProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
