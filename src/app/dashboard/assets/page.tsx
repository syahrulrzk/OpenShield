import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { AddAssetButton } from "./_components/add-asset-button";
import { Server, Circle, Database } from "lucide-react";
import Link from "next/link";

const DB_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  POSTGRES: { label: "Postgres", color: "#336791" },
  MYSQL: { label: "MySQL", color: "#00758f" },
  SQLSERVER: { label: "SQL Server", color: "#cc2927" },
};

export default async function AssetsPage() {
  const session = await getSession();
  if (!session) return null;

  const assets = await prisma.asset.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hostname: true,
      publicIp: true,
      privateIp: true,
      os: true,
      kernel: true,
      sshPort: true,
      sshUser: true,
      dbType: true,
      dbHost: true,
      dbPort: true,
      dbName: true,
      status: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Assets</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {assets.length} server{assets.length !== 1 ? "s" : ""} being monitored
          </p>
        </div>
        <AddAssetButton />
      </div>

      {assets.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[var(--border-strong)] p-12 text-center">
          <Server className="h-10 w-10 text-[var(--muted-foreground)] mx-auto" strokeWidth={1.5} />
          <h3 className="mt-4 text-sm font-semibold">No assets yet</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Add your first server to start monitoring SSH and database login events
          </p>
          <div className="mt-5">
            <AddAssetButton />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-white/[0.02]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Hostname
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden md:table-cell">
                    IP
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden lg:table-cell">
                    OS
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    SSH
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Database
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] hidden sm:table-cell">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const lastSeen = a.lastSeenAt ? new Date(a.lastSeenAt) : null;
                  const minutesAgo = lastSeen
                    ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
                    : null;
                  const isOnline = a.status === "ONLINE";
                  const dbBadge = a.dbType !== "NONE" ? DB_TYPE_BADGE[a.dbType] : null;
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Circle
                            className={`h-2 w-2 fill-current ${
                              isOnline
                                ? "text-[var(--success)]"
                                : a.status === "ERROR"
                                  ? "text-[var(--danger)]"
                                  : a.status === "PENDING"
                                    ? "text-[var(--warning)]"
                                    : "text-[var(--muted)]"
                            }`}
                          />
                          <span className="text-xs font-mono text-[var(--muted-foreground)]">
                            {a.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm font-medium">{a.hostname}</div>
                        {a.privateIp && (
                          <div className="text-[10px] text-[var(--muted-foreground)] font-mono">
                            {a.privateIp}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--muted-foreground)] hidden md:table-cell">
                        {a.publicIp || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] hidden lg:table-cell">
                        {a.os || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {a.sshUser ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                            <code className="font-mono text-[var(--muted-foreground)]">
                              :{a.sshPort}
                            </code>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {dbBadge ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: dbBadge.color }}
                            />
                            <span style={{ color: dbBadge.color }} className="font-medium">
                              {dbBadge.label}
                            </span>
                            {a.dbHost && (
                              <code className="text-[10px] text-[var(--muted-foreground)] font-mono">
                                :{a.dbPort}
                              </code>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] hidden sm:table-cell">
                        {minutesAgo !== null ? (
                          <span className="font-mono">{minutesAgo}m ago</span>
                        ) : (
                          <span>never</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-[var(--muted-foreground)]">
        <Link href="/dashboard" className="hover:text-[var(--foreground)] underline underline-offset-2">
          ← Back to overview
        </Link>
      </div>
    </div>
  );
}
