import { documentIdForPath } from '../editor/documentConnection';
import type { RepositoryFile } from './api';

export type TreeEntry = { id: string; path: string; kind: 'FILE' | 'DIRECTORY' };
export type DiskEntry = Omit<TreeEntry, 'id'> & { identity: string; fingerprint: string };
export type TreeCommand = { operationId: string; expectedVersion: number; type: 'INITIALIZE' | 'CREATE' | 'RENAME' | 'DELETE'; entries?: TreeEntry[]; entry?: TreeEntry; path?: string; targetPath?: string; content?: string };
export type TreeState = { version: number; entries: TreeEntry[]; observed: DiskEntry[]; pending?: TreeCommand };
export const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);

export function baseline(paths: string[]): TreeEntry[] {
  const entries = new Map<string, TreeEntry>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const name = parts.slice(0, index).join('/');
      entries.set(name, { id: documentIdForPath(name), path: name, kind: index === parts.length ? 'FILE' : 'DIRECTORY' });
    }
  }
  return [...entries.values()];
}

export function applyManifest(entries: TreeEntry[], command: TreeCommand): TreeEntry[] {
  switch (command.type) {
    case 'INITIALIZE': return command.entries!;
    case 'CREATE': return [...entries, command.entry!];
    case 'DELETE': return entries.filter((entry) => !within(entry.path, command.path!));
    case 'RENAME': return entries.map((entry) => within(entry.path, command.path!) ? { ...entry, path: command.targetPath! + entry.path.slice(command.path!.length) } : entry);
  }
}

// One operation at a time: parent moves/deletes precede children, and new parents
// precede their contents. Native identities distinguish moves from replacements.
export function nextChange(state: TreeState, disk: DiskEntry[], uuid: () => string = () => crypto.randomUUID()): TreeCommand | null {
  const byPath = new Map(disk.map((entry) => [entry.path, entry]));
  const shared = new Map(state.entries.map((entry) => [entry.path, entry]));
  const old = new Map(state.observed.map((entry) => [entry.path, entry]));
  const base = () => ({ operationId: uuid(), expectedVersion: state.version });
  const missing = state.entries.filter((entry) => !byPath.has(entry.path)).sort((a, b) => a.path.length - b.path.length);
  for (const entry of missing) {
    const previous = old.get(entry.path);
    const matches = previous?.identity ? disk.filter((item) => item.identity === previous.identity && item.kind === entry.kind && !shared.has(item.path)) : [];
    if (matches.length === 1) {
      const target = matches[0].path;
      const parent = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : null;
      if (!parent || shared.has(parent)) return { ...base(), type: 'RENAME', path: entry.path, targetPath: target };
      // Create a newly introduced destination parent before moving its child.
      const directory = disk.filter((item) => item.kind === 'DIRECTORY' && within(target, item.path) && !shared.has(item.path)).sort((a, b) => a.path.length - b.path.length)[0];
      if (directory) return { ...base(), type: 'CREATE', entry: { id: uuid(), path: directory.path, kind: 'DIRECTORY' } };
    }
  }
  if (missing.length) return { ...base(), type: 'DELETE', path: missing[0].path };
  for (const entry of [...disk].sort((a, b) => a.path.length - b.path.length)) {
    const existing = shared.get(entry.path);
    if (existing && existing.kind !== entry.kind) return { ...base(), type: 'DELETE', path: entry.path };
    if (!existing) return { ...base(), type: 'CREATE', entry: { id: uuid(), path: entry.path, kind: entry.kind } };
  }
  return null;
}

export function explorerTree(disk: Pick<DiskEntry, 'path' | 'kind'>[]): RepositoryFile[] {
  const entries = new Map<string, RepositoryFile>(disk.map((entry) => [entry.path, { path: entry.path, name: entry.path.split('/').pop()!, directory: entry.kind === 'DIRECTORY', children: [] as RepositoryFile[] }]));
  const roots: RepositoryFile[] = [];
  for (const entry of entries.values()) {
    const parent = entry.path.includes('/') ? entries.get(entry.path.slice(0, entry.path.lastIndexOf('/'))) : null;
    (parent?.children ?? roots).push(entry);
  }
  const sort = (items: RepositoryFile[]) => { items.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)); items.forEach((item) => sort(item.children)); };
  sort(roots); return roots;
}
