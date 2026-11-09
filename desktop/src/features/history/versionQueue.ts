import type { DocumentConnectionState } from '../editor/documentConnection';
import type { HistoryScope } from './api';

export type VersionJob = VersionTarget & { requestId: string; sessionId?: string };
export type VersionTarget = HistoryScope & { documentId: string; afterOperationId?: string; afterHash?: string; afterSequence?: number };
export type VersionQueueStatus = { pending: number; message: string };
type Recovery = { dispose: () => void; retry: () => void };
export type VersionQueue = ReturnType<typeof createVersionQueue>;
const key = (target: VersionTarget) => JSON.stringify([target.projectId, target.teamId, target.workstreamId, target.documentId]);
const settled = (state?: DocumentConnectionState) => state?.phase === 'connected' && state.ready && !state.pending && !state.persisting;
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function createVersionQueue(options: {
  load: () => Promise<unknown>;
  save: (value: { version: 1; jobs: VersionJob[] }) => Promise<void>;
  create: (job: VersionJob) => Promise<unknown>;
  recover: (job: VersionJob, onState: (state: DocumentConnectionState) => void) => Promise<Recovery>;
  onStatus: (status: VersionQueueStatus) => void;
}) {
  let jobs: VersionJob[] = [], stopped = false, running = false;
  let mutations = Promise.resolve();
  const active = new Map<string, { owner: string; state?: DocumentConnectionState }>();
  const recovering = new Map<string, { connection?: Recovery; state?: DocumentConnectionState }>();
  const blocked = new Set<string>();
  const retryAt = new Map<string, number>();
  const status = (message = '') => { if (!stopped) options.onStatus({ pending: jobs.length, message }); };
  const ready = options.load().then(value => {
    if (value == null) return;
    const stored = value as { version?: number; jobs?: VersionJob[] };
    if (stored.version !== 1 || !Array.isArray(stored.jobs) || stored.jobs.length > 1000
        || stored.jobs.some(job => !job || !/^[A-Za-z0-9._-]{1,128}$/.test(job.documentId)
          || [job.projectId, job.teamId, job.workstreamId, job.requestId].some(id => !uuid(id))
          || (job.sessionId !== undefined && !uuid(job.sessionId))
          || (job.afterOperationId !== undefined && !uuid(job.afterOperationId))
          || (job.afterHash !== undefined && !/^[a-f0-9]{64}$/.test(job.afterHash))
          || (job.afterSequence !== undefined && (!Number.isSafeInteger(job.afterSequence) || job.afterSequence < 0))
          || [job.afterOperationId, job.afterHash, job.afterSequence].filter(value => value !== undefined).length > 1)
        || new Set(stored.jobs.map(job => job.requestId)).size !== stored.jobs.length) throw new Error('Pending versions could not be recovered. Local document recovery is preserved.');
    jobs = stored.jobs;
  });
  const mutate = (action: () => VersionJob[]) => {
    const next = mutations.then(async () => {
      await ready;
      const value = action();
      await options.save({ version: 1, jobs: value });
      jobs = value; status();
    });
    mutations = next.catch(() => {});
    return next;
  };
  const wake = () => { void Promise.resolve().then(process); };
  const releaseRecovery = (target: VersionTarget) => {
    const id = key(target); recovering.get(id)?.connection?.dispose(); recovering.delete(id);
  };
  async function process() {
    if (stopped || running) return;
    running = true;
    try {
      await ready;
      for (const job of [...jobs]) {
        if (stopped) break;
        if (blocked.has(job.requestId) || Date.now() < (retryAt.get(job.requestId) ?? 0)) continue;
        const id = key(job);
        try {
          const open = active.get(id);
          if (open) { if (!settled(open.state) || job.sessionId === open.owner) continue; }
          else if (job.afterSequence === undefined) {
            let recovery = recovering.get(id);
            if (!recovery) {
              if (recovering.size >= 2) continue;
              recovery = {}; recovering.set(id, recovery);
              const captured = recovery;
              captured.connection = await options.recover(job, state => {
                if (recovering.get(id) !== captured || stopped) return;
                captured.state = state; wake();
              });
              if (stopped || active.has(id)) { captured.connection.dispose(); recovering.delete(id); continue; }
            }
            if (recovery.state?.phase === 'denied' || recovery.state?.phase === 'error') {
              blocked.add(job.requestId); status(recovery.state.message || 'A pending version needs attention. Retry after resolving document access or recovery.');
              releaseRecovery(job); continue;
            }
            if (!settled(recovery.state)) continue;
          }
          await options.create(job);
          // Keep the original request until its removal is durable; lost replies retry idempotently.
          await mutate(() => jobs.filter(item => item.requestId !== job.requestId));
          retryAt.delete(job.requestId);
          if (!jobs.some(item => key(item) === id)) releaseRecovery(job);
        } catch (cause) {
          const code = (cause as { status?: number }).status;
          if (code && [400, 401, 403, 404, 422].includes(code)) { blocked.add(job.requestId); releaseRecovery(job); }
          else retryAt.set(job.requestId, Date.now() + 10000);
          status(cause instanceof Error ? cause.message : 'A version is pending synchronization.');
        }
      }
    } catch (cause) { status(cause instanceof Error ? cause.message : 'Pending versions could not load.'); }
    finally { running = false; }
  }
  void ready.then(() => { status(); wake(); }).catch(cause => status(cause instanceof Error ? cause.message : 'Pending versions could not load.'));
  return {
    async enqueue(target: VersionTarget) {
      if (stopped) throw new Error('Version recovery is unavailable. Keep this file open.');
      const job: VersionJob = { ...target, requestId: crypto.randomUUID(), sessionId: active.get(key(target))?.owner };
      await mutate(() => { if (jobs.length >= 1000) throw new Error('Too many versions await synchronization. Reconnect before closing more files.'); return [...jobs, job]; });
      wake();
    },
    retain(target: VersionTarget) {
      const id = key(target), owner = crypto.randomUUID();
      releaseRecovery(target); active.set(id, { owner });
      return {
        update(state: DocumentConnectionState) { if (active.get(id)?.owner === owner) { active.set(id, { owner, state }); wake(); } },
        release() { if (active.get(id)?.owner === owner) { active.delete(id); wake(); } },
      };
    },
    pump: process,
    retry() { blocked.clear(); retryAt.clear(); for (const value of recovering.values()) value.connection?.retry(); wake(); },
    dispose() { stopped = true; for (const value of recovering.values()) value.connection?.dispose(); recovering.clear(); active.clear(); },
  };
}
