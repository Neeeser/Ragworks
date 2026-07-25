"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { CustomSelect } from "@/components/ui/custom-select";
import { DataRow } from "@/components/ui/data-row";
import { Field } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import {
  listAuthSessions,
  revokeAllAuthSessions,
  revokeAuthSession,
  updateUserSettings,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { AuthSession } from "@/lib/types";

type RememberDays = 30 | 90 | 180;

const DURATIONS: RememberDays[] = [30, 90, 180];

/** Wide enough for an IPv6 literal before it truncates. */
const IP_COL = "w-44 text-right";
const CURRENT_COL = "w-20";

export function LoginSessionsPanel() {
  const { user, token, signOut, refreshProfile } = useAuth();
  const [days, setDays] = useState<RememberDays>(user?.remember_session_days ?? 30);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token)
      void listAuthSessions(token)
        .then(setSessions)
        .catch(() => setSessions([]));
  }, [token]);

  if (!token) return null;

  const saveDuration = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateUserSettings(token, { remember_session_days: days });
      await refreshProfile();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save the login duration."));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (item: AuthSession) => {
    setError(null);
    try {
      await revokeAuthSession(token, item.id);
      setSessions((current) => current.filter((session) => session.id !== item.id));
      if (item.current) await signOut();
    } catch (err) {
      setError(getErrorMessage(err, "Could not revoke the session."));
    }
  };

  const revokeAll = async () => {
    setError(null);
    try {
      await revokeAllAuthSessions(token);
      await signOut();
    } catch (err) {
      setError(getErrorMessage(err, "Could not sign out everywhere."));
    }
  };

  return (
    <section aria-labelledby="login-sessions-heading" className="card-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-3 py-2">
        <h2
          id="login-sessions-heading"
          className="text-head font-semibold tracking-[-0.01em] text-primary"
        >
          Login sessions
        </h2>
        <Button size="sm" variant="secondary" type="button" onClick={() => void revokeAll()}>
          Sign out everywhere
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b border-hairline p-3">
        <Field label="Remembered login duration" className="w-44">
          <CustomSelect
            value={String(days)}
            options={DURATIONS.map((value) => ({ value: String(value), label: `${value} days` }))}
            placeholder="Select a duration"
            onValueChange={(value) => setDays(Number(value) as RememberDays)}
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          loading={saving}
          onClick={() => void saveDuration()}
        >
          Save login duration
        </Button>
      </div>

      {error && (
        <p role="alert" className="border-b border-hairline p-3 text-ui text-data-neg">
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="p-8 text-center text-ui text-muted">No active login sessions.</p>
      ) : (
        sessions.map((item) => {
          const name = item.user_agent || "Unknown browser";
          return (
            <DataRow
              key={item.id}
              title={name}
              columns={[
                <span key="current" className={CURRENT_COL}>
                  {item.current ? <Chip tone="pos">Current</Chip> : null}
                </span>,
                // An IP is a literal, so it renders verbatim in mono — and an
                // absent one is an em-dash, not the words "Unknown IP".
                <span key="ip" className={`truncate font-mono text-instrument text-meta ${IP_COL}`}>
                  {item.ip_address || "—"}
                </span>,
              ]}
              actions={
                <Tooltip content={`Revoke ${name}`} side="left">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    aria-label={`Revoke ${name}`}
                    onClick={() => void revoke(item)}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </Tooltip>
              }
            />
          );
        })
      )}
    </section>
  );
}
