import { useEffect, useReducer, useRef } from 'react';
import { CollaborativeEditor } from './CollaborativeEditor';
import { FileTabs, filePanelId, fileTabId } from './FileTabs';
import { editorTabsReducer, type EditorFile } from './editorTabs';

export function EditorWorkspace({ file, projectId, workstreamId, theme, onSave, onActivate, onEmpty }: {
  file: EditorFile; projectId: string; workstreamId: string; theme: 'light' | 'dark';
  onSave: (path: string, content: string) => Promise<void>; onActivate: (path: string) => Promise<void>; onEmpty: () => void;
}) {
  const [tabs, dispatch] = useReducer(editorTabsReducer, { files: [file], activePath: file.path });
  const callbacks = useRef({ onActivate, onEmpty });
  callbacks.current = { onActivate, onEmpty };
  useEffect(() => { dispatch({ type: 'open', file }); }, [file]);
  useEffect(() => {
    if (tabs.activePath) void callbacks.current.onActivate(tabs.activePath);
    else callbacks.current.onEmpty();
  }, [tabs.activePath]);
  return <div className="flex h-full min-h-0 flex-col">
    <FileTabs files={tabs.files} activePath={tabs.activePath} onSelect={(path) => dispatch({ type: 'select', path })} onClose={(item) => {
      if (!item.dirty || window.confirm(`Close ${item.path} without saving to disk?`)) dispatch({ type: 'close', path: item.path });
    }} />
    <div className="min-h-0 flex-1">{tabs.files.map((item) => <div className="h-full" hidden={item.path !== tabs.activePath} role="tabpanel" id={filePanelId(item.path)} aria-labelledby={fileTabId(item.path)} key={item.path}>
      <CollaborativeEditor projectId={projectId} workstreamId={workstreamId} filePath={item.path} initialContent={item.content} theme={theme} active={item.path === tabs.activePath} onSave={(content) => onSave(item.path, content)} onDirtyChange={(dirty) => dispatch({ type: 'dirty', path: item.path, dirty })} />
    </div>)}</div>
  </div>;
}
