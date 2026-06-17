import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { DashboardShell } from "./_components/dashboard-shell";
import { PageTransition } from "@/components/animations";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardShell user={{ email: session.email, role: session.role }}>
      <PageTransition>{children}</PageTransition>
    </DashboardShell>
  );
}
