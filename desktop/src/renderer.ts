import * as Y from 'yjs';
import './index.css';

const editor = document.querySelector<HTMLTextAreaElement>('#editor');
const status = document.querySelector<HTMLElement>('#status');
const statusDot = document.querySelector<HTMLElement>('#status-dot');
const openWindow = document.querySelector<HTMLButtonElement>('#open-window');

if (!editor || !status || !statusDot || !openWindow) {
  throw new Error('Editor UI is missing');
}

const doc = new Y.Doc();
const text = doc.getText('shared-document');
const remoteUpdate = Symbol('remote-update');
const setStatus = (state: 'connected' | 'error', message: string) => {
  status.dataset.state = state;
  statusDot.classList.remove('animate-pulse', 'bg-[#b58b51]', 'bg-[#4c8067]', 'bg-[#ad5b50]');
  statusDot.classList.add(state === 'connected' ? 'bg-[#4c8067]' : 'bg-[#ad5b50]');
  const label = status.lastElementChild;
  if (label) label.textContent = message;
};

const renderText = () => {
  const value = text.toString();
  if (editor.value === value) return;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value = value;
  editor.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
};

text.observe(renderText);
doc.on('update', (update, origin) => {
  if (origin !== remoteUpdate) window.conflux.sendDocumentUpdate(update);
});

editor.addEventListener('input', () => {
  doc.transact(() => {
    text.delete(0, text.length);
    text.insert(0, editor.value);
  });
});

openWindow.addEventListener('click', window.conflux.openSecondWindow);

window.conflux.onDocumentUpdate((update) => {
  Y.applyUpdate(doc, update, remoteUpdate);
  setStatus('connected', 'Synced');
});

window.conflux
  .getDocumentState()
  .then((state) => {
    Y.applyUpdate(doc, state, remoteUpdate);
    renderText();
    editor.disabled = false;
    editor.focus();
    setStatus('connected', 'Synced');
  })
  .catch(() => {
    setStatus('error', 'Unable to connect');
  });
