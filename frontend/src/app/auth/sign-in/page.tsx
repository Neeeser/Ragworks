"use client";

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

// Mono instrument voice for the form labels (design system §5).
const fieldLabelClass = "font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400";

// A quiet text button for toggling between modes / returning to login.
const toggleClass =
  "rounded text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a]";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, loading } = useAuth();
  const { config } = useAppConfig();
  const allowRegistration = config.auth.allow_registration;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05060a] px-6 py-12 text-slate-100">
      {/* Atmospheric blooms in the product's violet/cyan trace colors. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_18%_12%,rgba(139,92,246,0.22),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(55%_45%_at_85%_10%,rgba(34,211,238,0.16),transparent_60%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#05060a] to-transparent" />
      </div>

      <GlassCard className="relative z-10 flex w-full max-w-md flex-col gap-8 rounded-3xl border-white/10 p-8 sm:p-10">
        {/* Eyebrow — live instrument label. */}
        <p
          className="landing-rise flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-slate-400"
          style={{ animationDelay: "0ms" }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
          </span>
          Ragworks console
        </p>

        {/* Heading — no subhead; the form itself is self-evident. */}
        <h1
          className="landing-rise text-balance text-3xl font-semibold tracking-tight text-white"
          style={{ animationDelay: "80ms" }}
        >
          {isLogin ? "Sign in" : "Create your account"}
        </h1>

        {mode === "register" && !allowRegistration ? (
          <div className="landing-rise space-y-5" style={{ animationDelay: "160ms" }}>
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              Registration is disabled. Ask an administrator for an invite.
            </p>
            <button
              type="button"
              className={toggleClass}
              onClick={() => {
                setMode("login");
                setMessage(null);
              }}
            >
              Already have access?
            </button>
          </div>
        ) : (
          <form
            className="landing-rise space-y-5"
            style={{ animationDelay: "160ms" }}
            onSubmit={handleSubmit}
          >
            <Field label="Email" labelClassName={fieldLabelClass}>
              <TextInput
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </Field>
            {mode === "register" && (
              <Field label="Full name" labelClassName={fieldLabelClass}>
                <TextInput
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                />
              </Field>
            )}
            <Field label="Password" labelClassName={fieldLabelClass}>
              <TextInput
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </Field>

            {message && (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                {message}
              </p>
            )}

            <div className="flex flex-col items-center gap-4 pt-1">
              <Button type="submit" className="w-full" loading={submitting || loading} size="lg">
                {isLogin ? "Enter dashboard" : "Create workspace"}
              </Button>
              {allowRegistration && (
                <button
                  type="button"
                  className={toggleClass}
                  onClick={() => {
                    setMode((prev) => (prev === "login" ? "register" : "login"));
                    setMessage(null);
                  }}
                >
                  {isLogin ? "Need an account?" : "Already have access?"}
                </button>
              )}
            </div>
          </form>
        )}

        {/* Footer: just the way back — nothing decorative. */}
        <Link
          href="/"
          className="landing-rise inline-block rounded font-mono text-[11px] uppercase tracking-[0.28em] text-slate-500 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05060a]"
          style={{ animationDelay: "240ms" }}
        >
          Back to home
        </Link>
      </GlassCard>
    </main>
  );
}
