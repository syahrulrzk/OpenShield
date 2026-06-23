"use client";

/**
 * NetworkDevicesTable — Client Component for /dashboard/network
 *
 * Renders inventory table for network devices (Cisco/MikroTik/Fortinet/generic)
 * with inline event-count badges, vendor mix, and edit/delete actions.
 *
 * Mirrors the UX pattern of database-assets-table.tsx but uses fields
 * unique to network assets: vendor, model, firmware, mgmtIp, syslogPort,
 * sshEnabled. Each row shows a "Last seen" timestamp + event count badge
 * pulled from t_event_log_network (24h rolling window).
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Network,
  Router,
  Radio,
  Shield,
  Trash2,
  Edit3,
  Plus,
  Loader2,
  Activity,
  AlertCircle,
  Clock,
  ExternalLink,
  Search,
  X,
  Power,
} from "lucide-react";
import { NetworkDeviceModal, DeleteDeviceModal } from "./network-device-modal";

export type NetworkDevice = {
  id: string;
  displayName: string;
  hostname: string;
  vendor: string | null;
  model: string | null;
  firmware: string | null;
  mgmtIp: string | null;
  syslogPort: number;
  sshEnabled: boolean;
  environment: string;
  location: string | null;
  role: string | null;
  description: string | null;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  eventCount24h: number;
  errorCount24h: number;
};

const VENDOR_META: Record<string, { label: string; color: string; icon: any }> = {
  cisco: { label: "Cisco", color: "#049fd9", icon: Router },
  mikrotik: { label: "MikroTik", color: "#293239", icon: Radio },
  fortinet: { label: "Fortinet", color: "#da291c", icon: Shield },
  generic: { label: "Generic", color: "#71717a", icon: Network },
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  ACTIVE: { label: "Active", color: "#10b981", icon: Activity },
  PENDING: { label: "Pending", color: "#f59e0b", icon: Clock },
  FAILED: { label: "Failed", color: "#ef4444", icon: AlertCircle },
  DISABLED: { label: "Disabled", color: "#52525b", icon: Power },
};

export function NetworkDevicesTable({ initialDevices }: { initialDevices: NetworkDevice[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [devices, setDevices] = useState(initialDevices);
  const [editing, setEditing] = useState<NetworkDevice | null>(null);
  const [deleting, setDeleting] = useState<NetworkDevice | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("q") || "");

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(searchParams.toString());
      if (search) sp.set("q", search);
      else sp.delete("q");
      startTransition(() => router.replace(`${pathname}?${sp.toString()}`));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const onDeleted = (id: string) => {
    setDevices((prev) => prev.filter((d) => d.id !== id));
    setDeleting(null);
  };

  const onEdited = (updated: NetworkDevice) => {
    setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    setEditing(null);
  };

  const onAdded = (device: NetworkDevice) => {
    setDevices((prev) => [device, ...prev]);
    setShowAdd(false);
  };

  const filtered = devices.filter((d) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      d.displayName.toLowerCase().includes(s) ||
      d.hostname.toLowerCase().includes(s) ||
      (d.mgmtIp ?? "").toLowerCase().includes(s) ||
      (d.vendor ?? "").toLowerCase().includes(s) ||
      (d.model ?? "").toLowerCase().includes(s) ||
      (d.location ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by name, hostname, mgmt IP, vendor, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)]/50 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 text-xs font-medium hover:bg-[var(--accent)]/25 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Device
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 backdrop-blur overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto_auto] gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--card)]/60 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
          <div>Device</div>
          <div className="hidden sm:block">Vendor / Model</div>
          <div className="hidden sm:block">Mgmt IP</div>
          <div className="hidden sm:block">Events (24h)</div>
          <div>Status</div>
          <div></div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/50 mb-3">
              <Network className="h-6 w-6 text-zinc-500" />
            </div>
            <div className="text-sm text-zinc-300">
              {search ? "No devices match the search" : "No network devices registered yet"}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
              {search
                ? "Try a different search term."
                : "Add a device to start receiving syslog from Cisco/MikroTik/Fortinet/generic equipment."}
            </div>
            {!search && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <Plus className="h-3 w-3" />
                Add first device
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/60">
            {filtered.map((d) => {
              const vendorMeta = VENDOR_META[d.vendor ?? "generic"] ?? VENDOR_META.generic;
              const statusMeta = STATUS_META[d.status] ?? STATUS_META.PENDING;
              const VIcon = vendorMeta.icon;
              const SIcon = statusMeta.icon;
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto_auto] gap-3 px-4 py-3 items-center hover:bg-[var(--card)]/60 transition-colors"
                >
                  {/* Device name + hostname */}
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/events/network?hostname=${encodeURIComponent(d.hostname)}`}
                      className="text-sm font-medium text-zinc-100 hover:text-[var(--accent)] transition-colors flex items-center gap-1.5"
                    >
                      <VIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: vendorMeta.color }} />
                      <span className="truncate">{d.displayName}</span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                    </Link>
                    <div className="text-[11px] text-zinc-500 font-mono mt-0.5 truncate">
                      {d.hostname}
                      {d.role && <span className="ml-2 text-zinc-600">· {d.role}</span>}
                      {d.location && <span className="ml-2 text-zinc-600">· {d.location}</span>}
                    </div>
                  </div>

                  {/* Vendor / Model */}
                  <div className="hidden sm:block text-xs">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: `${vendorMeta.color}22`, color: vendorMeta.color }}
                    >
                      {vendorMeta.label}
                    </span>
                    {d.model && (
                      <div className="text-[11px] text-zinc-500 mt-0.5 font-mono truncate">{d.model}</div>
                    )}
                    {d.firmware && (
                      <div className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">{d.firmware}</div>
                    )}
                  </div>

                  {/* Mgmt IP */}
                  <div className="hidden sm:block text-xs font-mono text-zinc-300">
                    {d.mgmtIp ?? <span className="text-zinc-600">—</span>}
                    {d.syslogPort !== 514 && (
                      <span className="text-zinc-600 text-[10px]">:{d.syslogPort}</span>
                    )}
                  </div>

                  {/* Events 24h */}
                  <div className="hidden sm:flex items-center gap-2 text-xs">
                    <span className="text-zinc-300 font-mono font-semibold">{d.eventCount24h}</span>
                    {d.errorCount24h > 0 && (
                      <span className="text-red-400 font-mono text-[11px]">({d.errorCount24h} err)</span>
                    )}
                  </div>

                  {/* Status */}
                  <div className="text-xs">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: `${statusMeta.color}22`, color: statusMeta.color }}
                    >
                      <SIcon className="h-3 w-3" />
                      {statusMeta.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditing(d)}
                      className="p-1.5 rounded hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Edit device"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleting(d)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors"
                      title="Delete device"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pending && (
        <div className="fixed bottom-4 right-4 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <NetworkDeviceModal
          mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={(d) => onAdded(d as NetworkDevice)}
        />
      )}
      {editing && (
        <NetworkDeviceModal
          mode="edit"
          device={editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => onEdited(d as NetworkDevice)}
        />
      )}
      {deleting && (
        <DeleteDeviceModal
          device={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => onDeleted(deleting.id)}
        />
      )}
    </div>
  );
}
