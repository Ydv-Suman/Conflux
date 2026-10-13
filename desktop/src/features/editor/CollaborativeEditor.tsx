import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
// Vite resolves the worker query suffix; eslint-plugin-import does not.
// eslint-disable-next-line import/no-unresolved
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import { COLLABORATION_WS_URL } from '../../config';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export function CollaborativeEditor({
  projectId,
  workstreamId,
  filePath,
  initialContent,
  theme,
  onClose,
  onSave,
}: {
  projectId: string;
  workstreamId: string;
  filePath: string;
  initialContent: string;
  theme: 'light' | 'dark';
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!container.current) return;

    const doc = new Y.Doc();
    const text = doc.getText('content');
    const extension = filePath.split('.').pop()?.toLowerCase();
    const language = extension === 'ts' || extension === 'tsx' ? 'typescript' : extension === 'js' || extension === 'jsx' ? 'javascript' : extension === 'json' ? 'json' : 'plaintext';
    const model = monaco.editor.createModel('', language);
    const editor = monaco.editor.create(container.current, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      padding: { top: 16 },
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
    });
    const binding = new MonacoBinding(text, model, new Set([editor]));
    let hash = 2166136261;
    for (const character of filePath) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    // shortcut: readable path prefix plus hash is sufficient until document IDs are issued by Workspace Service.
    const documentId = `${filePath.replace(/[^A-Za-z0-9._-]/g, '-').slice(-80)}-${(hash >>> 0).toString(16)}`;
    const endpoint = `${COLLABORATION_WS_URL}/ws/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}/documents/${documentId}`;
    const socket = new WebSocket(endpoint);
    socket.binaryType = 'arraybuffer';
    let seeded = false;
    const seedLocalContent = () => {
      if (!seeded && text.length === 0 && initialContent) text.insert(0, initialContent);
      seeded = true;
    };

    const sendUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket && socket.readyState === WebSocket.OPEN) socket.send(update);
    };
    doc.on('update', sendUpdate);
    socket.addEventListener('open', () => setConnection('connected'));
    socket.addEventListener('close', () => { seedLocalContent(); setConnection('disconnected'); });
    socket.addEventListener('error', () => { seedLocalContent(); setConnection('disconnected'); });
    socket.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      if (event.data.byteLength === 0) seedLocalContent();
      else Y.applyUpdate(doc, new Uint8Array(event.data), socket);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void onSave(text.toString()));

    return () => {
      doc.off('update', sendUpdate);
      socket.close();
      binding.destroy();
      editor.dispose();
      model.dispose();
      doc.destroy();
    };
  }, [filePath, initialContent, onSave, projectId, workstreamId, theme]);

  return <section className="collaborative-editor flex h-full min-h-0 flex-col overflow-hidden bg-[#fffefa]">
    <header className="flex h-11 shrink-0 items-stretch justify-between border-b border-[#d8d6ce]">
      <div className="editor-tabs flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Open files">
        <div className="editor-tab flex shrink-0 items-center gap-3 border-r border-[#d8d6ce] px-4" role="tab" aria-selected="true">
          <strong className="font-mono text-xs font-medium">{filePath.split('/').pop()}</strong>
          <button className="editor-close" type="button" aria-label={`Close ${filePath}`} title={`Close ${filePath}`} onClick={onClose}>×</button>
        </div>
      </div>
      <div className="grid shrink-0 place-items-center px-4">
        <span className={`connection-dot connection-dot-${connection}`} role="status" aria-label={`Collaboration ${connection}`} title={`Collaboration ${connection}`} />
      </div>
    </header>
    <div className="min-h-0 flex-1" ref={container} />
  </section>;
}
