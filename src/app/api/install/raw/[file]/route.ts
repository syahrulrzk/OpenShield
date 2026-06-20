/**
 * /api/install/raw/[file]
 *
 * Serves raw agent source files (agent.sh, agent.py) for the quick installer.
 * No auth required — these are public read-only static agent binaries.
 * The actual auth is the agent_id+token in the installer's URL.
 *
 * Files are served from $OPENSHIELD_AGENTS_DIR/<type>/ (default: /app/agents
 * for Docker, ../../agents for dev mode relative to project root).
 */

import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * agent.sh removed 2026-06-20 — bash agent deprecated (pipe_read hang).
 * Only Python agent is supported now.
 */
const VALID_FILES = {
  "agent.py": { dir: "python", contentType: "text/x-python; charset=utf-8" },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const meta = VALID_FILES[file as keyof typeof VALID_FILES];
  if (!meta) {
    return Response.json(
      { error: `Invalid file. Expected: ${Object.keys(VALID_FILES).join(", ")}` },
      { status: 400 },
    );
  }

  // Resolve agent base dir: env override → /app/agents (Docker) → cwd/agents (dev)
  const baseDir =
    process.env.OPENSHIELD_AGENTS_DIR ||
    (await pathExists("/app/agents") ? "/app/agents" : path.join(process.cwd(), "agents"));
  const filePath = path.join(baseDir, meta.dir, file);
  try {
    await stat(filePath);
  } catch {
    return Response.json({ error: `Agent source not found: ${filePath}` }, { status: 404 });
  }

  // Stream the file (small — read into memory is fine)
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf-8");

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Disposition": `inline; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
