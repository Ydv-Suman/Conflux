import type { Project } from '../features/projects/api';
import type { Team, TeamCapabilities, TeamInvitation } from '../features/teams/api';
import type { UserProfile } from '../features/auth/session';

export type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'repository-settings'; project: Project }
  | { kind: 'fonts' }
  | { kind: 'joined-team'; invitation: TeamInvitation }
  | { kind: 'team'; team?: Team; projectId?: string }
  | { kind: 'assign-team'; project: Project; teams: Team[] }
  | { kind: 'member'; team: Team; capabilities: TeamCapabilities }
  | { kind: 'profile'; profile: UserProfile }
  | null;
export type Confirmation = { title: string; message: string; label: string; action: () => Promise<void> } | null;
export type RequestError = { title: string; message: string; actionLabel?: string; action?: () => Promise<void> } | null;

export type Panel = 'explorer' | 'projects' | 'profile' | 'settings' | 'invitations' | null;
