import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { Bell, AlertTriangle, AlertOctagon, CheckCircle2 } from "lucide-react";

const severityConfig = {
  LOW: { color: "blue", icon: CheckCircle2 },
  MEDIUM: { color: "amber", icon: AlertTriangle },
  HIGH: { color: "red", icon: AlertTriangle },
  CRITICAL: { color: "red", icon: AlertOctagon },
};

const colorMap: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  red: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
};

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) return null;

  const alerts = await prisma.alert.findMany({
    where: { asset: { userId: session.userId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      severity: true,
      title: true,
      description: true,
      status: true,
      metadata: true,
      createdAt: true,
      asset: { select: { hostname: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Alerts</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{alerts.filter(a => a.status === "OPEN").length} open alert(s)</p>
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-12 text-center">
          <Bell className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">No alerts 🎉</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sistem aman. Alerts bakal muncul di sini kalo ada anomali.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const cfg = severityConfig[a.severity as keyof typeof severityConfig];
            return (
              <div key={a.id} className={`rounded-xl border bg-white dark:bg-slate-900/40 p-4 ${colorMap[cfg.color]}`}>
                <div className="flex items-start gap-3">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${colorMap[cfg.color]}`}>
                    <cfg.icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider">{a.severity}</span>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{a.asset?.hostname || "system"}</span>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{new Date(a.createdAt).toLocaleString("id-ID")}</span>
                      {a.status !== "OPEN" && (
                        <>
                          <span className="text-[10px] text-slate-400">·</span>
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{a.status}</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{a.title}</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{a.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
