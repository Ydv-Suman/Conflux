import { useEffect, useReducer, useRef } from 'react';
import { CollaborativeEditor } from './CollaborativeEditor';
import { FileTabs, filePanelId, fileTabId } from './FileTabs';
import { editorTabsReducer, type EditorFile } from './editorTabs';

export function EditorWorkspace({ file, projectId, workstreamId, teamId, theme, fontSize, fontFamily, onSave, onActivate, onEmpty, onDirtyStateChange, entries, treeReady, onDirtyPathsChange }: {
  entries: { id: string; path: string }[]; treeReady: boolean; onDirtyPathsChange: (paths: string[]) => void;
  file: EditorFile; projectId: string; workstreamId: string; teamId: string; theme: 'light' | 'dark'; fontSize: number; fontFamily: string;
  onSave: (path: string, content: string, previousContent: string) => Promise<void>; onActivate: (path: string) => Promise<void>; onEmpty: () => void; onDirtyStateChange: (dirty: boolean) => void;
}) {
  const [tabs, dispatch] = useReducer(editorTabsReducer, { files: [file], activePath: file.path });
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
  return <div className="flex h-full min-h-0 flex-col">
    <FileTabs files={tabs.files} activePath={tabs.activePath} onSelect={(path) => dispatch({ type: 'select', path })} onClose={(item) => {
      if (!item.dirty || window.confirm(`Close ${item.path}? Unsaved or unsynchronized changes in this tab may be lost.`)) dispatch({ type: 'close', path: item.path });
    }} />
    <div className="min-h-0 flex-1">{tabs.files.map((item) => <div className="h-full" hidden={item.path !== tabs.activePath} role="tabpanel" id={filePanelId(item.path)} aria-labelledby={fileTabId(item.path)} key={item.documentId ?? item.path}>
      <CollaborativeEditor teamId={teamId} projectId={projectId} workstreamId={workstreamId} filePath={item.path} documentId={item.documentId} initialContent={item.content} theme={theme} fontSize={fontSize} fontFamily={fontFamily} active={item.path === tabs.activePath} onSave={(content, previousContent) => onSave(item.path, content, previousContent)} onDirtyChange={(dirty) => dispatch({ type: 'dirty', path: item.path, dirty })} onConnectionChange={(phase) => dispatch({ type: 'connection', path: item.path, phase })} />
    </div>)}</div>
  </div>;
}
