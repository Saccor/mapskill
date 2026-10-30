'use client';

import type { User as DbUser } from '@prisma/client';
import { type User } from '@/lib/schema';

export function UserCard({ user, row }: { user: User; row?: DbUser }) {
  return <div>{user.name}{row ? '!' : ''}</div>;
}
