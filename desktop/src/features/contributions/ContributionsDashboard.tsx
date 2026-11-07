import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api';
import { Modal } from '../../components/Modal';
import { listTeamMembers, type TeamCapabilities, type TeamMember } from '../teams/api';
import { dateWindow, getEvidence, getReport, snapshotText, type Change, type DailyChange, type Filters, type Report, type Scope } from './api';
import './contributions.css';

const errorMessage = (error: unknown) => error instanceof ApiError && [401, 403].includes(error.status)
  ? 'Access denied. Contributions are available only to this team’s admins and team leads.'
  : error instanceof Error ? error.message : 'Contributions could not load. Try again.';

function ChangeEvidence({ scope, change }: { scope: Scope; change: Change }) {
  const [text, setText] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void getEvidence(scope, change).then(evidence => {
      if (!disposed) setText({ before: snapshotText(evidence.before), after: snapshotText(evidence.after) });
    }).catch(reason => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, [scope, change]);
  return <section className="contribution-evidence" aria-label="Change evidence">

    <details className="contribution-details"><summary>Change details</summary><p>Entry {change.sequence} · {new Date(change.timestamp).toLocaleString()}</p><p>Account: {change.actorId}<br />Operation: {change.operationId}</p></details>
    {error ? <p role="alert">{error}</p> : !text ? <p role="status">Loading change…</p> : <div className="contribution-snapshots">
      {(['before', 'after'] as const).map(side => <div key={side}><h4>{side === 'before' ? 'Before' : 'After'}</h4><pre tabIndex={0} aria-label={`${side} snapshot`}>{text[side] || '(empty document)'}</pre></div>)}
    </div>}
  </section>;
}

function DailyEvidence({ scope, day }: { scope: Scope; day: DailyChange }) {
  const panel = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Report | null>(null);
  const [offset, setOffset] = useState(0);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { panel.current?.focus(); panel.current?.scrollIntoView({ block: 'nearest' }); }, []);
  useEffect(() => {
    let disposed = false;
    setPage(null); setError(''); setIndex(0);
    void getReport(scope, { ...dateWindow(day.day, day.day), actorId: day.actorId, documentId: day.documentId }, offset)
      .then(value => { if (!disposed) setPage(value); }).catch(reason => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, [scope, day.day, day.actorId, day.documentId, offset]);
  const change = page?.changes[index];
  return <div ref={panel} tabIndex={-1} className="contribution-day-evidence" role="region" aria-label={`Changes in ${day.path} on ${day.day}`}>
    {error ? <p role="alert">{error}</p> : !page ? <p role="status">Loading changes…</p> : <>
      <div className="contribution-evidence-navigation">
        <label className="contribution-field">Recorded edit<select value={index} onChange={event => setIndex(Number(event.target.value))}>{page.changes.map((item, i) => <option key={item.sequence} value={i}>Edit {page.matchingChanges - page.offset - i} · +{item.inserted} / −{item.deleted}</option>)}</select></label>
        {page.matchingChanges > 100 && <div><button type="button" className="neutral-button" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Newer edits</button><button type="button" className="neutral-button" disabled={offset + page.changes.length >= page.matchingChanges} onClick={() => setOffset(value => value + 100)}>Older edits</button></div>}
      </div>
      {change ? <ChangeEvidence key={change.sequence} scope={scope} change={change} /> : <p>No recorded changes available.</p>}
    </>}
  </div>;
}

function Dashboard({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [through, setThrough] = useState(() => new Date().toISOString().slice(0, 10));
  const [allTime, setAllTime] = useState(true);
  const [actorId, setActorId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [filters, setFilters] = useState<Filters>(() => ({ ...dateWindow(from, through), allTime: true, actorId: '', documentId: '' }));
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let disposed = false;
    void listTeamMembers(scope.teamId).then(items => { if (!disposed) setMembers(items); }).catch(() => { if (!disposed) setMembers([]); });
    return () => { disposed = true; };
  }, [scope.teamId]);
  useEffect(() => {
    let disposed = false;
    setError('');
    void getReport(scope, filters, offset).then(value => { if (!disposed) setReport(value); })
      .catch(reason => { if (!disposed) { setError(errorMessage(reason)); setReport(null); } });
    return () => { disposed = true; };
  }, [scope, filters, attempt, offset]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const name = (id: string) => { const member = members.find(item => item.userId === id); return member?.fullName || member?.username || id; };
  const actors = [...new Set([...members.map(member => member.userId), ...(report?.members.map(member => member.actorId) ?? []), ...(report?.unverifiedMembers.map(member => member.actorId) ?? []), ...(actorId ? [actorId] : [])])];
  const selectMember = (id: string) => { setActorId(id); setFilters(current => ({ ...current, actorId: id })); setOffset(0); setReport(null); };
  return <Modal wide title="Contributions" onClose={onClose}>
    <div className="contributions-dashboard">
    <form className={`contribution-filters ${allTime ? 'is-all-time' : ''}`} onSubmit={event => {
      event.preventDefault();
      try { setFilters({ ...(allTime ? { from: '', until: '' } : dateWindow(from, through)), allTime, actorId, documentId }); setFormError(''); setOffset(0); setReport(null); }
      catch (reason) { setFormError(errorMessage(reason)); }
    }}>
      <label className="contribution-field">Time range<select value={allTime ? 'all' : 'custom'} onChange={event => setAllTime(event.target.value === 'all')}><option value="all">All time</option><option value="custom">Date range</option></select></label>
      {!allTime && <><label className="contribution-field">From<input required type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="contribution-field">To<input required type="date" value={through} onChange={event => setThrough(event.target.value)} /></label></>}
      <label className="contribution-field">Member<select value={actorId} onChange={event => selectMember(event.target.value)}><option value="">All members</option>{actors.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
      <label className="contribution-field">File<select value={documentId} onChange={event => setDocumentId(event.target.value)}><option value="">All files</option>{report?.documents.map(file => <option key={file.id} value={file.id}>{file.path}{file.deleted ? ' (deleted)' : ''}</option>)}{documentId && !report?.documents.some(file => file.id === documentId) && <option value={documentId}>{documentId}</option>}</select></label>
      <button className="neutral-button-filled contribution-apply" type="submit">Apply</button>
    </form>
    {formError && <p role="alert">{formError}</p>}
    <div className="contribution-toolbar"><span>{filters.allTime ? 'All time' : `${filters.from.slice(0, 10)} — ${new Date(Date.parse(filters.until) - 1).toISOString().slice(0, 10)}`} <span className="contribution-muted">· Daily totals (UTC)</span></span><button className="contribution-text-button" type="button" onClick={() => setAttempt(value => value + 1)} aria-label="Refresh contributions">Refresh</button></div>
    {error ? <div className="contribution-empty" role="alert"><h3>Unable to load contributions</h3><p>{error}</p></div> : !report ? <div className="contribution-loading" role="status"><span>Loading contributions…</span><div /><div /><div /></div> : <ContributionResults key={`${filters.actorId}/${filters.from}/${filters.until}/${filters.allTime}/${filters.documentId}`} scope={scope} report={report} roster={members} selectedMember={filters.actorId} name={name} onMember={selectMember} onPage={value => { setOffset(value); setReport(null); }} />}
    </div>
  </Modal>;
}

export function ContributionResults({ scope, report, roster = [], selectedMember = '', name, onMember, onPage }: {
  scope: Scope; report: Report; roster?: TeamMember[]; selectedMember?: string; name: (id: string) => string;
  onMember: (actorId: string) => void; onPage: (offset: number) => void;
}) {
  const [expanded, setExpanded] = useState('');
  const incomplete = report.legacyFiles > 0 || report.importedFiles > 0 || report.filesWithoutHistory > 0;
  const count = (value: number) => value.toLocaleString();
  const accounts = [...new Set([...roster.map(item => item.userId), ...report.members.map(item => item.actorId), ...report.unverifiedMembers.map(item => item.actorId)])];
  const unverified = report.unverifiedMembers.find(member => member.actorId === selectedMember);
  const totals = report.members.find(member => member.actorId === selectedMember);
  return <>
    {!selectedMember && accounts.length > 0 ? <div className="contribution-table-wrap"><table className="contribution-table" aria-label="Contributions by member">
      <thead><tr><th scope="col">Member</th><th scope="col">Edits</th><th scope="col" title="Inserted UTF-16 text units">Added</th><th scope="col" title="Deleted UTF-16 text units">Removed</th><th scope="col">Files</th></tr></thead>
      <tbody>{accounts.map(id => { const member = report.members.find(item => item.actorId === id); return <tr key={id}><th scope="row"><button type="button" className="contribution-text-button" onClick={() => onMember(id)}>{name(id)}</button>{!member && <span className="contribution-member-note">{report.unverifiedMembers.some(item => item.actorId === id) ? 'Unverified history available' : 'No attributed edits'}</span>}</th><td>{member ? count(member.edits) : '—'}</td><td className="contribution-added">{member ? `+${count(member.inserted)}` : '—'}</td><td>{member ? count(member.deleted) : '—'}</td><td>{member ? count(member.files) : '—'}</td></tr>; })}</tbody>
    </table></div> : selectedMember ? <>
      <div className="contribution-member-heading"><h3>{name(selectedMember)}</h3><button type="button" className="contribution-text-button" onClick={() => onMember('')}>All members</button></div>
      {totals && <dl className="contribution-member-totals" aria-label="Member totals">
        <div><dt>{totals.edits === 1 ? 'Edit' : 'Edits'}</dt><dd>{count(totals.edits)}</dd></div>
        <div><dt>Added</dt><dd className="contribution-added">+{count(totals.inserted)}</dd></div>
        <div><dt>Removed</dt><dd>−{count(totals.deleted)}</dd></div>
        <div><dt>{totals.files === 1 ? 'File' : 'Files'}</dt><dd>{count(totals.files)}</dd></div>
      </dl>}
      {unverified && <details className="contribution-details contribution-history-note"><summary>{count(unverified.records)} historical {unverified.records === 1 ? 'update' : 'updates'} · Unverified</summary><p>These older submissions are preserved separately. Their authorship and added/removed totals are unavailable.</p></details>}
      {report.dailyChanges.length > 0 && <div className="contribution-daily-heading"><h4>Daily changes</h4><span>Added / Removed</span></div>}
      {report.dailyChanges.length ? <ul className="contribution-changes">{report.dailyChanges.map(day => {
        const key = `${day.documentId}/${day.actorId}/${day.day}`;
        return <li key={key} className="contribution-day-row">
          <div className="contribution-file-date"><strong>{day.path}{day.deletedFile && <span className="contribution-muted"> · Deleted</span>}</strong><time dateTime={day.day}>{day.day}</time></div>
          <span className="contribution-change-count"><span className="contribution-added">+{count(day.inserted)}</span> −{count(day.deleted)}</span>
          <button className="contribution-text-button" type="button" aria-expanded={expanded === key} aria-controls={`day-${day.documentId}-${day.day}`} onClick={() => setExpanded(current => current === key ? '' : key)}>{expanded === key ? 'Hide changes' : 'View changes'}</button>
          {expanded === key && <div id={`day-${day.documentId}-${day.day}`} className="contribution-expanded"><DailyEvidence scope={scope} day={day} /></div>}
        </li>;
      })}</ul> : <EmptyContributions unknown={!!unverified} />}
      {report.matchingDays > 100 && <nav className="contribution-pagination" aria-label="Daily change pages"><span>{report.offset + 1}–{report.offset + report.dailyChanges.length} of {count(report.matchingDays)}</span><div><button type="button" className="neutral-button" disabled={report.offset === 0} onClick={() => onPage(Math.max(0, report.offset - 100))}>Previous</button><button type="button" className="neutral-button" disabled={report.offset + report.dailyChanges.length >= report.matchingDays} onClick={() => onPage(report.offset + 100)}>Next</button></div></nav>}
    </> : <EmptyContributions unknown={report.unknownRecords > 0} />}
    <footer className="contribution-footer">
      <details className="contribution-details"><summary>{incomplete ? 'Partial history' : 'About this report'}</summary>
        <p>Only verified account edits are counted. Older or imported work may be missing; these counts do not measure performance.</p>
        <dl><div><dt>Files without edit history</dt><dd>{count(report.filesWithoutHistory)}</dd></div><div><dt>Files with legacy history</dt><dd>{count(report.legacyFiles)}</dd></div><div><dt>Files with imported content</dt><dd>{count(report.importedFiles)}</dd></div><div><dt>Unattributed records in this period, all members</dt><dd>{count(report.unknownRecords)}</dd></div></dl>
        <p>Added and removed counts use UTF-16 text units. Retries are excluded. Only recorded shared files are covered; Git history, reviews, tasks, and unsynchronized work are not included.</p>
      </details>
      <span className="contribution-updated">Updated {new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </footer>
  </>;
}

function EmptyContributions({ unknown }: { unknown: boolean }) {
  return <div className="contribution-empty"><span className="contribution-empty-mark" aria-hidden="true">—</span><h3>No attributed edits yet</h3><p>{unknown ? 'Earlier activity exists, but its authorship could not be verified.' : 'No attributed edits match these filters. Try another date range or file.'}</p></div>;
}

export function ContributionsButton({ scope, capabilities }: { scope: Scope; capabilities: TeamCapabilities | null }) {
  const [open, setOpen] = useState(false);
  const { projectId, teamId, workstreamId } = scope;
  const stableScope = useMemo(() => ({ projectId, teamId, workstreamId }), [projectId, teamId, workstreamId]);
  if (!capabilities || capabilities.teamId !== scope.teamId || !['ADMIN', 'TEAM_LEAD'].includes(capabilities.role)) return null;
  return <><button type="button" className="team-section-link" onClick={() => setOpen(true)} aria-haspopup="dialog">Contributions</button>
    {open && createPortal(<Dashboard scope={stableScope} onClose={() => setOpen(false)} />, document.body)}</>;
}
