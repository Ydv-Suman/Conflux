export type TeamPresenceState = {
  teamId: string;
  phase: 'connecting' | 'online' | 'offline';
  count: number | null;
  userIds?: string[];
  message?: string;
};

export function connectTeamPresence(options: {
  endpoint: string;
  teamId: string;
  getToken: (rejectedToken?: string) => Promise<string>;
  onState: (state: TeamPresenceState) => void;
}) {
  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let disposed = false, generation = 0, delay = 500, authRetried = false;
  const report = (phase: TeamPresenceState['phase'], count: number | null = null, userIds?: string[], message?: string) => {
    if (!disposed) options.onState({ teamId: options.teamId, phase, count, ...(userIds ? { userIds } : {}), ...(message ? { message } : {}) });
  };
  const clearTimers = () => {
    clearTimeout(watchdog); clearInterval(heartbeat);
    watchdog = undefined; heartbeat = undefined;
  };
  const schedule = (rejected?: string) => {
    report('offline');
    retryTimer = setTimeout(() => { void open(rejected); }, delay);
    delay = Math.min(delay * 2, 10000);
  };
  const open = async (rejected?: string) => {
    const attempt = ++generation;
    report('connecting');
    let token: string;
    try { token = await options.getToken(rejected); }
    catch {
      if (!disposed && attempt === generation) report('offline', null, undefined, 'Unable to refresh your session. Retry, or sign in again.');
      return;
    }
    if (disposed || attempt !== generation) return;
    let ws: WebSocket;
    try { ws = new WebSocket(options.endpoint); }
    catch { schedule(); return; }
    socket = ws;
    const active = () => !disposed && attempt === generation && socket === ws;
    const fail = (retry = true) => {
      if (!active()) return;
      ++generation; socket = undefined; clearTimers(); ws.close();
      if (retry) schedule(); else report('offline', null, undefined, 'The server returned an invalid team presence response. Check that Collaboration Service is up to date.');
    };
    watchdog = setTimeout(() => fail(), 10000);
    ws.addEventListener('open', () => {
      if (!active()) return;
      try { ws.send(JSON.stringify({ token })); } catch { fail(); }
    });
    ws.addEventListener('message', (event) => {
      if (!active()) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Invalid presence response');
        const data = JSON.parse(event.data);
        if (data?.type !== 'presence' || data.teamId !== options.teamId
            || !Number.isSafeInteger(data.count) || data.count < 1 || data.count > 128
            || (data.userIds !== undefined && (!Array.isArray(data.userIds)
              || data.userIds.length !== data.count || new Set(data.userIds).size !== data.count
              || !data.userIds.every((id: unknown) => typeof id === 'string'
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))))) {
          throw new Error('Invalid presence response');
        }
        clearTimeout(watchdog);
        watchdog = setTimeout(() => fail(), 25000);
        if (!heartbeat) heartbeat = setInterval(() => {
          if (active()) { try { ws.send('ping'); } catch { fail(); } }
        }, 10000);
        delay = 500; authRetried = false;
        report('online', data.count, data.userIds);
      } catch { fail(false); }
    });
    ws.addEventListener('error', () => fail());
    ws.addEventListener('close', (event) => {
      if (!active()) return;
      clearTimers(); socket = undefined;
      report('offline');
      if ([4403, 1008, 1009].includes(event.code) || (event.code === 4401 && authRetried)) {
        report('offline', null, undefined, event.code === 4403 ? 'Team presence access was denied. Check your team membership, then retry.'
          : event.code === 4401 ? 'Your session was rejected after refresh. Sign in again.'
          : 'The server rejected the presence request. Check that Collaboration Service is up to date.');
        return;
      }
      const rejectedToken = event.code === 4401 ? token : undefined;
      if (rejectedToken) authRetried = true;
      schedule(rejectedToken);
    });
  };
  void open();
  return {
    retry() {
      if (disposed) return;
      ++generation; clearTimeout(retryTimer); clearTimers();
      socket?.close(); socket = undefined; authRetried = false; delay = 500;
      void open();
    },
    dispose() { disposed = true; ++generation; clearTimeout(retryTimer); clearTimers(); socket?.close(); },
  };
}
