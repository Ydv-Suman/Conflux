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
  active,
  onDirtyChange,
  onSave,
}: {
  projectId: string;
  workstreamId: string;
  filePath: string;
  initialContent: string;
  theme: 'light' | 'dark';
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (content: string) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onSave, onDirtyChange });
  callbacks.current = { onSave, onDirtyChange };
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
    editorRef.current = editor;
    let savedContent = initialContent;
    const reportDirty = () => callbacks.current.onDirtyChange(model.getValue() !== savedContent);
    const contentListener = model.onDidChangeContent(reportDirty);
    const binding = new MonacoBinding(text, model, new Set([editor]));
    let hash = 2166136261;
    for (const character of filePath) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    // shortcut: readable path prefix plus hash is sufficient until document IDs are issued by Workspace Service.
    const documentId = `${filePath.replace(/[^A-Za-z0-9._-]/g, '-').slice(-80)}-${(hash >>> 0).toString(16)}`;
    const endpoint = `${COLLABORATION_WS_URL}/ws/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}/documents/${documentId}`;
    const socket = new WebSocket(endpoint);
    socket.binaryType = 'arraybuffer';
    let disposed = false;
    let seeded = false;
    const seedLocalContent = () => {
      if (disposed) return;
      if (!seeded && text.length === 0 && initialContent) text.insert(0, initialContent);
      seeded = true;
    };

    const sendUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== socket && socket.readyState === WebSocket.OPEN) socket.send(update);
    };
    doc.on('update', sendUpdate);
    socket.addEventListener('open', () => { if (!disposed) setConnection('connected'); });
    socket.addEventListener('close', () => { if (!disposed) { seedLocalContent(); setConnection('disconnected'); } });
    socket.addEventListener('error', () => { if (!disposed) { seedLocalContent(); setConnection('disconnected'); } });
    socket.addEventListener('message', (event) => {
      if (disposed || !(event.data instanceof ArrayBuffer)) return;
      if (event.data.byteLength === 0) seedLocalContent();
      else Y.applyUpdate(doc, new Uint8Array(event.data), socket);
    });
    let saving = false;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (saving) return;
      saving = true;
      const content = text.toString();
      void callbacks.current.onSave(content).then(() => { savedContent = content; if (!disposed) reportDirty(); })
        .catch(() => { /* The workspace displays the save error and keeps this tab dirty. */ })
        .finally(() => { saving = false; });
    });

    return () => {
      disposed = true;
      doc.off('update', sendUpdate);
      socket.close();
      contentListener.dispose();
      editorRef.current = null;
      binding.destroy();
      editor.dispose();
      model.dispose();
      doc.destroy();
    };
  }, [filePath, initialContent, projectId, workstreamId]);

  useEffect(() => { monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs'); }, [theme]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { editorRef.current?.layout(); editorRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <section className="collaborative-editor flex h-full min-h-0 flex-col overflow-hidden bg-[#fffefa]">
    <span className="sr-only" role="status">Collaboration {connection}</span>
    <div className="min-h-0 flex-1" ref={container} />
  </section>;
}
