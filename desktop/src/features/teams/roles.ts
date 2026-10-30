import type { UserRole } from './api';
export const roles: UserRole[] = ['ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER'];
export const roleRank: Record<UserRole, number> = { ADMIN: 0, TEAM_LEAD: 1, SENIOR_DEVELOPER: 2, DEVELOPER: 3, VIEWER: 4 };
