import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Workstream } from '../projects/api';
import { Modal } from '../../components/Modal';
import { PanelHeader } from '../../components/PanelHeader';
import { HistoryDiff } from '../history/HistoryDiff';
import '../history/history.css';
import { changeLabel, getChanges, getFileDiff, type GitChange, type GitChanges, type GitDiff } from './api';
import './changes.css';

export function ChangesPanel({ root, theme, onClose, workstream }: { root: string | null; theme: 'light' | 'dark'; onClose: () => void; workstream?: Pick<Workstream, 'name' | 'branchName'> | null }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: GitChanges; error?: string; loading: boolean }>({ loading: true });
  const [selected, setSelected] = useState<GitChange | null>(null);
  const [comparison, setComparison] = useState<{ diff?: GitDiff & { path: string }; error?: string }>({});
  useEffect(() => {
    let current = true;
    setState({ loading: true }); setSelected(null); setComparison({});
    if (!root) { setState({ loading: false }); return; }
    void getChanges(root).then(data => { if (current) setState({ data, loading: false }); })
      .catch(error => { if (current) setState({ loading: false, error: String(error) }); });
    return () => { current = false; };
  }, [root, revision]);
  useEffect(() => {
    let current = true;
    setComparison({});
    if (!selected || !root || !state.data) return;
    void getFileDiff(root, selected.path, state.data.revision)
      .then(diff => { if (current) setComparison({ diff: { ...diff, path: selected.path } }); })
      .catch(error => { if (current) setComparison({ error: String(error) }); });
    return () => { current = false; };
  }, [selected, root, state.data]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return <div className="changes-panel p-4">
    <PanelHeader title="Changes" onClose={onClose}>
      <button className="panel-close" type="button" aria-label="Refresh changes" title="Refresh changes" disabled={!root || state.loading} onClick={() => setRevision(value => value + 1)}>↻</button>
    </PanelHeader>
    {!root ? <p className="text-sm">Open a local workstream repository to review changes.</p> : state.loading ? <p role="status">Reading Git changes…</p> : state.error ? <p role="alert">{state.error}</p> : state.data && <>
      <p className="changes-branch" title={`Branch: ${state.data.branch}\n${root}`}>
        {workstream?.branchName === state.data.branch ? `Workspace: ${workstream.name}` : `Branch: ${state.data.branch}`}
      </p>
      <p className="changes-note" title={state.data.revision ?? undefined}>{state.data.revision ? <>Commit: <code>{state.data.revision.slice(0, 8)}</code></> : 'No commits yet'}</p>
      <p className="changes-note">{state.data.files.length} changed {state.data.files.length === 1 ? 'file' : 'files'}</p>
      {!state.data.files.length && <p role="status" className="text-sm">Working tree clean.</p>}
      <ul className="changes-list">{state.data.files.map(file => <li key={file.path}>
        <button type="button" onClick={() => { setComparison({}); setSelected(file); }} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}>
          <span className="changes-path">{file.path}</span>
          {file.originalPath && <span className="changes-note">from {file.originalPath}</span>}
          <span className="changes-status">{changeLabel(file)}</span>
        </button>
      </li>)}</ul>
    </>}
    {selected && createPortal(<Modal title="Git diff" wide onClose={() => setSelected(null)}>
      <p className="changes-diff-path">{selected.originalPath ? `${selected.originalPath} → ` : ''}{selected.path}</p>
      <p className="changes-note">HEAD → Working file</p>
      {comparison.error ? <p role="alert">{comparison.error}</p> : comparison.diff ? <HistoryDiff diff={comparison.diff} format="text" theme={theme} /> : <p role="status">Loading comparison…</p>}
    </Modal>, document.body)}
  </div>;
}
