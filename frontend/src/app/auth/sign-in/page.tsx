"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/panel";
import { registerUser } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";
import { useAppConfig } from "@/providers/config-provider";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, loading } = useAuth();
  const { config } = useAppConfig();
  const allowRegistration = config.auth.allow_registration;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      if (mode === "login") {
        await signIn(form.email, form.password);
        router.push("/dashboard");
      } else {
        await registerUser(form);
        setMessage("Workspace created. You can sign in now.");
        setMode("login");
      }
    } catch (error) {
      setMessage(getErrorMessage(error, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-12 text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(14,165,233,0.25),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_40%,rgba(124,58,237,0.3),transparent_55%)]" />
      </div>

      <GlassCard className="relative z-10 grid w-full max-w-5xl gap-10 overflow-hidden rounded-[2.25rem] border-white/10 bg-slate-900/60 p-8 shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col gap-6 rounded-3xl bg-white/5 p-8">
          <div className="flex items-center gap-3 text-sm uppercase tracking-[0.35em] text-slate-300">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            Secure workspace access
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold text-white">Welcome back.</h1>
            <p className="text-slate-300">
              Log into your Ragworks control room to monitor ingestion, experiment with chunking
              strategies, and host transparent chats.
            </p>
          </div>

          <div className="grid gap-4 rounded-2xl border border-white/5 bg-gradient-to-br from-white/5 via-transparent to-white/5 p-5">
            {[
              "JWT-secured per-user telemetry",
              "Collection-scoped Pinecone namespaces",
              "Query + chat history with usage accounting",
            ].map((item) => (
              <p key={item} className="text-sm text-slate-300">
                • {item}
              </p>
            ))}
          </div>
        </section>

        <section className="flex flex-col justify-center gap-8 rounded-3xl border border-white/5 bg-slate-900/80 p-8">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-violet-300" />
            <div className="text-sm uppercase tracking-[0.4em] text-violet-200">
              {mode === "login" ? "Sign in" : "Create workspace"}
            </div>
          </div>

          {mode === "register" && !allowRegistration ? (
            <div className="space-y-5">
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                Registration is disabled. Ask an administrator for an invite.
              </p>
              <button
                type="button"
                className="text-sm text-slate-400 underline-offset-4 hover:text-white hover:underline"
                onClick={() => {
                  setMode("login");
                  setMessage(null);
                }}
              >
                Already have access?
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <Field label="Email">
                <TextInput
                  type="email"
                  required
                  className="text-base"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </Field>
              {mode === "register" && (
                <Field label="Full name">
                  <TextInput
                    type="text"
                    className="text-base"
                    value={form.full_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  />
                </Field>
              )}
              <Field label="Password">
                <TextInput
                  type="password"
                  required
                  className="text-base"
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                />
              </Field>

              {message && (
                <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  {message}
                </p>
              )}

              <div className="flex flex-col gap-4">
                <Button type="submit" loading={submitting || loading} size="lg">
                  {mode === "login" ? "Enter dashboard" : "Create workspace"}
                </Button>
                {allowRegistration && (
                  <button
                    type="button"
                    className="text-sm text-slate-400 underline-offset-4 hover:text-white hover:underline"
                    onClick={() => {
                      setMode((prev) => (prev === "login" ? "register" : "login"));
                      setMessage(null);
                    }}
                  >
                    {mode === "login" ? "Need an account?" : "Already have access?"}
                  </button>
                )}
              </div>
            </form>
          )}

          <p className="text-center text-xs text-slate-500">
            Lost?{" "}
            <Link href="/" className="text-violet-300 hover:text-white">
              Return home
            </Link>
          </p>
        </section>
      </GlassCard>
    </main>
  );
}
