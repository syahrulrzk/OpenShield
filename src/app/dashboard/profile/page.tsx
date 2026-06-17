import { redirect } from "next/navigation";
import { getSession } from "@/lib/security/rbac";
import { prisma } from "@/lib/db";
import { ProfileClient } from "./_components/profile-client";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      mfaEnabled: true,
      lastLoginAt: true,
      lastLoginIp: true,
      createdAt: true,
      _count: { select: { assets: true, refreshTokens: true } },
    },
  });

  if (!user) redirect("/login");

  return (
    <ProfileClient
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        mfaEnabled: user.mfaEnabled,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lastLoginIp: user.lastLoginIp ?? null,
        createdAt: user.createdAt.toISOString(),
        assetCount: user._count.assets,
        activeSessionCount: user._count.refreshTokens,
      }}
    />
  );
}
