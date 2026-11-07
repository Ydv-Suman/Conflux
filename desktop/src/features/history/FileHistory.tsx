import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../../components/Modal';
import { listTeamMembers, type TeamMember } from '../teams/api';
import { getHistory, getVersionDiff, versionLabel, type HistoryPage, type HistoryScope, type VersionDiff } from './api';
import { HistoryDiff } from './HistoryDiff';
import './history.css';

export function FileHistory({ scope, documentId, path, theme, onClose }: {
  scope: HistoryScope; documentId: string; path: string; theme: 'light' | 'dark'; onClose: () => void;
}) {
  const { projectId, teamId, workstreamId } = scope;
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [cursors, setCursors] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const before = cursors.at(-1);
  useEffect(() => {
    let disposed = false;
    void listTeamMembers(teamId).then(value => { if (!disposed) setMembers(value); }).catch(() => { if (!disposed) setMembers([]); });
    return () => { disposed = true; };
  }, [teamId]);
  useEffect(() => {
    const refreshHistory = () => setRefresh(value => value + 1);
    const timer = window.setInterval(refreshHistory, 30000);
    window.addEventListener('focus', refreshHistory);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshHistory); };
  }, []);
  useEffect(() => {
    let disposed = false;
    void getHistory({ projectId, teamId, workstreamId }, documentId, before).then(value => {
      if (disposed) return;
      setPage(value); setError('');
      setSelected(current => value.items.some(item => item.sequence === current) ? current : value.items[0]?.sequence ?? null);
    }).catch((cause: unknown) => {
      if (disposed) return;
      setPage(null); setSelected(null); setDiff(null);
      setError(cause instanceof Error ? cause.message : 'History is unavailable. Try refreshing.');
    });
    return () => { disposed = true; };
  }, [projectId, teamId, workstreamId, documentId, before, refresh]);
  useEffect(() => {
    let disposed = false;
    setDiff(current => current?.version.sequence === selected ? current : null); setDiffError('');
    if (selected === null) return;
    void getVersionDiff({ projectId, teamId, workstreamId }, documentId, selected).then(value => {
      if (!disposed) setDiff(current => current?.version.sequence === value.version.sequence && current.before === value.before && current.after === value.after ? current : value);
    }).catch((cause: unknown) => {
      if (!disposed) { setDiff(null); setDiffError(cause instanceof Error ? cause.message : 'This version is unavailable.'); }
    });
    return () => { disposed = true; };
  }, [projectId, teamId, workstreamId, documentId, selected, refresh]);
  const account = (id: string) => {
    const member = members.find(item => item.userId === id);
    return member?.fullName || member?.username || id;
  };
  const navigate = (next: number[]) => { setPage(null); setSelected(null); setDiff(null); setError(''); setCursors(next); };
  return createPortal(<Modal title="File history" onClose={onClose} wide>
    <div className="file-history">
      <div className="file-history-toolbar"><strong title={page?.path ?? path}>{page?.path ?? path}{page?.deleted ? ' · Deleted' : ''}</strong><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      <p className="file-history-note">Shared versions · local and unsynchronized changes are not included.</p>
      {error ? <p role="alert">{error}</p> : !page ? <p role="status">Loading history…</p> : page.items.length === 0 ? <p role="status">No shared history recorded for this file.</p> : <div className="file-history-layout">
        <aside aria-label="File versions"><ol className="file-history-versions">{page.items.map(version => <li key={version.sequence}>
          <button type="button" aria-pressed={selected === version.sequence} onClick={() => setSelected(version.sequence)}>
            <span className="file-history-version">Version {version.sequence}<time dateTime={version.timestamp}>{new Date(version.timestamp).toLocaleString()}</time></span>
            <span>{versionLabel(version)}</span>
            <span className="file-history-note">{version.kind === 'ATTRIBUTED_EDIT' ? 'Edited by' : 'Submitted by'} {account(version.actorId)}</span>
          </button>
        </li>)}</ol></aside>
        <section className="file-history-comparison" aria-label="Selected version">
          {diffError ? <p role="alert">{diffError}</p> : diff ? <><div className="file-history-comparison-label">Before (v{diff.beforeSequence}) → After (v{diff.version.sequence})</div><HistoryDiff key={diff.version.sequence} diff={diff} theme={theme} /></> : <p role="status">Loading change…</p>}
        </section>
      </div>}
      <nav className="file-history-pagination" aria-label="History pages">
        <button type="button" disabled={!cursors.length} onClick={() => navigate(cursors.slice(0, -1))}>Newer versions</button>
        <button type="button" disabled={!page?.nextBefore} onClick={() => page?.nextBefore && navigate([...cursors, page.nextBefore])}>Older versions</button>
      </nav>
    </div>
  </Modal>, document.body);
}
