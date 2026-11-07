import { COLLABORATION_WS_URL } from '../../config';
import { authenticatedServiceRequest } from '../auth/session';

export type Scope = { projectId: string; teamId: string; workstreamId: string };
export type Filters = { allTime?: boolean; from: string; until: string; actorId: string; documentId: string };
export type Change = { documentId: string; path: string; deletedFile: boolean; sequence: number; actorId: string; timestamp: string; operationId: string; inserted: number; deleted: number };
export type DailyChange = { documentId: string; path: string; deletedFile: boolean; actorId: string; day: string; edits: number; inserted: number; deleted: number };
export type Report = {
  generatedAt: string; from: string; until: string;
  documents: { id: string; path: string; deleted: boolean }[];
  members: { actorId: string; edits: number; inserted: number; deleted: number; files: number }[];
  unverifiedMembers: { actorId: string; records: number }[];
  dailyChanges: DailyChange[]; matchingDays: number; changes: Change[]; matchingChanges: number; offset: number;
  filesWithoutHistory: number; legacyFiles: number; importedFiles: number; unknownRecords: number;
};
export type Evidence = { sequence: number; actorId: string; timestamp: string; operationId: string; before: string; after: string };
const baseUrl = COLLABORATION_WS_URL.replace(/^ws/, 'http');
const path = (scope: Scope) => `/api/projects/${encodeURIComponent(scope.projectId)}/teams/${encodeURIComponent(scope.teamId)}/workstreams/${encodeURIComponent(scope.workstreamId)}/contributions`;
export function getReport(scope: Scope, filters: Filters, offset = 0) {
  const query = new URLSearchParams({ from: filters.from, until: filters.until, offset: String(offset) });
  if (filters.allTime) { query.delete('from'); query.delete('until'); query.set('allTime', 'true'); }
  if (filters.actorId) query.set('actorId', filters.actorId);
  if (filters.documentId) query.set('documentId', filters.documentId);
  return authenticatedServiceRequest<Report>(baseUrl, `${path(scope)}?${query}`, 'GET');
}
export const getEvidence = (scope: Scope, change: Change) => authenticatedServiceRequest<Evidence>(baseUrl,
  `${path(scope)}/documents/${encodeURIComponent(change.documentId)}/changes/${change.sequence}`, 'GET');

export { snapshotText } from '../editor/documentSnapshot';

export function dateWindow(from: string, through: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${through}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 366 * 86400000)
    throw new Error('Choose a valid date range of at most 366 days.');
  return { from: start.toISOString(), until: end.toISOString() };
}
