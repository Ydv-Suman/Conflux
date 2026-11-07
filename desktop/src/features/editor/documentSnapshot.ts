import * as Y from 'yjs';

export function snapshotText(snapshot: string): string {
  const doc = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(doc, Uint8Array.from(atob(snapshot), character => character.charCodeAt(0)));
    return doc.getText('content').toString();
  } finally { doc.destroy(); }
}
