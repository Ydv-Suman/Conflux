import { authenticatedPost, authenticatedRequest } from '../../auth';

export type UserRole =
  | 'ADMIN'
  | 'TEAM_LEAD'
  | 'SENIOR_DEVELOPER'
  | 'DEVELOPER'
  | 'VIEWER';

export type Capability =
  | 'VIEW_PROJECT'
  | 'CREATE_PROJECT'
  | 'CREATE_WORKSTREAM'
  | 'JOIN_WORKSTREAM'
  | 'EDIT_DOCUMENT'
  | 'APPROVE_CHANGE'
  | 'MANAGE_TEAM'
  | 'MANAGE_MEMBERS'
  | 'MANAGE_ROLES'
  | 'MANAGE_PROJECT';

export type Team = {
  teamId: string;
  name: string;
  description: string | null;
  role: UserRole;
  createdAt: string;
};

export type TeamMember = {
  userId: string;
  fullName?: string;
  username: string;
  role: UserRole;
  joinedAt: string;
};

export type TeamCapabilities = {
  teamId: string;
  userId: string;
  role: UserRole;
  capabilities: Capability[];
};

export const listTeams = () => authenticatedRequest<Team[]>('/api/teams', 'GET');

export const getTeam = (teamId: string) =>
  authenticatedRequest<Team>(`/api/teams/${teamId}`, 'GET');

export const createTeam = (name: string, description: string) =>
  authenticatedPost<Team>('/api/teams', { name, description: description.trim() || null });

export const updateTeam = (teamId: string, name: string, description: string) =>
  authenticatedRequest<Team>(`/api/teams/${teamId}`, 'PUT', {
    name,
    description: description.trim() || null,
  });

export const listTeamMembers = (teamId: string) =>
  authenticatedRequest<TeamMember[]>(`/api/teams/${teamId}/members`, 'GET');

export const getMyTeamCapabilities = (teamId: string) =>
  authenticatedRequest<TeamCapabilities>(`/api/teams/${teamId}/capabilities/me`, 'GET');

export const addTeamMember = (teamId: string, email: string, role: UserRole) =>
  authenticatedPost<TeamMember>(`/api/teams/${teamId}/members`, { email, role });

export const updateTeamMemberRole = (teamId: string, userId: string, role: UserRole) =>
  authenticatedRequest<TeamMember>(`/api/teams/${teamId}/members/${userId}/role`, 'PUT', { role });

export const removeTeamMember = (teamId: string, userId: string) =>
  authenticatedRequest<void>(`/api/teams/${teamId}/members/${userId}`, 'DELETE');
