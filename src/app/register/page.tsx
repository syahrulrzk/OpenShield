"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Lock, Mail, User, Loader2, AlertCircle, Check, ArrowRight } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwReqs = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const pwValid = Object.values(pwReqs).every(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pwValid) {
      setError("Password belum memenuhi semua requirement");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error || "Registrasi gagal");
        return;
      }
      // Auto-login
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!login.ok) {
        router.push("/login");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-[var(--background)] overflow-hidden">
      <div className="absolute inset-0 dot-bg opacity-50" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-white/[0.02] rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black glow">
            <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">OpenShield</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">Create your account</p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 backdrop-blur-sm">
          <div className="mb-6">
            <h2 className="text-base font-semibold tracking-tight">Register</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Get started monitoring your servers
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
              <label className="block text-xs font-medium mb-1.5">Name (optional)</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 py-2.5 text-sm focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] transition-all"
                  placeholder="John Doe"
                />
              </div>
            </div>

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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 py-2.5 text-sm font-mono focus:border-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] transition-all"
                  placeholder="Min 12 characters"
                />
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                {[
                  { key: "length", label: "12+ characters" },
                  { key: "upper", label: "Uppercase letter" },
                  { key: "lower", label: "Lowercase letter" },
                  { key: "digit", label: "Number" },
                  { key: "special", label: "Special character" },
                ].map((r) => (
                  <div
                    key={r.key}
                    className={`flex items-center gap-1.5 transition-colors ${
                      pwReqs[r.key as keyof typeof pwReqs]
                        ? "text-[var(--success)]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {pwReqs[r.key as keyof typeof pwReqs] ? (
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    ) : (
                      <div className="h-3 w-3 rounded-full border border-current opacity-50" />
                    )}
                    <span>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !pwValid}
              className="w-full rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium py-2.5 px-4 text-sm transition-all glow flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[var(--border)] text-center">
            <p className="text-xs text-[var(--muted-foreground)]">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-[var(--foreground)] font-medium hover:underline underline-offset-4"
              >
                Sign in
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
