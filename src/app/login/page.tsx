"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Lock, Mail, Loader2, AlertCircle, ArrowRight } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error || "Login gagal");
        return;
      }
      const from = sp.get("from") || "/dashboard";
      router.push(from);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-[var(--background)] overflow-hidden">
      {/* Subtle grid background */}
      <div className="absolute inset-0 dot-bg opacity-50" />
      {/* Radial gradient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-white/[0.02] rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black glow">
            <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">OpenShield</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Server security monitoring
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 backdrop-blur-sm">
          <div className="mb-6">
            <h2 className="text-base font-semibold tracking-tight">Sign in</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Enter your credentials to access the dashboard
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 py-2.5 text-sm focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] transition-all"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 py-2.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] transition-all"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-50 font-medium py-2.5 px-4 text-sm transition-all glow flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--border)] text-center">
            <p className="text-xs text-[var(--muted-foreground)]">
              Don&apos;t have an account?{" "}
              <Link
                href="/register"
                className="text-[var(--foreground)] font-medium hover:underline underline-offset-4"
              >
                Register
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-[10px] text-[var(--muted-foreground)] font-mono tracking-wider uppercase">
          v0.1.0 · OWASP 2025 · Argon2id
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
