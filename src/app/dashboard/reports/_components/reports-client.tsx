"use client";

import { useState } from "react";
import {
  Server,
  Database,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  Activity,
  Calendar,
} from "lucide-react";

export function ReportsClient() {
  const [days, setDays] = useState(7);
  const [type, setType] = useState<"ssh" | "db" | "all">("all");
  const [status, setStatus] = useState<"idle" | "generating" | "success" | "error">("idle");
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; events: number } | null>(null);

  async function generate() {
    setStatus("generating");
    setFileInfo(null);
    try {
      // Trigger download via hidden link
      const url = `/api/reports/events?type=${type}&days=${days}`;
      const r = await fetch(url);
      if (!r.ok) {
        setStatus("error");
        return;
      }
      const blob = await r.blob();
      const size = blob.size;
      const filename =
        r.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ??
        `openshield-${type}-${days}d.xlsx`;

      // Trigger download
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);

      // Parse filename to extract event count if present
      const events = parseInt(filename.match(/-(\d+)\.xlsx/)?.[1] ?? "0");

      setFileInfo({ name: filename, size, events });
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6" />
          Reports
        </h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Generate Excel reports dari security events untuk audit, compliance, atau arsip internal.
        </p>
      </div>

      {/* Config Card */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[var(--muted-foreground)]" />
          <h2 className="text-sm font-semibold">Report Configuration</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Period */}
          <div>
            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-2 uppercase tracking-wider">
              Period
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`h-9 rounded-lg text-xs font-mono transition-colors border ${
                    days === d
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-semibold"
                      : "border-[var(--border)] hover:bg-white/[0.04]"
                  }`}
                >
                  {d === 1 ? "24h" : `${d}d`}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div className="md:col-span-2">
            <label className="block text-[10px] font-medium text-[var(--muted-foreground)] mb-2 uppercase tracking-wider">
              Report Type
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <TypeButton
                active={type === "ssh"}
                onClick={() => setType("ssh")}
                icon={Server}
                label="SSH Events"
                sub="Login SSH only"
              />
              <TypeButton
                active={type === "db"}
                onClick={() => setType("db")}
                icon={Database}
                label="DB Events"
                sub="DB login only"
              />
              <TypeButton
                active={type === "all"}
                onClick={() => setType("all")}
                icon={FileSpreadsheet}
                label="All Events"
                sub="Combined report"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 pt-5 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--muted-foreground)]">
            File: <code className="text-[var(--foreground)]">openshield-{type}-{days}d-NNN.xlsx</code>
          </div>
          <button
            onClick={generate}
            disabled={status === "generating"}
            className="flex items-center gap-2 h-9 px-5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium"
          >
            <Download className="h-4 w-4" strokeWidth={2.5} />
            {status === "generating" ? "Generating..." : "Generate & Download"}
          </button>
        </div>

        {/* Status */}
        {status === "success" && fileInfo && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-xs text-[var(--success)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Report downloaded</div>
              <div className="text-[10px] mt-0.5 font-mono opacity-80">
                {fileInfo.name} · {(fileInfo.size / 1024).toFixed(1)} KB
                {fileInfo.events > 0 && ` · ${fileInfo.events} events`}
              </div>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Gagal generate report. Cek console / coba lagi.</span>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InfoCard
          icon={Server}
          color="#10b981"
          title="SSH Events"
          description="Berisi semua SSH login attempts (success + failed) dengan username, source IP, hostname, dan timestamp. Cocok untuk compliance audit dan incident response."
        />
        <InfoCard
          icon={Database}
          color="#3b82f6"
          title="DB Events"
          description="Login events untuk PostgreSQL, MySQL, dan SQL Server. Hanya metadata login (username, source IP, status) — query text TIDAK di-record untuk performance."
        />
        <InfoCard
          icon={FileSpreadsheet}
          color="#a855f7"
          title="All Events (Combined)"
          description="Multi-sheet workbook. Sheet 1 = SSH, Sheet 2 = DB, Sheet 3 = Summary. Cocok untuk satu file arsip lengkap."
        />
      </div>

      {/* Features */}
      <div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-4 space-y-2 text-xs text-[var(--muted-foreground)]">
        <div className="flex items-center gap-2 font-semibold text-[var(--foreground)]">
          <Activity className="h-3.5 w-3.5" />
          Report Features
        </div>
        <ul className="space-y-1 pl-5 list-disc">
          <li>Server-side generation dengan <code className="text-[var(--foreground)]">exceljs</code> — tidak ada beban di browser</li>
          <li>Status events auto-colored (hijau = SUCCESS, merah = FAILED/INVALID/DENIED)</li>
          <li>Column widths auto-fit, header bold + freeze pane</li>
          <li>Multi-sheet untuk combined report (SSH + DB + Summary)</li>
          <li>Filename include timestamp + event count untuk easy archival</li>
        </ul>
      </div>
    </div>
  );
}

function TypeButton({
  active,
  onClick,
  icon: Icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-1 p-3 rounded-lg text-left transition-colors ${
        active
          ? "bg-white/[0.08] border border-white/20"
          : "border border-[var(--border)] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${active ? "text-white" : "text-[var(--muted-foreground)]"}`} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <span className="text-[10px] text-[var(--muted-foreground)]">{sub}</span>
    </button>
  );
}

function InfoCard({
  icon: Icon,
  color,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div
        className="h-9 w-9 rounded-lg flex items-center justify-center mb-3"
        style={{ backgroundColor: `${color}15`, color }}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-sm font-semibold mb-1">{title}</div>
      <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{description}</p>
    </div>
  );
}
