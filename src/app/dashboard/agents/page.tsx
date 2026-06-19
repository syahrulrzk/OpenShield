import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getSession } from "@/lib/security/rbac";
import { AgentsSection } from "./_components/agents-section";

export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Only OWNER/ADMIN can manage agents
  const canManage = session.role === "OWNER" || session.role === "ADMIN";
  if (!canManage) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link
          href="/dashboard"
          className="hover:text-[var(--foreground)] transition-colors"
        >
          OpenShield
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-[var(--foreground)] font-medium">Agents</span>
      </nav>

      {/* Page header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-[var(--muted-foreground)] max-w-2xl">
          Lightweight monitoring agents deployed ke server remote. Generate
          token dari sini, deploy via bash / python installer, dan monitor
          status real-time.
        </p>
      </header>

      <AgentsSection />
    </div>
  );
}
