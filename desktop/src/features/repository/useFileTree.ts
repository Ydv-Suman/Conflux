import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { COLLABORATION_WS_URL } from '../../config';
import { getCollaborationToken, getCurrentUser } from '../auth/session';
import { baseline, explorerTree, type DiskEntry, type TreeCommand, type TreeEntry, type TreeState } from './fileTree';
import { connectTree, type TreeStatus } from './treeConnection';
import { isDesktop, type RepositoryFile } from './api';

export function useFileTree(scope: { root?: string; projectId?: string; workstreamId?: string; teamId?: string; revision?: string | null }, callbacks: {
  dirtyPaths: () => string[];
  onTree: (files: RepositoryFile[], entries: TreeEntry[], command?: TreeCommand) => void;
}) {
  const [status, setStatus] = useState<TreeStatus>({ phase: 'connecting', message: '' });
  const [manifestReady, setManifestReady] = useState(false);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const connection = useRef<ReturnType<typeof connectTree> | null>(null);
  const latest = useRef(callbacks); latest.current = callbacks;
  const { root, projectId, workstreamId, teamId, revision } = scope;
  useEffect(() => {
    setManifestReady(false); setEntries([]); setStatus({ phase: 'connecting', message: '' });
    if (!isDesktop() || !root || !projectId || !workstreamId || !teamId || !revision) return;
    let disposed = false;
    const key = `${getCurrentUser()?.id}/${projectId}/${workstreamId}`;
    const controller = connectTree({
      endpoint: `${COLLABORATION_WS_URL}/ws/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}/files`,
      teamId, getToken: getCollaborationToken, dirtyPaths: () => latest.current.dirtyPaths(),
      onStatus: (value) => { if (!disposed) setStatus(value); },
      onTree: (manifest, disk, command) => {
        if (disposed) return;
        setManifestReady(true); setEntries(manifest); latest.current.onTree(explorerTree(disk), manifest, command);
      },
      bridge: {
        load: async () => { const saved = await invoke<string | null>('file_tree_load', { root, scope: key }); return saved ? JSON.parse(saved) as TreeState : null; },
        save: (value) => invoke('file_tree_save', { root, scope: key, value: JSON.stringify(value) }),
        snapshot: () => invoke<DiskEntry[]>('file_tree_snapshot', { root }),
        baseline: async () => baseline(await invoke<string[]>('file_tree_baseline', { root, revision })),
        content: (path) => invoke<string>('file_tree_content', { root, path }),
        apply: (command, previous) => invoke('file_tree_apply', { root, change: {
          operationId: command.operationId, kind: command.type === 'CREATE' ? command.entry!.kind : command.type,
          path: command.entry?.path ?? command.path, targetPath: command.targetPath, content: command.content, fingerprint: previous?.fingerprint, identity: previous?.identity,
        } }),
      },
    });
    connection.current = controller;
    return () => { disposed = true; controller.dispose(); connection.current = null; };
  }, [root, projectId, workstreamId, teamId, revision]);
  return { status, entries, manifestReady, retry: () => connection.current?.retry(), reconcile: () => connection.current?.reconcile(), edit: async (command: TreeCommand) => { if (!connection.current) throw new Error('Open a shared workspace first.'); await connection.current.edit(command); } };
}
