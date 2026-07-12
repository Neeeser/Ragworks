"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getProfile, loginRequest, logoutRequest, refreshSession } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";

import type { User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (authToken?: string | null) => {
    const resolvedToken = authToken ?? tokenRef.current;
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
      setError(getErrorMessage(err, "Unable to load profile."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    refreshSession()
      .then((result) => {
        setToken(result.access_token);
        return fetchProfile(result.access_token);
      })
      .catch(() => setLoading(false));
  }, [fetchProfile]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(
      () => {
        refreshSession()
          .then((result) => setToken(result.access_token))
          .catch(() => {
            setToken(null);
            setUser(null);
          });
      },
      12 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [token]);

  const signIn = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      setError(null);
      const result = await loginRequest(email, password, rememberMe);
      setToken(result.access_token);
      await fetchProfile(result.access_token);
    },
    [fetchProfile],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    void logoutRequest();
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      error,
      signIn,
      signOut,
      refreshProfile: () => fetchProfile(token),
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
