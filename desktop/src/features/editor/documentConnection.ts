import * as Y from 'yjs';
import { decodeUpdate, encodeUpdate, serializeDocument, updateHash, type PendingEdit, type DocumentStorage } from './documentStorage';

export type ConnectionPhase = 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'denied' | 'error';
export type DocumentConnectionState = {
  phase: ConnectionPhase;
  ready: boolean;
  pending: boolean;
  message: string;
  persisting: boolean;
  writable?: boolean;
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
  doc.gc = false;
  const remote = {}, restore = {};
  const registrationId = crypto.randomUUID();
  // Large initial files retain legacy editing until attribution supports their size.
  let protocol: 1 | 2 = initialContent.length <= 100_000 ? 2 : 1;
  let selected = false, requiresV2 = false, upgradingLegacy = false;
  let writerId: number | undefined;
  const edits = new Map<string, PendingEdit>();
  const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
    if (!disposed) onState({ phase, ready, pending: outbox.size > 0 || edits.size > 0 || writes > 0 || storageFailed, persisting: writes > 0, message,
      writable: ready && phase !== 'denied' && phase !== 'error' && ((protocol === 1 && !upgradingLegacy) || (writerId !== undefined && phase !== 'connecting' && phase !== 'syncing')) });
  };
  const stopSocket = () => {
    generation++;
    clearTimeout(retryTimer); clearTimeout(handshakeTimer); clearTimeout(receiptTimer);
    inFlight = undefined;
    const previous = socket; socket = undefined; previous?.close();
  };
  const fail = (detail: string) => { stopSocket(); report('error', detail); };
  const save = () => storage.save(protocol === 2
    ? { version: 2, snapshot, pending: [...edits.values()], ready: storedReady, writerId, registrationId }
    : { version: 1, snapshot, pending: [...outbox.values()], ready: storedReady });
  const legacy = () => {
    if (requiresV2 || edits.size) throw new Error('Attributed recovery requires protocol 2');
    protocol = 1; selected = true;
  };
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
  const sendEdit = (edit: PendingEdit) => {
    if (disposed || storageFailed || !socket || socket.readyState !== WebSocket.OPEN) return;
    const frame = JSON.stringify({ type: edit.kind, operationId: edit.operationId, writerId: edit.writerId, update: edit.update });
    if (frame.length > 2 * 1024 * 1024) { fail('This document exceeds the collaboration message limit. Save your text locally before closing.'); return; }
    if (socket.bufferedAmount + frame.length > 4 * 1024 * 1024) { socket.close(); return; }
    try {
      inFlight = edit.operationId;
      socket.send(frame);
      clearTimeout(receiptTimer);
      receiptTimer = setTimeout(() => { socket?.close(); }, 15000);
    } catch { socket.close(); }
  };
  const pump = () => {
    if (phase !== 'connected' || inFlight || disposed || storageFailed) return;
    if (protocol === 2) {
      const next = edits.values().next().value;
      if (next) sendEdit(next);
      return;
    }
    const next = outbox.entries().next().value as [string, string] | undefined;
    if (next) send(next[0], decodeUpdate(next[1]));
  };
  const record = (update?: Uint8Array, initialize = false) => {
    const captured = encodeUpdate(Y.encodeStateAsUpdate(doc));
    const bytes = update && Uint8Array.from(update);
    const attempt = generation;
    const editWriter = writerId;
    const operationId = crypto.randomUUID();
    return queue(async () => {
      snapshot = captured;
      const hash = bytes && await updateHash(bytes);
      if (protocol === 2) {
        let edit = initialize ? [...edits.values()].find((item) => item.kind === 'seed') : undefined;
        if (hash && !edit) {
          if (editWriter === undefined) throw new Error('Writer registration required');
          edit = { operationId, writerId: editWriter, kind: initialize ? 'seed' : 'edit', update: encodeUpdate(bytes!), sha256: hash };
          edits.set(operationId, edit);
        }
        await save();
        if (initialize && edit && attempt === generation) sendEdit(edit);
        else pump();
      } else {
        if (hash) outbox.set(hash, encodeUpdate(bytes!));
        await save();
        if (initialize && hash && attempt === generation) send(hash, bytes!);
        else pump();
      }
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
    upgradingLegacy = protocol === 1 && initialContent.length <= 100_000 && outbox.size === 0 && writes === 0;
    const offerV2 = protocol === 2 || upgradingLegacy;
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
    let migrationMessage = '';
    const active = () => !disposed && socket === current && attempt === generation;
    handshakeTimer = setTimeout(() => { if (active()) current.close(); }, 30000);
    current.addEventListener('open', () => {
      if (!active()) return;
      report('syncing', '');
      try { current.send(JSON.stringify({ teamId, token, acknowledgements: true,
        ...(offerV2 ? { protocol: 2, registrationId, migrateLegacy: true } : {}) })); }
      catch { current.close(); }
    });
    current.addEventListener('message', (event) => {
      if (!active()) return;
      try {
        if (event.data instanceof ArrayBuffer && event.data.byteLength === 0) {
          fail('Collaboration Service is running the old protocol. Restart the updated backend, then click Retry.'); return;
        }
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          if (!selected) legacy();
          receivedHistory = true; seeded = true;
          Y.applyUpdate(doc, new Uint8Array(event.data), remote);
          return;
        }
        if (typeof event.data !== 'string') throw new Error('Unexpected message');
        const control = JSON.parse(event.data) as { type?: string; sha256?: string; sequence?: number;
          version?: number; writerId?: number; requestId?: string; operationId?: string; initialOperationId?: string; migrationBlocked?: boolean } | null;
        if (control?.type === 'protocol' && phase === 'syncing') {
          if (control.version === 1) { legacy(); upgradingLegacy = false;
            if (control.migrationBlocked) migrationMessage = 'This file remains on legacy editing because its history is not supported by attribution. Your edits still synchronize, but contribution totals are unavailable.';
          }
          else if (control.version === 2 && offerV2) {
            if (protocol === 1 && (outbox.size > 0 || writes > 0)) {
              fail('This file was upgraded while local edits were pending. Your recovered text is preserved. Save it locally before reopening and reconciling the shared file.');
              return;
            }
            protocol = 2; upgradingLegacy = false;
            selected = true; requiresV2 = true;
            const seed = [...edits.values()].find((item) => item.kind === 'seed');
            if (seed && control.initialOperationId && seed.operationId !== control.initialOperationId) {
              fail('Another participant initialized this file while you were offline. Keep this tab open and save your local text before resolving the different baselines.');
              return;
            }
          } else throw new Error('Unsupported protocol');
          return;
        }
        if (control?.type === 'writer' && protocol === 2 && selected && phase === 'syncing') {
          if (control.requestId !== registrationId || !Number.isSafeInteger(control.writerId) || control.writerId! < 0
              || (writerId !== undefined && writerId !== control.writerId)) throw new Error('Invalid writer binding');
          writerId = control.writerId!;
          doc.clientID = writerId;
          void queue(save);
          return;
        }
        if (control?.type === 'initialize' && phase === 'syncing' && !initializing && !receivedHistory) {
          if (!selected) legacy();
          if (protocol === 2 && writerId === undefined) throw new Error('Missing writer');
          initializing = true;
          if (!seeded && !ready) {
            seeded = true;
            doc.transact(() => { if (initialContent) doc.getText('content').insert(0, initialContent); }, restore);
          }
          void record(Y.encodeStateAsUpdate(doc), true);
        } else if (control?.type === 'synced' && phase === 'syncing' && !replayComplete) {
          if (!selected) legacy();
          if (protocol === 2 && writerId === undefined) throw new Error('Missing writer');
          replayComplete = true;
          clearTimeout(handshakeTimer);
          void queue(async () => {
            storedReady = true;
            await save();
            if (!active()) return;
            ready = true; seeded = true; retryCount = 0; refreshed = false;
            report('connected', migrationMessage); pump();
          });
        } else if (control?.type === 'ack' && typeof control.sha256 === 'string'
            && /^[a-f0-9]{64}$/.test(control.sha256) && Number.isSafeInteger(control.sequence) && control.sequence! > 0) {
          const hash = control.sha256;
          if (protocol === 2) {
            const operation = control.operationId;
            if (!uuid(operation)) throw new Error('Missing operation receipt');
            void queue(async () => {
              const edit = edits.get(operation);
              if (!edit || edit.sha256 !== hash || edit.writerId !== control.writerId) return;
              edits.delete(operation);
              await save();
              if (!active()) return;
              if (inFlight === operation) { inFlight = undefined; clearTimeout(receiptTimer); }
              pump();
            });
            return;
          }
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
      if (event.code === 4410) {
        report('error', 'This file now tracks attributed edits, but this device has unsent legacy changes. Your text is preserved. Save a local copy before reopening and reconciling it with the shared file.'); return;
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
        if ((value.version !== 1 && value.version !== 2) || typeof value.snapshot !== 'string'
            || !Array.isArray(value.pending) || typeof value.ready !== 'boolean') throw new Error('Invalid recovery state');
        protocol = value.version;
        selected = protocol === 1;
        if (value.version === 2) {
          if (!uuid(value.registrationId) || (value.writerId !== undefined && (!Number.isSafeInteger(value.writerId) || value.writerId < 0))) throw new Error('Invalid writer recovery');
          requiresV2 = value.writerId !== undefined || value.pending.length > 0 || value.ready;
        }
        Y.applyUpdate(doc, decodeUpdate(value.snapshot), restore);
        if (value.version === 1) {
          for (const encoded of value.pending) {
            if (typeof encoded !== 'string') throw new Error('Invalid pending update');
            const bytes = decodeUpdate(encoded);
            Y.applyUpdate(doc, bytes, restore);
            outbox.set(await updateHash(bytes), encoded);
          }
        } else {
          for (const edit of value.pending) {
            if (!edit || !uuid(edit.operationId) || !Number.isSafeInteger(edit.writerId) || edit.writerId < 0
                || !['seed', 'edit'].includes(edit.kind) || typeof edit.update !== 'string'
                || await updateHash(decodeUpdate(edit.update)) !== edit.sha256 || edits.has(edit.operationId)) throw new Error('Invalid pending edit');
            Y.applyUpdate(doc, decodeUpdate(edit.update), restore);
            edits.set(edit.operationId, edit);
          }
        }
        snapshot = encodeUpdate(Y.encodeStateAsUpdate(doc));
        storedReady = value.ready; ready = value.ready; seeded = true;
      }
      if (protocol === 2 && !requiresV2) await save();
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
