import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { ReportsClient } from "./_components/reports-client";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <ReportsClient />;
}
