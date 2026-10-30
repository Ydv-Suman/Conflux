import { invoke } from '@tauri-apps/api/core';

export type StoredDocument = { version: 1; snapshot: string; pending: string[]; ready: boolean };
export type DocumentStorage = { load: () => Promise<StoredDocument | null>; save: (value: StoredDocument) => Promise<void> };

// Reopening a tab must wait for the previous instance's queued writes, including hashing.
const queues = new WeakMap<DocumentStorage, Promise<void>>();
export function serializeDocument(storage: DocumentStorage, action: () => Promise<void>) {
  const task = (queues.get(storage) ?? Promise.resolve()).then(action);
  queues.set(storage, task.catch(() => {}));
  return task;
}

const stores = new Map<string, DocumentStorage>();
export function nativeDocumentStorage(endpoint: string, teamId: string, userId: string): DocumentStorage {
  const scope = JSON.stringify([endpoint, teamId, userId]);
  let storage = stores.get(scope);
  if (!storage) {
    storage = {
      async load() {
        const value = await invoke<string | null>('document_load', { scope });
        return value === null ? null : JSON.parse(value) as StoredDocument;
      },
      save: (value) => invoke('document_save', { scope, value: JSON.stringify(value) }),
    };
    stores.set(scope, storage);
  }
  return storage;
}

export function encodeUpdate(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeUpdate(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
export async function updateHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
