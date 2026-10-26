import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { ProjectRepository } from '../projects/api';

export type RepositoryFile = {
  path: string;
  name: string;
  directory: boolean;
  children: RepositoryFile[];
};

export type RepositoryInfo = {
  path: string;
  name: string;
  branch: string;
  revision: string;
  modified: boolean;
  branches: string[];
  files: RepositoryFile[];
  lastOpenedFile: string | null;
};

export type LastWorkspace = { projectId: string; teamId: string; workstreamId: string | null };

export const isDesktop = () => '__TAURI_INTERNALS__' in window;

export const selectRepository = async (projectId: string, workstreamId: string | null) => {
  const path = await open({ directory: true, multiple: false, title: 'Select a local Git repository' });
  return typeof path === 'string' ? connectRepository(projectId, workstreamId, path) : null;
};

export const selectUnlinkedRepository = async () => {
  const path = await open({ directory: true, multiple: false, title: 'Select a local Git repository' });
  if (typeof path !== 'string') return null;
  return { path, repository: await invoke<RepositoryInfo>('inspect_repository', { path }) };
};

export const connectRepository = (projectId: string, workstreamId: string | null, path: string) =>
  invoke<RepositoryInfo>('connect_repository', { projectId, workstreamId, path });

export const createWorktree = (projectId: string, workstreamId: string, branchName: string, baseRevision: string, createBranch: boolean) =>
  invoke<RepositoryInfo>('create_worktree', { projectId, workstreamId, branchName, baseRevision, createBranch });

export const restoreRepository = (projectId: string, workstreamId: string | null) =>
  invoke<RepositoryInfo | null>('restore_repository', { projectId, workstreamId });

export const readRepositoryFile = (path: string) =>
  invoke<string>('read_repository_file', { path });

export const writeRepositoryFile = (path: string, content: string) =>
  invoke<void>('write_repository_file', { path, content });

export const rememberOpenFile = (projectId: string, workstreamId: string, path: string) =>
  invoke<void>('remember_open_file', { projectId, workstreamId, path });

export const saveLastWorkspace = (projectId: string, teamId: string, workstreamId: string | null) =>
  invoke<void>('save_last_workspace', { projectId, teamId, workstreamId });

export const loadLastWorkspace = () => invoke<LastWorkspace | null>('load_last_workspace');

export const selectDownloadFolder = async () => {
  const path = await open({ directory: true, multiple: false, title: 'Choose where to download the project' });
  return typeof path === 'string' ? path : null;
};

export const downloadRepository = (configuration: ProjectRepository, parentPath: string, checkoutBranch: string, checkoutRevision: string) =>
  invoke<RepositoryInfo>('download_repository', { request: {
    projectId: configuration.projectId, parentPath, repositoryUrl: configuration.repositoryUrl,
    accessMode: configuration.accessMode, canonicalBranch: configuration.canonicalBranch,
    canonicalRevision: configuration.canonicalRevision, checkoutBranch, checkoutRevision,
  } });

export type RepositoryMetadata = { remoteUrl: string | null; branch: string; revision: string };
export const readRepositoryMetadata = (path: string) => invoke<RepositoryMetadata>('repository_metadata', { path });
