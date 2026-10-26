import { ApiError } from '../../api';
import { getDefaultWorkstream, initializeDefaultRepository, type Workstream } from './api';
import { connectRepository, createWorktree, restoreRepository, type RepositoryInfo } from '../repository/api';

export const isRepositoryReady = (stream: Workstream) =>
  stream.repositoryReady && !!stream.baseRevision && !!stream.currentRevision;

export function validateSharedRepository(stream: Workstream, repository: RepositoryInfo) {
  if (repository.branch !== stream.branchName) {
    throw new Error(`This folder is on ${repository.branch}. Open the shared branch ${stream.branchName} before collaborating.`);
  }
  if (repository.revision.toLowerCase() !== stream.currentRevision?.toLowerCase()) {
    throw new Error('This local branch differs from the shared revision. Reconcile it with the team before opening files. Your local changes have been preserved.');
  }
}

// StrictMode and repeated opens must share one local worktree operation.
const opening = new Map<string, Promise<RepositoryInfo | null>>();
export function openSharedRepository(stream: Workstream, selectedSource?: RepositoryInfo): Promise<RepositoryInfo | null> {
  if (!isRepositoryReady(stream)) return Promise.resolve(null);
  const key = `${stream.projectId}/${stream.workstreamId}/${stream.currentRevision}`;
  const pending = opening.get(key);
  if (pending) return pending;
  const operation = (async () => {
    const saved = selectedSource ? null : await restoreRepository(stream.projectId, stream.workstreamId);
    if (saved) {
      validateSharedRepository(stream, saved);
      return saved;
    }
    const source = selectedSource ?? await restoreRepository(stream.projectId, null);
    if (!source) return null;
    if (source.branch === stream.branchName) {
      validateSharedRepository(stream, source);
      return connectRepository(stream.projectId, stream.workstreamId, source.path);
    }
    const local = await createWorktree(stream.projectId, stream.workstreamId, stream.branchName,
      stream.currentRevision!, !source.branches.includes(stream.branchName));
    validateSharedRepository(stream, local);
    return local;
  })().finally(() => opening.delete(key));
  opening.set(key, operation);
  return operation;
}

export async function initializeSharedWorkspace(stream: Workstream, repository: RepositoryInfo) {
  if (repository.modified && repository.branch === stream.branchName) {
    throw new Error('This folder already uses the shared branch. Commit or stash its changes before initial setup.');
  }
  if (repository.branches.includes(stream.branchName) && repository.branch !== stream.branchName) {
    throw new Error(`Open ${stream.branchName} locally before using it to set up the shared workspace.`);
  }
  try {
    return await initializeDefaultRepository(stream.projectId, stream.teamId, stream.name, stream.branchName, repository.revision);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const current = await getDefaultWorkstream(stream.projectId, stream.teamId);
      if (isRepositoryReady(current)) return current;
    }
    throw error;
  }
}
