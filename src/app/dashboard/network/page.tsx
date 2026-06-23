import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { Network, Router, Radio, Shield } from "lucide-react";
import Link from "next/link";
import { subHours } from "date-fns";
import { NetworkDevicesTable, type NetworkDevice } from "./_components/network-devices-table";

const VENDOR_META: Record<string, { label: string; color: string; icon: any }> = {
  cisco: { label: "Cisco", color: "#049fd9", icon: Router },
  mikrotik: { label: "MikroTik", color: "#293239", icon: Radio },
  fortinet: { label: "Fortinet", color: "#da291c", icon: Shield },
  juniper: { label: "Juniper", color: "#02a1a8", icon: Network },
  paloalto: { label: "Palo Alto", color: "#fa582d", icon: Shield },
  ubiquiti: { label: "Ubiquiti", color: "#02a076", icon: Radio },
  hp: { label: "HP / Aruba", color: "#0096d6", icon: Network },
  huawei: { label: "Huawei", color: "#cf0a2c", icon: Network },
  generic: { label: "Generic", color: "#71717a", icon: Network },
};

const ENV_META: Record<string, { label: string; color: string }> = {
  PROD: { label: "Production", color: "#ef4444" },
  STAGING: { label: "Staging", color: "#f97316" },
  UAT: { label: "UAT", color: "#3b82f6" },
  DEV: { label: "Dev", color: "#71717a" },
  DR: { label: "DR", color: "#a855f7" },
};

export default async function NetworkDevicesPage() {
  const session = await getSession();
  if (!session) return null;

  const since = subHours(new Date(), 24);

  // Pull all NETWORK assets for this user
  const assets = await prisma.asset.findMany({
    where: {
      userId: session.userId,
      category: "NETWORK",
    },
    select: {
      id: true,
      displayName: true,
      hostname: true,
      vendor: true,
      model: true,
      firmware: true,
      mgmtIp: true,
      syslogPort: true,
      sshEnabled: true,
      environment: true,
      location: true,
      role: true,
      description: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: [{ status: "asc" }, { displayName: "asc" }],
  });

  // Roll up event counts per asset for the 24h window
  const eventCounts = await prisma.tEventLogNetwork.groupBy({
    by: ["assetId"],
    where: {
      assetId: { not: null },
      eventTime: { gte: since },
      agent: { revokedAt: null },
    },
    _count: { _all: true },
  });
  const errorCounts = await prisma.tEventLogNetwork.groupBy({
    by: ["assetId"],
    where: {
      assetId: { not: null },
      eventTime: { gte: since },
      severity: "ERROR",
      agent: { revokedAt: null },
    },
    _count: { _all: true },
  });
  const countMap = new Map(eventCounts.map((c) => [c.assetId!, c._count._all]));
  const errMap = new Map(errorCounts.map((c) => [c.assetId!, c._count._all]));

  // Also count "unlinked" events (assetId null) to show orphan rate
  const unlinkedCount = await prisma.tEventLogNetwork.count({
    where: {
      assetId: null,
      eventTime: { gte: since },
      agent: { revokedAt: null },
    },
  });

  const devices: NetworkDevice[] = assets.map((a) => ({
    id: a.id,
    displayName: a.displayName ?? a.hostname,
    hostname: a.hostname,
    vendor: a.vendor,
    model: a.model,
    firmware: a.firmware,
    mgmtIp: a.mgmtIp,
    syslogPort: a.syslogPort,
    sshEnabled: a.sshEnabled,
    environment: a.environment,
    location: a.location,
    role: a.role,
    description: a.description,
    status: a.status,
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    eventCount24h: countMap.get(a.id) ?? 0,
    errorCount24h: errMap.get(a.id) ?? 0,
  }));

  // Vendor mix summary
  const vendorCounts: Record<string, number> = {};
  for (const d of devices) {
    const v = d.vendor ?? "generic";
    vendorCounts[v] = (vendorCounts[v] ?? 0) + 1;
  }
  const totalDevices = devices.length;
  const withMgmtIp = devices.filter((d) => d.mgmtIp).length;
  const activeDevices = devices.filter((d) => d.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Network Devices
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Asset inventory untuk network equipment (Cisco / MikroTik / Fortinet / others).
            Syslog UDP/514 dari device ini akan otomatis di-link ke inventory
            berdasarkan mgmt IP.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/dashboard/events/network"
            className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
          >
            ← Network Events
          </Link>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={Network}
          label="Total Devices"
          value={totalDevices}
          color="#a78bfa"
          hint={withMgmtIp > 0 ? `${withMgmtIp} with mgmt IP` : "no mgmt IP set"}
        />
        <StatCard
          icon={Router}
          label="Active"
          value={activeDevices}
          color="#10b981"
          hint={totalDevices > 0 ? `${Math.round((activeDevices / totalDevices) * 100)}% of fleet` : "—"}
        />
        <StatCard
          icon={Shield}
          label="With Mgmt IP"
          value={withMgmtIp}
          color="#22d3ee"
          hint="anti-spoof enabled"
        />
        <StatCard
          icon={Radio}
          label="Unlinked Events 24h"
          value={unlinkedCount}
          color={unlinkedCount > 0 ? "#f59e0b" : "#71717a"}
          hint={unlinkedCount > 0 ? "no matching device — add or set mgmtIp" : "clean"}
        />
      </div>

      {/* Vendor mix quick view */}
      {Object.keys(vendorCounts).length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/40">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            Vendor Mix:
          </span>
          {Object.entries(vendorCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([v, c]) => {
              const meta = VENDOR_META[v] ?? VENDOR_META.generic;
              const Icon = meta.icon;
              return (
                <span
                  key={v}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium"
                  style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}: {c}
                </span>
              );
            })}
        </div>
      )}

      {/* Devices table */}
      <NetworkDevicesTable initialDevices={devices} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  hint,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col p-4 rounded-lg border border-[var(--border)] bg-[var(--card)]/40 backdrop-blur">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-zinc-100">{value}</div>
      {hint && <div className="text-[10px] text-zinc-600 mt-1">{hint}</div>}
    </div>
  );
}
