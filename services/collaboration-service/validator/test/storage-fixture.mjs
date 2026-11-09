import * as Y from 'yjs';
import { once } from 'node:events';

const [count = 250, units = 20000, alice = 10, bob = 20] = process.argv.slice(2).map(Number);
const doc = new Y.Doc({ gc: false });
const text = doc.getText('content');
let update;
doc.on('update', value => { update = value; });
try {
  for (let index = 0; index <= count; index++) {
    const writer = index % 2 ? bob : alice;
    doc.clientID = writer;
    const clock = Y.decodeStateVector(Y.encodeStateVector(doc)).get(writer) ?? 0;
    const content = index === 0 ? 'x'.repeat(units) : `\nline-${index}`;
    text.insert(text.length, content);
    const line = JSON.stringify({ writer, clock, length: content.length,
      update: Buffer.from(update).toString('base64'), snapshot: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
    if (!process.stdout.write(line + '\n')) await once(process.stdout, 'drain');
  }
} finally { doc.destroy(); }
