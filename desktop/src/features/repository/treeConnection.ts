import { applyManifest, nextChange, within, type DiskEntry, type TreeCommand, type TreeEntry, type TreeState } from './fileTree';

type Event = { type: 'event'; version: number; command: TreeCommand };
export type TreeBridge = {
  load: () => Promise<TreeState | null>;
  save: (state: TreeState) => Promise<void>;
  snapshot: () => Promise<DiskEntry[]>;
  baseline: () => Promise<TreeEntry[]>;
  content: (path: string) => Promise<string>;
  apply: (command: TreeCommand, previous?: DiskEntry) => Promise<void>;
};
export type TreeStatus = { phase: 'connecting' | 'connected' | 'error'; message: string };
export function connectTree(options: {
  endpoint: string; teamId: string; bridge: TreeBridge;
  getToken: (rejected?: string) => Promise<string>;
  dirtyPaths: () => string[];
  onTree: (entries: TreeEntry[], disk: DiskEntry[], command?: TreeCommand) => void;
  onStatus: (status: TreeStatus) => void;
}) {
  const { bridge } = options;
  let state: TreeState;
  let socket: WebSocket | undefined;
  let stopped = false;
  let blocked = false;
  let ready = false;
  let generation = 0;
  let chain = Promise.resolve();
  let timer: ReturnType<typeof setTimeout>;
  let handshake: ReturnType<typeof setTimeout>;
  let token: string | undefined;
  let authRetried = false;
  let delay = 500;
  const status = (phase: TreeStatus['phase'], message: string) => { if (!stopped) options.onStatus({ phase, message }); };
  const fail = (error: unknown) => {
    if (stopped) return;
    blocked = true; ready = false; clearTimeout(timer); clearTimeout(handshake); socket?.close();
    status('error', error instanceof Error ? error.message : String(error));
  };
  const enqueue = (task: () => Promise<void>) => { chain = chain.then(async () => { if (!stopped && !blocked) await task(); }).catch(fail); };
  const send = () => { if (ready && state.pending && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(state.pending)); };
  const persist = async (next: TreeState) => { await bridge.save(next); state = next; };
  const stage = async (command: TreeCommand) => { await persist({ ...state, pending: command }); send(); };
  const poll = async () => {
    if (!ready || stopped || blocked) return;
    const disk = await bridge.snapshot();
    options.onTree(state.entries, disk);
    if (!state.pending) {
      const command = nextChange(state, disk);
      if (command) {
        if (command.path && options.dirtyPaths().some((path) => within(path, command.path!))) throw new Error('Save or close affected editor tabs, then retry file synchronization.');
        if (command.type === 'CREATE' && command.entry!.kind === 'FILE') command.content = await bridge.content(command.entry!.path);
        await stage(command);
      } else if (JSON.stringify(state.observed) !== JSON.stringify(disk)) await persist({ ...state, observed: disk });
    }
    timer = setTimeout(() => enqueue(poll), 1000);
  };
  const receive = async (event: Event) => {
    if (event.version <= state.version) {
      if (state.pending?.operationId === event.command.operationId) await persist({ ...state, pending: undefined });
      return;
    }
    if (event.version !== state.version + 1) throw new Error('Shared file history has a gap. Reconnect to replay it.');
    const command = event.command;
    const own = state.pending?.operationId === command.operationId;
    if (!own && command.path && options.dirtyPaths().some((path) => within(path, command.path!))) throw new Error('A teammate changed an open file or folder. Save or close affected tabs, then retry.');
    if (!own && command.type !== 'INITIALIZE') await bridge.apply(command, state.observed.find((entry) => entry.path === command.path));
    const disk = await bridge.snapshot();
    const entries = applyManifest(state.entries, command);
    // Retain old identities for outstanding local moves while catching up.
    const observed = entries.map((entry) => {
      const oldPath = command.type === 'RENAME' && within(entry.path, command.targetPath!) ? command.path! + entry.path.slice(command.targetPath!.length) : entry.path;
      const observed = disk.find((item) => item.path === entry.path) ?? state.observed.find((item) => item.path === oldPath);
      return observed ? { ...observed, path: entry.path } : undefined;
    }).filter((item): item is DiskEntry => !!item);
    await persist({ version: event.version, entries, observed, pending: own ? undefined : state.pending });
    options.onTree(entries, disk, command);
  };
  const open = async (rejected?: string) => {
    const attempt = ++generation;
    ready = false; status('connecting', 'Synchronizing files…');
    token = await options.getToken(rejected);
    if (stopped || blocked || attempt !== generation) return;
    const ws = new WebSocket(options.endpoint); socket = ws;
    handshake = setTimeout(() => ws.close(), 30000);
    ws.onopen = () => { if (attempt === generation && !stopped) ws.send(JSON.stringify({ teamId: options.teamId, token, afterVersion: state.version })); };
    ws.onmessage = (message) => enqueue(async () => {
      if (attempt !== generation) return;
      const data = JSON.parse(message.data as string);
      if (data.type === 'event') await receive(data);
      else if (data.type === 'synced') {
        if (data.version !== state.version) throw new Error('Incomplete shared file replay.');
        clearTimeout(handshake); ready = true; delay = 500; authRetried = false;
        if (!data.initialized && !state.pending) await stage({ operationId: crypto.randomUUID(), expectedVersion: 0, type: 'INITIALIZE', entries: await bridge.baseline() });
        else send();
        status('connected', 'Files synchronized');
        clearTimeout(timer); await poll();
      } else if (data.type === 'conflict') {
        if (state.pending?.type === 'INITIALIZE' && state.version > 0) { await persist({ ...state, pending: undefined }); return; }
        throw new Error(`File synchronization conflict: ${data.message} Local files are preserved. Review changes before retrying.`);
      } else throw new Error('Unexpected file synchronization response.');
    });
    ws.onclose = (event) => {
      if (attempt !== generation || stopped || blocked) return;
      ready = false; clearTimeout(timer); clearTimeout(handshake);
      if ([4403, 1008, 1009].includes(event.code)) { fail('File synchronization was rejected. Check access, file names, and size limits.'); return; }
      if (event.code === 4401 && authRetried) { fail('Sign in again to synchronize files.'); return; }
      const rejectedToken = event.code === 4401 ? token : undefined;
      if (rejectedToken) authRetried = true;
      status('connecting', 'Connection lost. Local changes are preserved; reconnecting…');
      timer = setTimeout(() => enqueue(() => open(rejectedToken)), delay); delay = Math.min(delay * 2, 10000);
    };
  };
  enqueue(async () => { state = await bridge.load() ?? { version: 0, entries: [], observed: [] }; await open(); });
  return {
    dispose() { stopped = true; ++generation; clearTimeout(timer); clearTimeout(handshake); socket?.close(); },
    async edit(command: TreeCommand) {
      if (!ready || blocked || state.pending) throw new Error('Wait for file synchronization before changing the tree.');
      if (command.path && options.dirtyPaths().some((path) => within(path, command.path!))) throw new Error('Save or close affected editor tabs first.');
      chain = chain.then(async () => {
        if (stopped || blocked || !ready || state.pending) throw new Error('File synchronization is not ready.');
        await bridge.apply(command, state.observed.find((entry) => entry.path === command.path));
        await stage({ ...command, expectedVersion: state.version });
        clearTimeout(timer); await poll();
      });
      const result = chain;
      chain = chain.catch(fail);
      return result;
    },
    reconcile() {
      if (stopped) return;
      blocked = false; ++generation; socket?.close(); clearTimeout(timer); clearTimeout(handshake);
      enqueue(async () => { await persist({ ...state, pending: undefined }); await open(); });
    },
    retry() {
      if (stopped) return;
      blocked = false; ++generation; socket?.close(); clearTimeout(timer); clearTimeout(handshake);
      // Preserve the exact pending operation across transport retries. A server
      // conflict requires explicit reconciliation instead of rebasing a delete.
      enqueue(async () => { state = await bridge.load() ?? { version: 0, entries: [], observed: [] }; await open(); });
    },
  };
}
