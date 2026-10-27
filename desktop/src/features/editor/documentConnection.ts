import * as Y from 'yjs';

export type ConnectionPhase = 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'denied' | 'error';
export type DocumentConnectionState = {
  phase: ConnectionPhase;
  ready: boolean;
  pending: boolean;
  message: string;
};

export function documentIdForPath(path: string) {
  let hash = 2166136261;
  for (const character of path) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Keep the existing ID mapping so persisted documents retain their history.
  return `${path.replace(/[^A-Za-z0-9._-]/g, '-').slice(-80)}-${(hash >>> 0).toString(16)}`;
}

export function connectDocument({ doc, endpoint, teamId, initialContent, getToken, onState }: {
  doc: Y.Doc;
  endpoint: string;
  teamId: string;
  initialContent: string;
  getToken: (rejectedToken?: string) => Promise<string>;
  onState: (state: DocumentConnectionState) => void;
}) {
  const remote = {};
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  let ready = false;
  let seeded = false;
  let pending = false;
  let localSinceConnect = false;
  let retryCount = 0;
  let refreshed = false;
  let phase: ConnectionPhase = 'connecting';
  let message = '';
  const report = (next: ConnectionPhase, detail = '') => {
    phase = next;
    message = detail;
    onState({ phase, ready, pending, message });
  };
  const stopSocket = () => {
    generation++;
    clearTimeout(retryTimer);
    clearTimeout(handshakeTimer);
    const previous = socket;
    socket = undefined;
    previous?.close();
  };
  const fail = (detail: string) => {
    pending ||= localSinceConnect;
    stopSocket();
    report('error', detail);
  };
  const send = (update: Uint8Array): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (update.byteLength > 2 * 1024 * 1024) {
      fail('This document exceeds the collaboration message limit. Save your text locally before closing.');
      return false;
    }
    if (socket.bufferedAmount + update.byteLength > 4 * 1024 * 1024) {
      socket.close();
      return false;
    }
    try { socket.send(update); return true; }
    catch { socket.close(); return false; }
  };
  const changed = (update: Uint8Array, origin: unknown) => {
    if (origin === remote || disposed) return;
    localSinceConnect = true;
    if (phase !== 'connected' || !send(update)) {
      pending = true;
      report(phase, message);
    }
  };
  doc.on('update', changed);

  const connect = async (rejectedToken?: string) => {
    stopSocket();
    const attempt = generation;
    report(ready ? 'reconnecting' : 'connecting');
    let token: string;
    try { token = await getToken(rejectedToken); }
    catch {
      if (!disposed && attempt === generation) report('denied', 'Sign in again to reconnect. Your open document is preserved.');
      return;
    }
    if (disposed || attempt !== generation) return;
    let current: WebSocket;
    try { current = new WebSocket(endpoint); }
    catch { fail('Unable to open the collaboration connection. Check the service address and retry.'); return; }
    socket = current;
    current.binaryType = 'arraybuffer';
    let receivedHistory = false;
    let initializing = false;
    const active = () => !disposed && socket === current && attempt === generation;
    handshakeTimer = setTimeout(() => { if (active()) current.close(); }, 30000);
    current.addEventListener('open', () => {
      if (!active()) return;
      report('syncing');
      try { current.send(JSON.stringify({ teamId, token })); }
      catch { current.close(); }
    });
    current.addEventListener('message', (event) => {
      if (!active()) return;
      try {
        if (event.data instanceof ArrayBuffer && event.data.byteLength === 0) {
          fail('Collaboration Service is running the old protocol. Restart the updated backend, then click Retry.');
          return;
        }
        if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
          receivedHistory = true;
          seeded = true;
          Y.applyUpdate(doc, new Uint8Array(event.data), remote);
          return;
        }
        if (typeof event.data !== 'string') throw new Error('Unexpected message');
        const control = JSON.parse(event.data) as { type?: string } | null;
        if (control?.type === 'initialize' && phase === 'syncing' && !initializing && !receivedHistory) {
          initializing = true;
          if (!seeded && !ready) {
            seeded = true;
            doc.transact(() => { if (initialContent) doc.getText('content').insert(0, initialContent); }, remote);
          }
          send(Y.encodeStateAsUpdate(doc));
        } else if (control?.type === 'synced' && phase === 'syncing') {
          clearTimeout(handshakeTimer);
          ready = true;
          seeded = true;
          const hadPending = pending;
          if (send(Y.encodeStateAsUpdate(doc))) {
            localSinceConnect = hadPending;
            pending = false;
            retryCount = 0;
            refreshed = false;
            report('connected');
          }
        } else throw new Error('Unexpected control message');
      } catch {
        fail('The shared document could not be synchronized. Save any recovered text locally before retrying.');
      }
    });
    current.addEventListener('error', () => { if (active()) current.close(); });
    current.addEventListener('close', (event) => {
      if (!active()) return;
      clearTimeout(handshakeTimer);
      socket = undefined;
      pending ||= localSinceConnect;
      if (event.code === 4403 || (event.code === 4401 && refreshed)) {
        report('denied', event.code === 4403
          ? 'Team editing access is unavailable. Check your membership before retrying.'
          : 'Your session could not be renewed. Sign in again to reconnect.');
        return;
      }
      if (event.code === 1008 || event.code === 1009) {
        report('error', event.code === 1009 ? 'The document exceeds the collaboration message limit.'
          : 'The collaboration server rejected this session. Retry after checking the workspace.');
        return;
      }
      const rejected = event.code === 4401 ? token : undefined;
      if (rejected) refreshed = true;
      report('reconnecting');
      retryTimer = setTimeout(() => { void connect(rejected); }, Math.min(500 * 2 ** retryCount++, 10000));
    });
  };
  void connect();
  return {
    retry() {
      if (disposed) return;
      refreshed = false;
      retryCount = 0;
      void connect();
    },
    dispose() {
      disposed = true;
      stopSocket();
      doc.off('update', changed);
    },
  };
}
