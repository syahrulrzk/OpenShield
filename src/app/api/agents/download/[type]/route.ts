/**
 * /api/agents/download/[type]
 *
 * Streams a tar.gz bundle of the requested agent type (BASH | PYTHON).
 * Files are bundled from /app/agents/<type>/ inside the container.
 *
 * Auth: OWNER/ADMIN only.
 * Audit: logs `agent.bundle.downloaded`.
 *
 * Returns:
 *   200 application/gzip  — tar.gz bundle, Content-Disposition: attachment
 *   400 invalid type
 *   401 not authenticated
 *   403 not OWNER/ADMIN
 *   404 bundle files missing on server
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/security/rbac";
import { audit } from "@/lib/security/audit";

const VALID_TYPES = ["BASH", "PYTHON"] as const;
type AgentType = (typeof VALID_TYPES)[number];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { type: rawType } = await params;
  const type = rawType.toUpperCase() as AgentType;
  if (!VALID_TYPES.includes(type)) {
    return Response.json(
      { error: `Invalid agent type. Expected one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  const dir = path.join("/app/agents", type.toLowerCase());

  // Pre-check that the files exist (clearer 404 than spawning tar that fails)
  try {
    await stat(path.join(dir, type === "BASH" ? "agent.sh" : "agent.py"));
  } catch {
    return Response.json(
      { error: `Agent bundle not found on server: ${dir}` },
      { status: 404 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;

  await audit({
    userId: session.userId,
    action: "agent.bundle.downloaded",
    resourceType: "agent_bundle",
    resourceId: type,
    ip,
    userAgent: ua,
    metadata: { type, format: "tar.gz" },
  });

  const filename = `openshield-${type.toLowerCase()}-agent.tar.gz`;

  // Stream tar.gz from the agent directory.
  // tar -C /app/agents -czf - <dir>  → pipes the archive to stdout
  const tar = spawn("tar", [
    "-C",
    "/app/agents",
    "-czf",
    "-",
    type.toLowerCase(),
  ]);

  // Convert Node ReadableStream → Web ReadableStream
  const webStream = new ReadableStream({
    start(controller) {
      tar.stdout.on("data", (chunk) => controller.enqueue(chunk));
      tar.stdout.on("end", () => controller.close());
      tar.stdout.on("error", (err) => controller.error(err));
      tar.on("error", (err) => controller.error(err));
      tar.on("close", (code) => {
        if (code !== 0) controller.error(new Error(`tar exited with code ${code}`));
      });
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
