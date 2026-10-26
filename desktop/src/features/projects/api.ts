import { authenticatedServiceRequest } from '../auth/session';
import { WORKSPACE_API_URL } from '../../config';

export type Project = {
  projectId: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTeam = {
  teamId: string;
  name: string;
  description: string;
  addedBy: string;
  addedAt: string;
};

export type WorkstreamStatus =
  | 'CREATED'
  | 'ACTIVE'
  | 'REVIEWING'
  | 'READY_TO_MERGE'
  | 'MERGED'
  | 'BLOCKED'
  | 'CONFLICT'
  | 'ARCHIVED';

export type Workstream = {
  workstreamId: string;
  projectId: string;
  teamId: string;
  name: string;
  branchName: string;
  baseRevision: string | null;
  currentRevision: string | null;
  defaultWorkstream: boolean;
  repositoryReady: boolean;
  status: WorkstreamStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export const listProjects = () =>
  authenticatedServiceRequest<Project[]>(WORKSPACE_API_URL, '/api/projects', 'GET');

export const listProjectTeams = (projectId: string) =>
  authenticatedServiceRequest<ProjectTeam[]>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/teams`,
    'GET',
  );

export const assignProjectTeam = (projectId: string, teamId: string) =>
  authenticatedServiceRequest<ProjectTeam>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/teams`,
    'POST',
    { teamId },
  );

export const removeProjectTeam = (projectId: string, teamId: string) =>
  authenticatedServiceRequest<void>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}`,
    'DELETE',
  );

export const createProject = (name: string, description: string) =>
  authenticatedServiceRequest<Project>(WORKSPACE_API_URL, '/api/projects', 'POST', {
    name,
    description: description.trim() || null,
  });

export const updateProject = (projectId: string, name: string, description: string) =>
  authenticatedServiceRequest<Project>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}`,
    'PUT',
    { name, description: description.trim() || null },
  );

export const listWorkstreams = (projectId: string, teamId: string) =>
  authenticatedServiceRequest<Workstream[]>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/workstreams`,
    'GET',
  );

export const getDefaultWorkstream = (projectId: string, teamId: string) =>
  authenticatedServiceRequest<Workstream>(
    WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/workstreams/default`,
    'GET',
  );

export const initializeDefaultRepository = (
  projectId: string,
  teamId: string,
  name: string,
  branchName: string,
  baseRevision: string,
) => authenticatedServiceRequest<Workstream>(
  WORKSPACE_API_URL,
  `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/workstreams/default/repository`,
  'PUT',
  { name, branchName, baseRevision },
);

export type RepositoryAccessMode = 'PUBLIC' | 'HTTPS_CREDENTIAL_HELPER' | 'SSH_AGENT';
export type ProjectRepository = {
  projectId: string;
  repositoryUrl: string;
  accessMode: RepositoryAccessMode;
  canonicalBranch: string;
  canonicalRevision: string;
  version: number;
};
export const getProjectRepository = async (projectId: string): Promise<ProjectRepository | null> =>
  (await authenticatedServiceRequest<ProjectRepository | undefined>(WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/repository`, 'GET')) ?? null;

export const updateProjectRepository = (projectId: string, configuration: Omit<ProjectRepository, 'projectId' | 'version'>, expectedVersion: number) =>
  authenticatedServiceRequest<ProjectRepository>(WORKSPACE_API_URL,
    `/api/projects/${encodeURIComponent(projectId)}/repository`, 'PUT', { ...configuration, expectedVersion });

export const listTeamProjects = async (teamId: string) => {
  const projects = await listProjects();
  const matches = await Promise.all(projects.map(async (project) =>
    (await listProjectTeams(project.projectId)).some((team) => team.teamId === teamId) ? project : null));
  return matches.filter((project): project is Project => project !== null);
};
