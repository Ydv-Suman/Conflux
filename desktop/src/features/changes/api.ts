import { invoke } from '@tauri-apps/api/core';
export type GitChange = { path: string; originalPath: string | null; indexStatus: string; worktreeStatus: string };
export type GitChanges = { branch: string; revision: string | null; files: GitChange[] };
export type GitDiff = { before: string; after: string };
export const getChanges = (root: string) => invoke<GitChanges>('repository_changes', { root });
export const getFileDiff = (root: string, path: string, revision: string | null) =>
  invoke<GitDiff>('repository_file_diff', { root, path, revision });
const names: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict', '?': 'Untracked' };
export function changeLabel(file: GitChange) {
  const code = file.indexStatus + file.worktreeStatus;
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'Conflict';
  if (code === '??') return 'Untracked';
  return [file.indexStatus !== ' ' && `Staged: ${names[file.indexStatus] ?? file.indexStatus}`,
    file.worktreeStatus !== ' ' && `Unstaged: ${names[file.worktreeStatus] ?? file.worktreeStatus}`].filter(Boolean).join(' · ');
}
