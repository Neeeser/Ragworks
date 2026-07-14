"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { GlassCard } from "@/components/ui/panel";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { registerUser } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/providers/auth-provider";
import { useAppConfig } from "@/providers/config-provider";

// Mono instrument voice for the form labels (design system §5).
const fieldLabelClass = "font-mono text-[11px] uppercase tracking-[0.28em] text-muted";

// A quiet text button for toggling between modes / returning to login.
const toggleClass =
  "rounded text-sm text-muted underline-offset-4 transition hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export default function SignInPage() {
  const router = useRouter();
  const { signIn, loading } = useAuth();
  const { config } = useAppConfig();
  const allowRegistration = config.auth.allow_registration;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === "login";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      if (mode === "login") {
        await signIn(form.email, form.password, rememberMe);
        router.push("/dashboard");
      } else {
        await registerUser(form);
        // The account was just created with these credentials — sign the
        // user straight in instead of bouncing them back to the login form.
        setMessage("Account created — signing you in…");
        await signIn(form.email, form.password, false);
        router.push("/dashboard");
      }
    } catch (error) {
      setMessage(getErrorMessage(error, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-6 py-12 text-body">
      {/* Atmospheric blooms in the product's violet/cyan trace colors. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 18% 12%, color-mix(in srgb, var(--accent-violet) 22%, transparent), transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(55% 45% at 85% 10%, color-mix(in srgb, var(--accent-cyan) 16%, transparent), transparent 60%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle />
      </div>

      <GlassCard className="relative z-10 flex w-full max-w-md flex-col gap-8 rounded-3xl border-hairline p-8 sm:p-10">
        {/* Eyebrow — live instrument label. */}
        <p
          className="landing-rise flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.4em] text-muted"
          style={{ animationDelay: "0ms" }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-cyan opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-cyan" />
          </span>
          Ragworks
        </p>

        {/* Heading — no subhead; the form itself is self-evident. */}
        <h1
          className="landing-rise text-balance text-3xl font-semibold tracking-tight text-primary"
          style={{ animationDelay: "80ms" }}
        >
          {isLogin ? "Sign in" : "Create your account"}
        </h1>

        {mode === "register" && !allowRegistration ? (
          <div className="landing-rise space-y-5" style={{ animationDelay: "160ms" }}>
            <p className="rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-body">
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

            {isLogin && (
              <label className="flex cursor-pointer items-center gap-3 text-sm text-body">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-hairline bg-surface accent-accent-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                />
                Remember me
              </label>
            )}

            {message && (
              <p className="rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-body">
                {message}
              </p>
            )}

            <div className="flex flex-col items-center gap-4 pt-1">
              <Button type="submit" className="w-full" loading={submitting || loading} size="lg">
                {isLogin ? "Enter dashboard" : "Create account"}
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
          className="landing-rise inline-block rounded font-mono text-[11px] uppercase tracking-[0.28em] text-meta transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          style={{ animationDelay: "240ms" }}
        >
          Back to home
        </Link>
      </GlassCard>
    </main>
  );
}
