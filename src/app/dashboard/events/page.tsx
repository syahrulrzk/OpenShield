import { prisma } from "@/lib/db";
import { getSession } from "@/lib/security/rbac";
import { CheckCircle2, XCircle, Terminal } from "lucide-react";
import { subHours, subDays } from "date-fns";

type Search = { range?: string; status?: string; ip?: string };

export default async function EventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;
  const range = sp.range || "24h";
  const since =
    range === "1h" ? subHours(new Date(), 1) :
    range === "7d" ? subDays(new Date(), 7) :
    subDays(new Date(), 1);

  const where: any = { asset: { userId: session.userId }, eventTime: { gte: since } };
  if (sp.status === "success") where.status = "SUCCESS";
  if (sp.status === "failed") where.status = "FAILED";
  if (sp.ip) where.sourceIp = sp.ip;

  const events = await prisma.sshEvent.findMany({
    where,
    orderBy: { eventTime: "desc" },
    take: 100,
    select: {
      id: true,
      username: true,
      sourceIp: true,
      status: true,
      method: true,
      country: true,
      eventTime: true,
      asset: { select: { hostname: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SSH Events</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Login attempts across all monitored servers</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: "1h", label: "1h" },
          { value: "24h", label: "24h" },
          { value: "7d", label: "7d" },
        ].map((r) => (
          <a
            key={r.value}
            href={`/dashboard/events?range=${r.value}${sp.status ? `&status=${sp.status}` : ""}${sp.ip ? `&ip=${sp.ip}` : ""}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              range === r.value
                ? "bg-indigo-500 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            }`}
          >
            {r.label}
          </a>
        ))}
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
        {[
          { value: "all", label: "All" },
          { value: "success", label: "Success" },
          { value: "failed", label: "Failed" },
        ].map((s) => (
          <a
            key={s.value}
            href={`/dashboard/events?range=${range}${s.value !== "all" ? `&status=${s.value}` : ""}${sp.ip ? `&ip=${sp.ip}` : ""}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              (sp.status || "all") === s.value
                ? "bg-indigo-500 text-white"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
            }`}
          >
            {s.label}
          </a>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-12 text-center">
          <Terminal className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto" />
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">No events</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Belum ada SSH events di range ini. Add server & tunggu collector polling.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Asset</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Source IP</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Method</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-2.5">
                    {e.status === "SUCCESS" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                        <XCircle className="h-3 w-3" />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {new Date(e.eventTime).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-700 dark:text-slate-300">{e.asset.hostname}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-700 dark:text-slate-300">{e.username}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-600 dark:text-slate-400">{e.sourceIp}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">{e.method || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
