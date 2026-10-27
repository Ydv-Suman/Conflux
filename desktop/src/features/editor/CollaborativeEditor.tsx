import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
// Vite resolves the worker query suffix; eslint-plugin-import does not.
// eslint-disable-next-line import/no-unresolved
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import { COLLABORATION_WS_URL } from '../../config';
import { getCollaborationToken } from '../auth/session';
import { connectDocument, documentIdForPath, type ConnectionPhase, type DocumentConnectionState } from './documentConnection';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export function CollaborativeEditor({
  projectId,
  workstreamId,
  teamId,
  filePath,
  initialContent,
  theme,
  fontSize,
  fontFamily,
  active,
  onDirtyChange,
  onConnectionChange,
  onSave,
}: {
  projectId: string;
  workstreamId: string;
  teamId: string;
  filePath: string;
  initialContent: string;
  theme: 'light' | 'dark';
  fontSize: number;
  fontFamily: string;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onConnectionChange: (phase: ConnectionPhase) => void;
  onSave: (content: string) => Promise<void>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onSave, onDirtyChange, onConnectionChange });
  callbacks.current = { onSave, onDirtyChange, onConnectionChange };
  const [connection, setConnection] = useState<DocumentConnectionState>({ phase: 'connecting', ready: false, pending: false, message: '' });
  const connectionRef = useRef<ReturnType<typeof connectDocument> | null>(null);
  const saveRef = useRef<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!container.current) return;

    const doc = new Y.Doc();
    const text = doc.getText('content');
    const extension = filePath.split('.').pop()?.toLowerCase();
    const language = extension === 'ts' || extension === 'tsx' ? 'typescript' : extension === 'js' || extension === 'jsx' ? 'javascript' : extension === 'json' ? 'json' : 'plaintext';
    const model = monaco.editor.createModel('', language);
    const editor = monaco.editor.create(container.current, {
      model,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize,
      fontFamily,
      padding: { top: 16 },
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
    });
    editorRef.current = editor;
    let savedContent = initialContent;
    let safeToSave = false;
    let pending = false;
    const reportDirty = () => callbacks.current.onDirtyChange(pending || (safeToSave && model.getValue() !== savedContent));
    const contentListener = model.onDidChangeContent(reportDirty);
    const binding = new MonacoBinding(text, model, new Set([editor]));
    const documentId = documentIdForPath(filePath);
    const endpoint = `${COLLABORATION_WS_URL}/ws/projects/${encodeURIComponent(projectId)}/workstreams/${encodeURIComponent(workstreamId)}/documents/${documentId}`;
    let disposed = false;
    const connection = connectDocument({ doc, endpoint, teamId, initialContent, getToken: getCollaborationToken,
      onState: (state) => {
        if (disposed) return;
        safeToSave = state.ready;
        pending = state.pending;
        editor.updateOptions({ readOnly: !state.ready || state.phase === 'denied' || state.phase === 'error' });
        setConnection(state);
        callbacks.current.onConnectionChange(state.phase);
        reportDirty();
      },
    });
    connectionRef.current = connection;
    let savingLocally = false;
    const save = () => {
      if (savingLocally || !safeToSave) return;
      savingLocally = true;
      setSaving(true);
      const content = text.toString();
      void callbacks.current.onSave(content).then(() => { savedContent = content; if (!disposed) reportDirty(); })
        .catch(() => { /* The workspace displays the save error and keeps this tab dirty. */ })
        .finally(() => { savingLocally = false; if (!disposed) setSaving(false); });
    };
    saveRef.current = save;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

    return () => {
      disposed = true;
      connection.dispose();
      connectionRef.current = null;
      saveRef.current = null;
      contentListener.dispose();
      editorRef.current = null;
      binding.destroy();
      editor.dispose();
      model.dispose();
      doc.destroy();
    };
  }, [filePath, initialContent, projectId, workstreamId, teamId]);

  useEffect(() => { monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs'); }, [theme]);
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, fontFamily });
    let disposed = false;
    // Refresh character widths after a bundled font replaces the initial fallback.
    void document.fonts.load(`${fontSize}px ${fontFamily}`).then(() => {
      if (!disposed) monaco.editor.remeasureFonts();
    }).catch(() => { /* Keep the system fallback if a font cannot load. */ });
    return () => { disposed = true; };
  }, [fontSize, fontFamily]);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => { editorRef.current?.layout(); editorRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <section className="collaborative-editor flex h-full min-h-0 flex-col overflow-hidden bg-[#fffefa]">
    {connection.phase !== 'connected' && <div className="collaboration-status">
      <span role="status">{connection.message || (connection.phase === 'syncing' ? 'Synchronizing shared document…' : connection.phase === 'connecting' ? 'Connecting to collaboration…' : 'Reconnecting… Keep this tab open to preserve pending edits.')}</span>
      <div className="collaboration-actions">
        {connection.ready && <button type="button" disabled={saving} onClick={() => saveRef.current?.()}>{saving ? 'Saving…' : 'Save locally'}</button>}
        {['reconnecting', 'denied', 'error'].includes(connection.phase) && <button type="button" onClick={() => connectionRef.current?.retry()}>Retry</button>}
      </div>
    </div>}
    <div className="min-h-0 flex-1" ref={container} />
  </section>;
}
