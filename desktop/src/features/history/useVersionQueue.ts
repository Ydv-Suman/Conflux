import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as Y from 'yjs';
import { COLLABORATION_WS_URL } from '../../config';
import { getCurrentUser, getCollaborationToken } from '../auth/session';
import { isDesktop } from '../repository/api';
import { connectDocument } from '../editor/documentConnection';
import { nativeDocumentStorage, serializeDocument } from '../editor/documentStorage';
import { createCheckpoint } from './api';
import { createVersionQueue, type VersionQueue, type VersionQueueStatus } from './versionQueue';

export function useVersionQueue() {
  const [queue, setQueue] = useState<VersionQueue | null>(null);
  const [status, setStatus] = useState<VersionQueueStatus>({ pending: 0, message: '' });
  useEffect(() => {
    const userId = getCurrentUser()?.id;
    if (!userId || !isDesktop()) return;
    const storageScope = JSON.stringify([COLLABORATION_WS_URL, 'file-checkpoints', userId]);
    const sameUser = () => { if (getCurrentUser()?.id !== userId) throw new Error('Sign in to the original account to finish pending versions.'); };
    const controller = createVersionQueue({
      load: async () => { const value = await invoke<string | null>('document_load', { scope: storageScope }); return value === null ? null : JSON.parse(value); },
      save: value => invoke('document_save', { scope: storageScope, value: JSON.stringify(value) }),
      create: job => { sameUser(); return createCheckpoint(job, job.documentId, job.requestId, { afterOperationId: job.afterOperationId, afterHash: job.afterHash, afterSequence: job.afterSequence }); },
      recover: async (job, onState) => {
        sameUser();
        const endpoint = `${COLLABORATION_WS_URL}/ws/projects/${job.projectId}/workstreams/${job.workstreamId}/documents/${job.documentId}`;
        const storage = nativeDocumentStorage(endpoint, job.teamId, userId);
        const saved = await serializeDocument(storage, () => storage.load());
        if (!saved?.ready) throw new Error('A pending version needs its saved document. Reopen the file and retry; recovery has been preserved.');
        const doc = new Y.Doc({ gc: false });
        const connection = connectDocument({ doc, endpoint, teamId: job.teamId, initialContent: '', storage, onState,
          getToken: rejected => { sameUser(); return getCollaborationToken(rejected); } });
        return { retry: connection.retry, dispose() { connection.dispose(); doc.destroy(); } };
      },
      onStatus: setStatus,
    });
    setQueue(controller);
    const timer = window.setInterval(() => { void controller.pump(); }, 2000);
    const retry = () => controller.retry();
    window.addEventListener('online', retry);
    return () => { clearInterval(timer); window.removeEventListener('online', retry); controller.dispose(); };
  }, []);
  return { queue, status };
}
