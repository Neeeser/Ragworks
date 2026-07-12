"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import {
  listAuthSessions,
  revokeAllAuthSessions,
  revokeAuthSession,
  updateUserSettings,
} from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

import type { AuthSession } from "@/lib/types";

const labelClass = "font-mono text-[11px] uppercase tracking-[0.28em] text-muted";

export function LoginSessionsPanel() {
  const { user, token, signOut, refreshProfile } = useAuth();
  const [days, setDays] = useState<30 | 90 | 180>(user?.remember_session_days ?? 30);
  const [sessions, setSessions] = useState<AuthSession[]>([]);

  useEffect(() => {
    if (token)
      void listAuthSessions(token)
        .then(setSessions)
        .catch(() => setSessions([]));
  }, [token]);

  if (!token) return null;

  const saveDuration = async () => {
    await updateUserSettings(token, { remember_session_days: days });
    await refreshProfile();
  };

  const revoke = async (item: AuthSession) => {
    await revokeAuthSession(token, item.id);
    setSessions((current) => current.filter((session) => session.id !== item.id));
    if (item.current) await signOut();
  };

  const revokeAll = async () => {
    await revokeAllAuthSessions(token);
    await signOut();
  };

  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6">
      <h2 className="text-xl font-semibold text-primary">Login sessions</h2>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Remembered login duration" labelClassName={labelClass} className="flex-1">
          <Select
            value={days}
            onChange={(event) => setDays(Number(event.target.value) as 30 | 90 | 180)}
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </Select>
        </Field>
        <Button type="button" onClick={() => void saveDuration()}>
          Save login duration
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {sessions.map((item) => {
          const name = item.user_agent || "Unknown browser";
          return (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-strong p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm text-primary">
                  {name}
                  {item.current ? " · Current" : ""}
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
                  {item.ip_address || "Unknown IP"}
                </p>
              </div>
              <Button
                variant="secondary"
                type="button"
                aria-label={`Revoke ${name}`}
                onClick={() => void revoke(item)}
              >
                Revoke
              </Button>
            </div>
          );
        })}
      </div>

      <Button className="mt-6" variant="secondary" type="button" onClick={() => void revokeAll()}>
        Sign out everywhere
      </Button>
    </section>
  );
}
