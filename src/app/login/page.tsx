"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Lock,
  Mail,
  Loader2,
  AlertCircle,
  ArrowRight,
  KeyRound,
  Database,
  Eye,
  Code2,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: KeyRound,
    title: "SSH Access Monitoring",
    desc: "Login sukses & brute-force detection",
  },
  {
    icon: Database,
    title: "Database Activity Log",
    desc: "MySQL, PostgreSQL, SQL Server audit trail",
  },
  {
    icon: Eye,
    title: "Threat Intelligence",
    desc: "Top attacker IP via CrowdSec & Wazuh",
  },
];

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
    <div className="min-h-screen relative flex bg-[#0a0a0a] text-white overflow-hidden">
      {/* Global grid + radial glow background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16,185,129,1) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute bottom-[-200px] right-[-200px] w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[100px]" />
      </div>

      {/* ============== LEFT: BRANDING ============== */}
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="hidden lg:flex flex-col w-1/2 xl:w-[55%] relative p-10 xl:p-16 border-r border-emerald-500/10"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ rotate: -180, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6, type: "spring" }}
              className="h-10 w-10 rounded-xl bg-emerald-500 text-black flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.4)]"
            >
              <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
            </motion.div>
            <div>
              <div className="text-base font-bold tracking-tight">OpenShield</div>
              <div className="h-px w-12 bg-emerald-500 mt-0.5" />
            </div>
          </div>
          <a
            href="#"
            className="flex items-center gap-2 text-xs text-white/50 hover:text-emerald-400 transition-colors"
          >
            <Code2 className="h-3.5 w-3.5" />
            v1.0.0 · Open source
          </a>
        </div>

        {/* Hero copy */}
        <div className="flex-1 flex flex-col justify-center max-w-xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold tracking-[0.2em] uppercase text-emerald-400"
          >
            <Sparkles className="h-3 w-3" />
            Security Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="mt-5 text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05]"
          >
            Monitor. Detect.
            <br />
            <span className="text-emerald-400">Respond.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-5 text-sm xl:text-base text-white/60 leading-relaxed max-w-md"
          >
            Pantau seluruh akses SSH, aktivitas database, dan ancaman siber
            secara real-time dari satu dashboard terpusat.
          </motion.p>

          {/* Features list */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.1, delayChildren: 0.6 } },
            }}
            className="mt-10 space-y-3"
          >
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={{
                    hidden: { opacity: 0, x: -10 },
                    show: { opacity: 1, x: 0 },
                  }}
                  className="group flex items-start gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-emerald-500/30 hover:bg-emerald-500/[0.03] transition-all"
                >
                  <div className="shrink-0 h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icon className="h-4 w-4 text-emerald-400" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {f.title}
                    </div>
                    <div className="text-xs text-white/50 mt-0.5">{f.desc}</div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Bottom footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-[10px] text-emerald-500/40 font-mono tracking-wider uppercase"
        >
          v1.0.0 · Open source · MIT
        </motion.div>
      </motion.aside>

      {/* ============== RIGHT: LOGIN FORM ============== */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="flex-1 flex flex-col relative"
      >
        {/* Mobile brand bar */}
        <div className="lg:hidden flex items-center gap-3 p-6 border-b border-white/[0.06]">
          <div className="h-9 w-9 rounded-lg bg-emerald-500 text-black flex items-center justify-center">
            <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.5} />
          </div>
          <div className="text-sm font-bold tracking-tight">OpenShield</div>
        </div>

        {/* Form container */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {/* Mobile tagline */}
            <div className="lg:hidden mb-8">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-semibold tracking-[0.2em] uppercase text-emerald-400 mb-3">
                <Sparkles className="h-2.5 w-2.5" />
                Security Platform
              </div>
              <h1 className="text-3xl font-bold tracking-tight leading-tight">
                Monitor. Detect. <span className="text-emerald-400">Respond.</span>
              </h1>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-3xl font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-white/50 mt-1.5">
                Enter your credentials to access the dashboard
              </p>
            </motion.div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label className="block text-[10px] font-semibold tracking-[0.15em] uppercase text-emerald-400 mb-2">
                  Email
                </label>
                <div className="relative group">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-emerald-400 transition-colors" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] pl-11 pr-3 py-3 text-sm placeholder:text-white/20 focus:border-emerald-500/50 focus:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-emerald-500/30 transition-all"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold tracking-[0.15em] uppercase text-emerald-400 mb-2">
                  Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 group-focus-within:text-emerald-400 transition-colors" />
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] pl-11 pr-3 py-3 text-sm font-mono placeholder:text-white/20 focus:border-emerald-500/50 focus:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-emerald-500/30 transition-all"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-white text-black hover:bg-emerald-400 hover:text-black disabled:opacity-50 disabled:hover:bg-white font-medium py-3 px-4 text-sm transition-all flex items-center justify-center gap-2 group shadow-[0_0_20px_rgba(255,255,255,0.05)] hover:shadow-[0_0_30px_rgba(16,185,129,0.4)]"
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

            <div className="mt-6 pt-6 border-t border-white/[0.06] text-center">
              <p className="text-[11px] text-white/40 flex items-center justify-center gap-1.5">
                <Lock className="h-3 w-3" strokeWidth={1.75} />
                Invite-only. Hubungi admin untuk buat akun baru.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom status bar */}
        <div className="px-6 sm:px-10 py-5 flex items-center justify-between text-[10px] font-mono text-white/40">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="uppercase tracking-wider text-emerald-500/70">
              System Operational
            </span>
          </div>
          <div className="uppercase tracking-wider hidden sm:block">
            Argon2id · AES-256-GCM
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
