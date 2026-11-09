export type WorkstreamScope = { projectId: string; teamId: string; workstreamId: string };
export type CursorState = { documentId: string | null; anchor: string | null; head: string | null };
export type FileParticipant = { sessionId: string; userId: string; documentId: string; anchor: string | null; head: string | null };
export type WorkstreamPresenceState = WorkstreamScope & { phase: 'connecting' | 'online' | 'offline'; selfId?: string; participants: FileParticipant[] };
export const noCursor: CursorState = { documentId: null, anchor: null, head: null };
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const position = (value: unknown) => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));

export function connectWorkstreamPresence(options: {
  endpoint: string; scope: WorkstreamScope;
  getToken: (rejected?: string) => Promise<string>;
  onState: (state: WorkstreamPresenceState) => void;
}) {
  let socket: WebSocket | undefined, local = noCursor;
  let retry: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined, throttle: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, generation = 0, online = false, refreshed = false, delay = 500, lastSent = '';
  const report = (phase: WorkstreamPresenceState['phase'], participants: FileParticipant[] = [], selfId?: string) => {
    if (!disposed) options.onState({ ...options.scope, phase, participants, selfId });
  };
  const clear = () => { clearTimeout(watchdog); clearTimeout(throttle); throttle = undefined; clearInterval(heartbeat); heartbeat = undefined; online = false; lastSent = ''; };
  const send = (force = false) => {
    if (!online || disposed || !socket) return;
    const payload = JSON.stringify({ type: 'presence', ...local });
    if (force || payload !== lastSent) {
      try { socket.send(payload); lastSent = payload; } catch { socket.close(); }
    }
  };
  const open = async (rejected?: string) => {
    const attempt = ++generation; report('connecting');
    let token;
    try { token = await options.getToken(rejected); }
    catch { if (!disposed && attempt === generation) report('offline'); return; }
    if (disposed || attempt !== generation) return;
    let ws: WebSocket;
    try { ws = new WebSocket(options.endpoint); }
    catch { report('offline'); retry = setTimeout(() => { void open(); }, delay); delay = Math.min(delay * 2, 10000); return; }
    socket = ws;
    const active = () => !disposed && attempt === generation && socket === ws;
    const expired = () => { if (active()) ws.close(); };
    watchdog = setTimeout(expired, 10000);
    ws.addEventListener('open', () => { if (active()) { try { ws.send(JSON.stringify({ teamId: options.scope.teamId, token })); } catch { ws.close(); } } });
    ws.addEventListener('message', event => {
      if (!active()) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 32768) throw new Error('Invalid presence');
        const value = JSON.parse(event.data);
        if (value?.type !== 'workstream-presence' || value.projectId !== options.scope.projectId || value.teamId !== options.scope.teamId
            || value.workstreamId !== options.scope.workstreamId || !uuid(value.selfId)
            || !Array.isArray(value.participants) || value.participants.length > 32
            || new Set(value.participants.map((peer: FileParticipant) => peer?.sessionId)).size !== value.participants.length
            || value.participants.some((peer: FileParticipant) => !peer || !uuid(peer.sessionId) || !uuid(peer.userId)
              || typeof peer.documentId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(peer.documentId)
              || !position(peer.anchor) || !position(peer.head) || (peer.anchor === null) !== (peer.head === null))) throw new Error('Invalid presence');
        const first = !online; online = true; refreshed = false; delay = 500;
        clearTimeout(watchdog); watchdog = setTimeout(expired, 25000);
        report('online', value.participants, value.selfId);
        if (first) { send(); heartbeat = setInterval(() => send(true), 10000); }
      } catch { ++generation; clear(); socket = undefined; ws.close(); report('offline'); }
    });
    ws.addEventListener('error', () => { if (active()) ws.close(); });
    ws.addEventListener('close', event => {
      if (!active()) return;
      clear(); socket = undefined; report('offline');
      if ([4403, 1008, 1009].includes(event.code) || (event.code === 4401 && refreshed)) return;
      const rejected = event.code === 4401 ? token : undefined;
      if (rejected) refreshed = true;
      retry = setTimeout(() => { void open(rejected); }, delay); delay = Math.min(delay * 2, 10000);
    });
  };
  void open();
  return {
    update(value: CursorState) { local = { ...value }; if (!throttle) throttle = setTimeout(() => { throttle = undefined; send(); }, 50); },
    retry() { if (disposed) return; ++generation; clearTimeout(retry); clear(); socket?.close(); socket = undefined; refreshed = false; delay = 500; void open(); },
    dispose() { disposed = true; ++generation; clearTimeout(retry); clear(); socket?.close(); socket = undefined; },
  };
}
