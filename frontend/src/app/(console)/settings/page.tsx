"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiKeysForm } from "@/components/settings/ApiKeysForm";
import { ApiKeyStatusPanel } from "@/components/settings/ApiKeyStatusPanel";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";
import { updateUserSettings, validateUserKeys } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";

import type { UserKeyValidation } from "@/lib/types";

export default function SettingsPage() {
  const { user, token, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    openrouter_api_key: "",
    pinecone_api_key: "",
  });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<UserKeyValidation | null>(null);
  const [pendingClear, setPendingClear] = useState({ openrouter: false, pinecone: false });

  const loadValidation = useCallback(async () => {
    if (!token) {
      setValidation(null);
      return;
    }
    setChecking(true);
    try {
      const result = await validateUserKeys(token);
      setValidation(result);
    } catch (err) {
      setMessage(getErrorMessage(err, "Unable to validate API keys."));
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    void loadValidation();
  }, [token, loadValidation]);

  const openrouterConfigured = useMemo(
    () => validation?.openrouter.configured ?? user?.openrouter_configured ?? false,
    [validation, user?.openrouter_configured],
  );
  const pineconeConfigured = useMemo(
    () => validation?.pinecone.configured ?? user?.pinecone_configured ?? false,
    [validation, user?.pinecone_configured],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setMessage("Sign in to update your settings.");
      return;
    }
    const openrouterValue = form.openrouter_api_key.trim();
    const pineconeValue = form.pinecone_api_key.trim();
    const payload: { openrouter_api_key?: string; pinecone_api_key?: string } = {};
    if (openrouterValue) {
      payload.openrouter_api_key = form.openrouter_api_key;
    } else if (pendingClear.openrouter) {
      payload.openrouter_api_key = "";
    }
    if (pineconeValue) {
      payload.pinecone_api_key = form.pinecone_api_key;
    } else if (pendingClear.pinecone) {
      payload.pinecone_api_key = "";
    }
    if (!Object.keys(payload).length) {
      setMessage("No changes to save.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateUserSettings(token, payload);
      setForm({ openrouter_api_key: "", pinecone_api_key: "" });
      setPendingClear({ openrouter: false, pinecone: false });
      await refreshProfile();
      await loadValidation();
      setMessage("Settings saved.");
    } catch (err) {
      setMessage(getErrorMessage(err, "Unable to update settings."));
    } finally {
      setSaving(false);
    }
  };

  const resolveBadge = useCallback(
    (status: UserKeyValidation["openrouter"] | undefined, configured: boolean) => {
      if (checking) {
        return { label: "Checking", className: "bg-slate-500/15 text-slate-200" };
      }
      if (!configured) {
        return { label: "Missing", className: "bg-amber-500/15 text-amber-200" };
      }
      if (status?.valid) {
        return { label: "Connected", className: "bg-emerald-500/15 text-emerald-200" };
      }
      if (status) {
        return { label: "Invalid", className: "bg-rose-500/15 text-rose-200" };
      }
      return { label: "Configured", className: "bg-emerald-500/15 text-emerald-200" };
    },
    [checking],
  );

  const openrouterStatus = validation?.openrouter;
  const pineconeStatus = validation?.pinecone;
  const openrouterBadge = useMemo(
    () => resolveBadge(openrouterStatus, openrouterConfigured),
    [openrouterConfigured, openrouterStatus, resolveBadge],
  );
  const pineconeBadge = useMemo(
    () => resolveBadge(pineconeStatus, pineconeConfigured),
    [pineconeConfigured, pineconeStatus, resolveBadge],
  );
  const openrouterPlaceholder = openrouterConfigured ? "Key saved (hidden)" : "or-...";
  const pineconePlaceholder = pineconeConfigured ? "Key saved (hidden)" : "pc-...";

  const openrouterStatusText = useMemo(() => {
    if (checking) {
      return "Checking OpenRouter credentials...";
    }
    if (!openrouterConfigured) {
      return "Not configured. Add a key to enable chat and embeddings.";
    }
    if (!openrouterStatus) {
      return "Configured. Validation unavailable.";
    }
    if (openrouterStatus?.valid) {
      return "Connected. Model catalog and chat tools are available.";
    }
    return openrouterStatus?.message || "Invalid OpenRouter API key.";
  }, [checking, openrouterConfigured, openrouterStatus]);

  const pineconeStatusText = useMemo(() => {
    if (checking) {
      return "Checking Pinecone credentials...";
    }
    if (!pineconeConfigured) {
      return "Not configured. Add a key to enable collections and indexing.";
    }
    if (!pineconeStatus) {
      return "Configured. Validation unavailable.";
    }
    if (pineconeStatus?.valid) {
      return "Connected. Collections can ingest and retrieve.";
    }
    return pineconeStatus?.message || "Invalid Pinecone API key.";
  }, [checking, pineconeConfigured, pineconeStatus]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Settings</p>
        <h1 className="text-3xl font-semibold text-white">Configure your API keys.</h1>
        <p className="mt-2 text-sm text-slate-400">
          Keys are stored per user and required for collections, chat, and retrieval tooling.
        </p>
      </div>

      {message && (
        <Notification
          title="Settings"
          message={message}
          onDismiss={() => setMessage(null)}
          className="rounded-3xl"
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <GlassCard className="rounded-3xl p-6">
          <ApiKeysForm
            openrouterValue={form.openrouter_api_key}
            pineconeValue={form.pinecone_api_key}
            onChangeOpenrouter={(value) => {
              setPendingClear((prev) => ({ ...prev, openrouter: false }));
              setForm((prev) => ({ ...prev, openrouter_api_key: value }));
            }}
            onChangePinecone={(value) => {
              setPendingClear((prev) => ({ ...prev, pinecone: false }));
              setForm((prev) => ({ ...prev, pinecone_api_key: value }));
            }}
            openrouterBadge={openrouterBadge}
            pineconeBadge={pineconeBadge}
            openrouterConfigured={openrouterConfigured}
            pineconeConfigured={pineconeConfigured}
            openrouterPlaceholder={openrouterPlaceholder}
            pineconePlaceholder={pineconePlaceholder}
            pendingClearOpenrouter={pendingClear.openrouter}
            pendingClearPinecone={pendingClear.pinecone}
            onRemoveOpenrouter={() => setPendingClear((prev) => ({ ...prev, openrouter: true }))}
            onRemovePinecone={() => setPendingClear((prev) => ({ ...prev, pinecone: true }))}
            saving={saving}
            onSubmit={handleSubmit}
          />
        </GlassCard>

        <GlassCard className="rounded-3xl p-6">
          <ApiKeyStatusPanel
            openrouterStatusText={openrouterStatusText}
            pineconeStatusText={pineconeStatusText}
          />
        </GlassCard>
      </div>
    </div>
  );
}
