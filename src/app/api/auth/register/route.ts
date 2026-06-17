/**
 * /api/auth/register — DISABLED
 *
 * Public registration is disabled. New users must be invited by an admin
 * via Settings > Users. The first user (OWNER bootstrap) was created via
 * the CLI seed script.
 *
 * Returns 403 to keep the route discoverable in client code without leaking
 * any info about existing accounts.
 */

export async function POST() {
  return Response.json(
    {
      error:
        "Registrasi ditutup. Hubungi admin untuk invite. Akun baru dibuat dari Settings > Users.",
    },
    { status: 403 }
  );
}
