import { COLLABORATION_WS_URL } from '../../config';
import { authenticatedServiceRequest } from '../auth/session';

export type HistoryScope = { projectId: string; teamId: string; workstreamId: string };
export type Version = { sequence: number; actorId: string; timestamp: string; kind: 'ATTRIBUTED_EDIT' | 'LEGACY_UPDATE' | 'MIGRATION_BASELINE' | 'IMPORTED_BASELINE' };
export type HistoryPage = { path: string; deleted: boolean; items: Version[]; nextBefore: number | null };
export type VersionDiff = { path: string; deleted: boolean; version: Version; beforeSequence: number; before: string; after: string };
const baseUrl = COLLABORATION_WS_URL.replace(/^ws/, 'http');
const path = (scope: HistoryScope, documentId: string) => `/api/projects/${encodeURIComponent(scope.projectId)}/teams/${encodeURIComponent(scope.teamId)}/workstreams/${encodeURIComponent(scope.workstreamId)}/documents/${encodeURIComponent(documentId)}/history`;
export const getHistory = (scope: HistoryScope, documentId: string, before?: number) =>
  authenticatedServiceRequest<HistoryPage>(baseUrl, `${path(scope, documentId)}${before === undefined ? '' : `?before=${before}`}`, 'GET');
export const getVersionDiff = (scope: HistoryScope, documentId: string, sequence: number) =>
  authenticatedServiceRequest<VersionDiff>(baseUrl, `${path(scope, documentId)}/${sequence}`, 'GET');
export function versionLabel(version: Version) {
  switch (version.kind) {
    case 'ATTRIBUTED_EDIT': return 'Collaborative edit';
    case 'LEGACY_UPDATE': return 'Legacy update · authorship unknown';
    case 'MIGRATION_BASELINE': return 'History migration · authorship unknown';
    case 'IMPORTED_BASELINE': return 'Imported content · authorship unknown';
    default: return 'Historical update · authorship unknown';
  }
}
