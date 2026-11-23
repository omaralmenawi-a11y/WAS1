import type { Role } from '@prisma/client';

export const HOME_BY_ROLE: Record<Role, string> = {
  GUARDIAN: '/parent',
  DELEGATE: '/parent',
  STAFF: '/staff',
  SCHOOL_ADMIN: '/school',
  PLATFORM_ADMIN: '/admin',
};
