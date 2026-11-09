import * as Y from 'yjs';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { encodeUpdate, decodeUpdate } from './documentStorage';
import type { Collaborator } from '../teams/collaborators';

export function createLiveCursors(doc: Y.Doc, text: Y.Text, model: monaco.editor.ITextModel,
  editor: monaco.editor.IStandaloneCodeEditor, publish: (anchor: string, head: string) => void) {
  let peers: Collaborator[] = [];
  const widgets = new Map<string, monaco.editor.IContentWidget>();
  const selections = editor.createDecorationsCollection();
  const refresh = () => {
    for (const widget of widgets.values()) editor.removeContentWidget(widget);
    widgets.clear();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const peer of peers) {
      if (!peer.anchor || !peer.head) continue;
      try {
        const anchor = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decodeUpdate(peer.anchor)), doc);
        const head = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(decodeUpdate(peer.head)), doc);
        if (!anchor || !head || anchor.type !== text || head.type !== text) continue;
        const start = model.getPositionAt(Math.min(anchor.index, head.index));
        const end = model.getPositionAt(Math.max(anchor.index, head.index));
        const position = model.getPositionAt(head.index);
        if (anchor.index !== head.index) decorations.push({ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { className: `collaborator-selection-${peer.colorKey}` } });
        const node = document.createElement('div');
        node.className = 'collaborator-cursor';
        node.style.borderColor = peer.color;
        node.style.height = `${editor.getOption(monaco.editor.EditorOption.lineHeight)}px`;
        const badge = document.createElement('span');
        badge.className = 'collaborator-initial'; badge.style.backgroundColor = peer.color;
        badge.textContent = peer.initial; badge.title = peer.name; badge.setAttribute('aria-label', `${peer.name}'s cursor`);
        node.appendChild(badge);
        const widget: monaco.editor.IContentWidget = { allowEditorOverflow: true, suppressMouseDown: true,
          getId: () => `collaborator-${peer.sessionId}`, getDomNode: () => node,
          getPosition: () => ({ position, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] }) };
        widgets.set(peer.sessionId, widget); editor.addContentWidget(widget);
      } catch { /* A relative position can refer to content this client has not received yet. */ }
    }
    selections.set(decorations);
  };
  const send = () => {
    const selection = editor.getSelection();
    if (!selection) return;
    const encode = (position: monaco.IPosition) => encodeUpdate(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, model.getOffsetAt(position))));
    publish(encode(selection.getSelectionStart()), encode(selection.getPosition()));
  };
  const listener = editor.onDidChangeCursorSelection(send);
  doc.on('update', refresh);
  return {
    publish: send,
    setPeers(value: Collaborator[]) { peers = value; refresh(); },
    dispose() {
      listener.dispose(); doc.off('update', refresh); selections.clear();
      for (const widget of widgets.values()) editor.removeContentWidget(widget);
      widgets.clear();
    },
  };
}
