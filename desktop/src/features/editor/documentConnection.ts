import * as Y from 'yjs';
import { decodeUpdate, encodeUpdate, serializeDocument, updateHash, type DocumentStorage } from './documentStorage';

export type ConnectionPhase = 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'denied' | 'error';
export type DocumentConnectionState = {
  phase: ConnectionPhase;
  ready: boolean;
  pending: boolean;
  message: string;
  persisting: boolean;
};

export function documentIdForPath(path: string) {
  let hash = 2166136261;
  for (const character of path) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Keep the existing ID mapping so persisted documents retain their history.
  return `${path.replace(/[^A-Za-z0-9._-]/g, '-').slice(-80)}-${(hash >>> 0).toString(16)}`;
}

export function connectDocument({ doc, endpoint, teamId, initialContent, getToken, onState, storage }: {
  doc: Y.Doc;
  endpoint: string;
  teamId: string;
  initialContent: string;
  getToken: (rejectedToken?: string) => Promise<string>;
  onState: (state: DocumentConnectionState) => void;
  storage: DocumentStorage;
}) {
  const remote = {}, restore = {};
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let receiptTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, retryCount = 0, writes = 0;
  let disposed = false, ready = false, seeded = false, loaded = false, refreshed = false, storageFailed = false;
  let storedReady = false;
  let snapshot = encodeUpdate(Y.encodeStateAsUpdate(doc));
  const outbox = new Map<string, string>();
  let inFlight: string | undefined;
  let phase: ConnectionPhase = 'connecting';
  let message = '';
  const report = (next = phase, detail = message) => {
    phase = next; message = detail;
    if (!disposed) onState({ phase, ready, pending: outbox.size > 0 || writes > 0 || storageFailed, persisting: writes > 0, message });
  };
  const stopSocket = () => {
    generation++;
    clearTimeout(retryTimer); clearTimeout(handshakeTimer); clearTimeout(receiptTimer);
    inFlight = undefined;
    const previous = socket; socket = undefined; previous?.close();
  };
  const fail = (detail: string) => { stopSocket(); report('error', detail); };
  const save = () => storage.save({ version: 1, snapshot, pending: [...outbox.values()], ready: storedReady });
  const queue = (action: () => Promise<void>) => {
    writes++; report();
    const task = serializeDocument(storage, action).catch(() => {
      storageFailed = true;
      fail('Document recovery could not be saved on this device. Keep this tab open, save the text locally, and retry.');
    }).finally(() => { writes--; report(); });
    return task;
  };
  const send = (hash: string, bytes: Uint8Array) => {
    if (disposed || storageFailed || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (bytes.byteLength > 2 * 1024 * 1024) {
      fail('This document exceeds the collaboration message limit. Save your text locally before closing.'); return;
    }
    if (socket.bufferedAmount + bytes.byteLength > 4 * 1024 * 1024) { socket.close(); return; }
    try {
      inFlight = hash;
      socket.send(bytes);
      clearTimeout(receiptTimer);
      // Lost receipts (including an older server) must never be reported as Saved.
      receiptTimer = setTimeout(() => { socket?.close(); }, 15000);
    } catch { socket.close(); }
  };
  const pump = () => {
    if (phase !== 'connected' || inFlight || disposed || storageFailed) return;
    const next = outbox.entries().next().value as [string, string] | undefined;
    if (next) send(next[0], decodeUpdate(next[1]));
  };
  const record = (update?: Uint8Array, initialize = false) => {
    const captured = encodeUpdate(Y.encodeStateAsUpdate(doc));
    const bytes = update && Uint8Array.from(update);
    const attempt = generation;
    return queue(async () => {
      snapshot = captured;
      const hash = bytes && await updateHash(bytes);
      if (hash) outbox.set(hash, encodeUpdate(bytes!));
      await save();
      if (initialize && hash && attempt === generation) send(hash, bytes!);
      else pump();
    });
  };
  const changed = (update: Uint8Array, origin: unknown) => {
    if (disposed || origin === restore) return;
    void record(origin === remote ? undefined : update);
  };
  doc.on('update', changed);

  const connect = async (rejectedToken?: string) => {
    stopSocket();
    const attempt = generation;
    report(ready ? 'reconnecting' : 'connecting', '');
    let token: string;
    try { token = await getToken(rejectedToken); }
    catch {
      if (!disposed && attempt === generation) report('denied', 'Sign in again to reconnect. Your document is preserved.');
      return;
    }
    if (disposed || attempt !== generation) return;
    let current: WebSocket;
    try { current = new WebSocket(endpoint); }
    catch { fail('Unable to open the collaboration connection. Check the service address and retry.'); return; }
    socket = current;
    current.binaryType = 'arraybuffer';
    let receivedHistory = false, initializing = false, replayComplete = false;
    const active = () => !disposed && socket === current && attempt === generation;
    handshakeTimer = setTimeout(() => { if (active()) current.close(); }, 30000);
    current.addEventListener('open', () => {
      if (!active()) return;
      report('syncing', '');
      try { current.send(JSON.stringify({ teamId, token, acknowledgements: true })); }
      catch { current.close(); }
    });
    current.addEventListener('message', (event) => {
      if (!active()) return;
      try {
        if (event.data instanceof ArrayBuffer && event.data.byteLength === 0) {
          fail('Collaboration Service is running the old protocol. Restart the updated backend, then click Retry.'); return;
        }
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          receivedHistory = true; seeded = true;
          Y.applyUpdate(doc, new Uint8Array(event.data), remote);
          return;
        }
        if (typeof event.data !== 'string') throw new Error('Unexpected message');
        const control = JSON.parse(event.data) as { type?: string; sha256?: string; sequence?: number } | null;
        if (control?.type === 'initialize' && phase === 'syncing' && !initializing && !receivedHistory) {
          initializing = true;
          if (!seeded && !ready) {
            seeded = true;
            doc.transact(() => { if (initialContent) doc.getText('content').insert(0, initialContent); }, restore);
          }
          void record(Y.encodeStateAsUpdate(doc), true);
        } else if (control?.type === 'synced' && phase === 'syncing' && !replayComplete) {
          replayComplete = true;
          clearTimeout(handshakeTimer);
          void queue(async () => {
            storedReady = true;
            await save();
            if (!active()) return;
            ready = true; seeded = true; retryCount = 0; refreshed = false;
            report('connected', ''); pump();
          });
        } else if (control?.type === 'ack' && typeof control.sha256 === 'string'
            && /^[a-f0-9]{64}$/.test(control.sha256) && Number.isSafeInteger(control.sequence) && control.sequence! > 0) {
          const hash = control.sha256;
          void queue(async () => {
            // Unknown/duplicate receipts cannot clear other pending edits.
            if (!outbox.has(hash)) return;
            outbox.delete(hash);
            await save();
            if (!active()) return;
            if (inFlight === hash) { inFlight = undefined; clearTimeout(receiptTimer); }
            pump();
          });
        } else throw new Error('Unexpected control message');
      } catch {
        fail('The shared document could not be synchronized. Save any recovered text locally before retrying.');
      }
    });
    current.addEventListener('error', () => { if (active()) current.close(); });
    current.addEventListener('close', (event) => {
      if (!active()) return;
      clearTimeout(handshakeTimer); clearTimeout(receiptTimer);
      socket = undefined; inFlight = undefined;
      if (event.code === 4403 || (event.code === 4401 && refreshed)) {
        report('denied', event.code === 4403 ? 'Team editing access is unavailable. Check your membership before retrying.'
          : 'Your session could not be renewed. Sign in again to reconnect.'); return;
      }
      if (event.code === 1008 || event.code === 1009) {
        report('error', event.code === 1009 ? 'The document exceeds the collaboration message limit.'
          : 'The collaboration server rejected this session. Retry after checking the workspace.'); return;
      }
      const rejected = event.code === 4401 ? token : undefined;
      if (rejected) refreshed = true;
      report('reconnecting', '');
      retryTimer = setTimeout(() => { void connect(rejected); }, Math.min(500 * 2 ** retryCount++, 10000));
    });
  };
  const start = async () => {
    await queue(async () => {
      const value = await storage.load();
      if (disposed) return;
      if (value) {
        if (value.version !== 1 || typeof value.snapshot !== 'string' || !Array.isArray(value.pending)
            || !value.pending.every((item) => typeof item === 'string') || typeof value.ready !== 'boolean') throw new Error('Invalid recovery state');
        Y.applyUpdate(doc, decodeUpdate(value.snapshot), restore);
        for (const encoded of value.pending) {
          const bytes = decodeUpdate(encoded);
          Y.applyUpdate(doc, bytes, restore);
          outbox.set(await updateHash(bytes), encoded);
        }
        snapshot = encodeUpdate(Y.encodeStateAsUpdate(doc));
        storedReady = value.ready; ready = value.ready; seeded = true;
      }
      loaded = true; storageFailed = false;
    });
    if (!disposed && loaded && !storageFailed) void connect();
  };
  void start();
  return {
    retry() {
      if (disposed) return;
      refreshed = false; retryCount = 0;
      if (!loaded) { void start(); return; }
      void queue(async () => { await save(); storageFailed = false; }).then(() => {
        if (!disposed && !storageFailed) void connect();
      });
    },
    dispose() { disposed = true; stopSocket(); doc.off('update', changed); },
  };
}
