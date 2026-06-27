import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { Database, Server, Activity } from "lucide-react";
import Link from "next/link";
import { DatabaseHeader } from "./_components/database-header";
import { DatabaseAssetsTable } from "./_components/database-assets-table";

export default async function DatabasePage() {
  const session = await getSession();
  if (!session) return null;

  const assets = await prisma.asset.findMany({
    where: { userId: session.userId, category: "DATABASE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      displayName: true,
      hostname: true,
      environment: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      dbUser: true,
      status: true,
      createdAt: true,
      role: true,
      location: true,
      description: true,
      tags: true,
      monitorAllDatabases: true,
      discoveredDatabases: true,
      lastDiscoveryAt: true,
      auditConnectionLog: true,
      _count: { select: { databaseEvents: true } },
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <DatabaseHeader />

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1: ASSETS (monitored databases)                  */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--primary)]" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Database Assets
            </h2>
            <span className="text-[10px] text-zinc-600 font-mono">{assets.length}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link
              href="/dashboard/network"
              className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
            >
              ← Network Assets
            </Link>
            <Link
              href="/dashboard/apps"
              className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
            >
              Apps Assets →
            </Link>
            <Link
              href="/dashboard/events/database"
              className="text-[var(--muted-foreground)] hover:text-[var(--accent)] transition-colors"
            >
              View Events →
            </Link>
          </div>
        </div>
        <DatabaseAssetsTable assets={assets.map((a) => ({
          ...a,
          discoveredDatabases: Array.isArray(a.discoveredDatabases)
            ? (a.discoveredDatabases as string[])
            : null,
        }))} />
      </section>
    </div>
  );
}
