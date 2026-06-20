import { Lock, Database, Sparkles, ArrowLeft } from "lucide-react";
import Link from "next/link";

type Props = {
  variant: "database" | "aplikasi";
};

const COPY: Record<Props["variant"], {
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  phase: string;
}> = {
  database: {
    title: "Database Events",
    subtitle: "Postgres · MySQL · SQL Server login monitoring",
    description:
      "Soon lo bisa monitor siapa yang login ke database lo, dari mana, kapan, success atau failed. Tinggal connect read-only role ke tiap DB dan event otomatis ke-capture.",
    features: [
      "Login success/failed tracking per user",
      "Source IP + GeoIP resolution",
      "Brute force detection (>20 failed/5min)",
      "Read-only role support (no query access)",
    ],
    phase: "Phase 2 · Q3 2026",
  },
  aplikasi: {
    title: "Application Events",
    subtitle: "SaaS · Admin panels · HTTP API access monitoring",
    description:
      "Monitor siapa yang akses aplikasi lo: login ke admin panel, panggil internal API, login ke SaaS dashboard. Tanpa deploy agent — plug a webhook and events flow in.",
    features: [
      "Webhook-based ingestion (no agent)",
      "Admin panel login tracking",
      "Internal API access logs",
      "Per-user activity timeline",
    ],
    phase: "Phase 3 · Q4 2026",
  },
};

export default function UpcomingEventsPage({ variant }: Props) {
  const c = COPY[variant];
  const Icon = variant === "database" ? Database : Lock;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/server"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to SSH Events
        </Link>
      </div>

      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-white/[0.02] overflow-hidden">
        <div className="px-6 py-12 sm:py-16 text-center">
          <div className="inline-flex h-16 w-16 rounded-2xl bg-white/[0.04] border border-[var(--border)] items-center justify-center mb-5">
            <Icon className="h-7 w-7 text-[var(--muted-foreground)]" strokeWidth={1.5} />
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-[var(--border)] text-[10px] font-mono uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
            <Sparkles className="h-3 w-3" strokeWidth={1.75} />
            Coming Soon
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {c.title}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)] max-w-md mx-auto">
            {c.subtitle}
          </p>

          <p className="mt-6 text-sm text-[var(--muted-foreground)] max-w-lg mx-auto leading-relaxed">
            {c.description}
          </p>
        </div>

        <div className="border-t border-[var(--border)] bg-white/[0.01] px-6 py-6">
          <div className="max-w-md mx-auto space-y-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Yang akan di-ship
            </div>
            {c.features.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 text-xs text-[var(--muted-foreground)]"
              >
                <div className="mt-1 h-1 w-1 rounded-full bg-[var(--muted-foreground)] shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[var(--border)] px-6 py-4 flex items-center justify-center gap-2 text-[10px] font-mono text-[var(--muted-foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)] animate-pulse" />
          {c.phase}
        </div>
      </div>
    </div>
  );
}
