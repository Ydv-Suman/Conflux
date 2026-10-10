import { authenticatedServiceRequest } from '../../auth';
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
  | 'CONFLICT';

export type Workstream = {
  workstreamId: string;
  projectId: string;
  teamId: string;
  name: string;
  branchName: string;
  baseRevision: string;
  currentRevision: string;
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

export const createWorkstream = (
  projectId: string,
  teamId: string,
  name: string,
  branchName: string,
  baseRevision: string,
) => authenticatedServiceRequest<Workstream>(
  WORKSPACE_API_URL,
  `/api/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/workstreams`,
  'POST',
  { name, branchName, baseRevision },
);
