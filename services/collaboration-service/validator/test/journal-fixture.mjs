// Real Yjs payloads for Java persistence integration tests; no hand-written CRDT encoder.
import * as Y from 'yjs';
const alice = new Y.Doc({ gc: false }), bob = new Y.Doc({ gc: false });
alice.clientID = Number(process.argv[2]);
bob.clientID = Number(process.argv[3]);
const encode = (bytes) => Buffer.from(bytes).toString('base64');
let a, b, deletion;
alice.on('update', (update) => { a = update; });
alice.getText('content').insert(0, 'Alice');
Y.applyUpdate(bob, a);
bob.on('update', (update) => { b = update; });
bob.getText('content').insert(5, ' Bob');
const mixed = Y.encodeStateAsUpdate(bob);
const bOriginal = b;
bob.on('update', (update) => { deletion = update; });
bob.getText('content').delete(0, 1);
process.stdout.write(JSON.stringify({ a: encode(a), b: encode(bOriginal), mixed: encode(mixed), deletion: encode(deletion) }));
alice.destroy(); bob.destroy();
