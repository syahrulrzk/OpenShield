import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { AnalysisClient } from "./_components/analysis-client";

export default async function AnalysisPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <AnalysisClient />;
}
