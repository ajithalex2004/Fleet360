/**
 * The signed-in user's email and name, looked up from the verified
 * x-user-id header. For records that name the person acting (who started
 * or approved a workflow): never take these from the request body.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

export interface SessionUser {
  email: string;
  name: string | undefined;
}

export async function sessionUser(headers: Headers): Promise<SessionUser | null> {
  const userId = headers.get('x-user-id');
  if (!userId) return null;
  const user = await withPlatformAdmin(prisma, (tx) => tx.user.findUnique({
    where: { id: userId }, select: { email: true, firstName: true, lastName: true },
  }));
  if (!user?.email) return null;
  return {
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
  };
}
