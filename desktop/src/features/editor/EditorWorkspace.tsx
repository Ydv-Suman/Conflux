import { useEffect, useReducer, useRef, useState } from 'react';
import { FileHistory } from '../history/FileHistory';
import { CollaborativeEditor, type EditorVersionControl } from './CollaborativeEditor';
import type { VersionQueue } from '../history/versionQueue';
import { FileTabs, filePanelId, fileTabId } from './FileTabs';
import { editorTabsReducer, type EditorFile } from './editorTabs';
import type { TeamPresenceState } from '../teams/presenceConnection';

export function EditorWorkspace({ file, projectId, workstreamId, teamId, theme, fontSize, fontFamily, onSave, onActivate, onEmpty, onDirtyStateChange, entries, treeReady, onDirtyPathsChange, presence, onRetryPresence, versions }: {
  versions: VersionQueue | null;
  presence: TeamPresenceState | null; onRetryPresence: () => void;
  entries: { id: string; path: string }[]; treeReady: boolean; onDirtyPathsChange: (paths: string[]) => void;
  file: EditorFile; projectId: string; workstreamId: string; teamId: string; theme: 'light' | 'dark'; fontSize: number; fontFamily: string;
  onSave: (path: string, content: string, previousContent: string) => Promise<void>; onActivate: (path: string) => Promise<void>; onEmpty: () => void; onDirtyStateChange: (dirty: boolean) => void;
}) {
  const [tabs, dispatch] = useReducer(editorTabsReducer, { files: [file], activePath: file.path });
  const latestFiles = useRef(tabs.files); latestFiles.current = tabs.files;
  const [historyFile, setHistoryFile] = useState<EditorFile | null>(null);
  const controls = useRef(new Map<string, EditorVersionControl>());
  const locks = useRef(new Set<string>());
  const [busyPaths, setBusyPaths] = useState<string[]>([]);
  const [versionError, setVersionError] = useState('');
  const activeFile = tabs.files.find(item => item.path === tabs.activePath);
  const callbacks = useRef({ onActivate, onEmpty, onDirtyStateChange, onDirtyPathsChange });
  callbacks.current = { onActivate, onEmpty, onDirtyStateChange, onDirtyPathsChange };
  useEffect(() => { dispatch({ type: 'open', file }); }, [file]);
  useEffect(() => { if (treeReady) dispatch({ type: 'tree', entries }); }, [entries, treeReady]);
  useEffect(() => {
    if (tabs.activePath) void callbacks.current.onActivate(tabs.activePath);
    else callbacks.current.onEmpty();
  }, [tabs.activePath]);
  useEffect(() => { callbacks.current.onDirtyStateChange(tabs.files.some((item) => item.dirty)); callbacks.current.onDirtyPathsChange(tabs.files.filter((item) => item.dirty).map((item) => item.path)); }, [tabs.files]);
  useEffect(() => () => { callbacks.current.onDirtyStateChange(false); callbacks.current.onDirtyPathsChange([]); }, []);
  useEffect(() => {
    if (!tabs.files.some((item) => item.dirty)) return;
    const warnBeforeClosing = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeClosing);
    return () => window.removeEventListener('beforeunload', warnBeforeClosing);
  }, [tabs.files]);
  const closeFile = async (item: EditorFile) => {
    const id = item.documentId ?? item.path;
    if (locks.current.has(id)) return;
    locks.current.add(id); setBusyPaths(current => [...current, item.path]); setVersionError('');
    try {
      const control = controls.current.get(id);
      if (!control) throw new Error('The file is still opening. Try again in a moment.');
      await control.prepare();
      const current = latestFiles.current.find(file => (file.documentId ?? file.path) === id);
      if (current) dispatch({ type: 'close', path: current.path });
    } catch (cause) { setVersionError(cause instanceof Error ? cause.message : 'The version could not be saved. Keep this file open and retry.'); }
    finally { locks.current.delete(id); setBusyPaths(current => current.filter(path => path !== item.path)); }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <FileTabs busyPaths={busyPaths} onHistory={activeFile?.documentId ? () => setHistoryFile(activeFile) : undefined} onRetryPresence={onRetryPresence} presence={presence} files={tabs.files} activePath={tabs.activePath} onSelect={(path) => dispatch({ type: 'select', path })} onClose={item => { void closeFile(item); }} />
    {versionError && <p className="m-0 px-4 py-2 text-sm" role="alert">{versionError}</p>}
    <div className="min-h-0 flex-1">{tabs.files.map((item) => <div className="h-full" hidden={item.path !== tabs.activePath} role="tabpanel" id={filePanelId(item.path)} aria-labelledby={fileTabId(item.path)} key={item.documentId ?? item.path}>
      <CollaborativeEditor versions={versions} onVersionControl={control => { const id = item.documentId ?? item.path; if (control) controls.current.set(id, control); else controls.current.delete(id); }} teamId={teamId} projectId={projectId} workstreamId={workstreamId} filePath={item.path} documentId={item.documentId} initialContent={item.content} theme={theme} fontSize={fontSize} fontFamily={fontFamily} active={item.path === tabs.activePath} onSave={(content, previousContent) => onSave(item.path, content, previousContent)} onDirtyChange={(dirty) => dispatch({ type: 'dirty', path: item.path, dirty })} onConnectionChange={(phase) => dispatch({ type: 'connection', path: item.path, phase })} />
    </div>)}</div>
    {historyFile?.documentId && <FileHistory key={`${projectId}:${teamId}:${workstreamId}:${historyFile.documentId}`} scope={{ projectId, teamId, workstreamId }} documentId={historyFile.documentId} path={historyFile.path} theme={theme} onClose={() => setHistoryFile(null)} />}
  </div>;
}
