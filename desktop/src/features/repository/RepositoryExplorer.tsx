import { MaterialIcon } from './MaterialIcon';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { TreeCommand } from './fileTree';
import type { RepositoryFile, RepositoryInfo } from './api';

type Action = { type: 'FILE' | 'DIRECTORY' | 'RENAME' | 'DELETE'; path: string };
type TreeProps = {
  entries: RepositoryFile[]; onOpen: (file: RepositoryFile) => void;
  selected: string | null; onSelect: (path: string | null) => void;
  onAction?: (action: Action) => void;
  onLocation: (folder: string) => void; currentFolder: string; parent?: string; draft?: { parent: string; node: ReactNode };
};
function FileTree({ entries, onOpen, selected, onSelect, onAction, onLocation, currentFolder, parent = '', draft }: TreeProps) {
  const keyboard = (event: KeyboardEvent, path: string) => {
    if (onAction && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault(); onSelect(path);
    }
  };
  return <ul className="m-0 list-none p-0">{draft?.parent === parent && <li>{draft.node}</li>}{entries.map((entry) => <li className="relative" key={entry.path}>
    {entry.directory ? <details ref={(element) => { if (element && draft && (draft.parent === entry.path || draft.parent.startsWith(`${entry.path}/`))) element.open = true; }}><summary className={`explorer-entry ${currentFolder === entry.path ? 'is-current-folder' : ''}`} onClick={() => { onLocation(entry.path); onSelect(null); }} title={entry.path} onContextMenu={(event) => { if (onAction) { event.preventDefault(); event.stopPropagation(); onLocation(entry.directory ? entry.path : parent); onSelect(entry.path); } }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onLocation(entry.directory ? entry.path : parent); keyboard(event, entry.path); }}><svg className="explorer-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg><MaterialIcon name={entry.name} directory /><span>{entry.name}</span></summary><div className="explorer-nesting pl-3"><FileTree entries={entry.children} onOpen={onOpen} selected={selected} onSelect={onSelect} onAction={onAction} onLocation={onLocation} currentFolder={currentFolder} parent={entry.path} draft={draft} /></div></details> : <button className="explorer-entry explorer-file-entry" title={entry.path} type="button" onClick={(event) => { onSelect(null); onLocation(parent); if (event.detail < 2) onOpen(entry); }} onContextMenu={(event) => { if (onAction) { event.preventDefault(); event.stopPropagation(); onLocation(entry.directory ? entry.path : parent); onSelect(entry.path); } }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onLocation(entry.directory ? entry.path : parent); keyboard(event, entry.path); }}><MaterialIcon name={entry.name} /><span>{entry.name}</span></button>}
    {onAction && selected === entry.path && <div className="explorer-item-actions" role="group" aria-label={`Actions for ${entry.path}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onSelect(null); }}>
      {entry.directory && <>
        <button type="button" autoFocus onClick={() => onAction({ type: 'FILE', path: `${entry.path}/` })}>New file</button>
        <button type="button" onClick={() => onAction({ type: 'DIRECTORY', path: `${entry.path}/` })}>New folder</button>
      </>}
      <button type="button" autoFocus={!entry.directory} onClick={() => onAction({ type: 'RENAME', path: entry.path })}>Rename</button>
      <button type="button" onClick={() => onAction({ type: 'DELETE', path: entry.path })}>Delete</button>
    </div>}
  </li>)}</ul>;
}

export function RepositoryExplorer({ projectName, repository, onConnect, onChooseWorkstream, onOpen, onChange, onSync, synced = false, syncing = false }: {
  onChange?: (command: TreeCommand) => Promise<void>; onSync?: () => void; synced?: boolean; syncing?: boolean;
  projectName?: string; repository: RepositoryInfo | null; onConnect: () => void; onChooseWorkstream: () => void; onOpen: (file: RepositoryFile) => void;
}) {
  const treeId = useId();
  const [expanded, setExpanded] = useState(true);
  const [currentFolder, setCurrentFolder] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const begin = (next: Action) => { setExpanded(true); setSelected(null); setAction(next); setPath(next.path); setError(''); };
  if (!repository) return <div className="grid gap-2"><button className="neutral-button-filled w-full" type="button" onClick={onConnect}>Select local folder</button><button className="neutral-button w-full" type="button" onClick={onChooseWorkstream}>Choose team</button></div>;
  return <nav className="repository-explorer" aria-label="Repository files" onKeyDown={(event) => {
    if (event.key === 'Escape' && !busy) { setSelected(null); setAction(null); }
  }}>
    <div className="explorer-project flex items-center justify-between gap-2">
      <button className="explorer-root-toggle min-w-0 flex-1" type="button" aria-expanded={expanded} aria-controls={treeId} title={projectName || repository.name} onClick={() => { setCurrentFolder(''); setSelected(null); setExpanded((value) => !value); }}>
        <svg className="explorer-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        <strong className="min-w-0 truncate text-sm">{projectName || repository.name}</strong>
      </button>
      <div className="flex shrink-0 items-center" role="group" aria-label="Project file actions">
        <button className="explorer-icon-button" type="button" aria-label="Add file" title="Add file" disabled={!onChange || busy} onClick={() => begin({ type: 'FILE', path: currentFolder ? `${currentFolder}/` : '' })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H5v18h9M13 3v6h6l-6-6ZM19 13v8m-4-4h8" /></svg></button>
        <button className="explorer-icon-button" type="button" aria-label="Add folder" title="Add folder" disabled={!onChange || busy} onClick={() => begin({ type: 'DIRECTORY', path: currentFolder ? `${currentFolder}/` : '' })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20H3V5h6l2 3h10v4M18 14v8m-4-4h8" /></svg></button>
        <button className={`explorer-icon-button explorer-sync-icon ${synced ? 'is-synced' : 'is-unsynced'}`} type="button" aria-label={syncing ? 'Not synced — synchronizing files' : synced ? 'Files synced — sync again' : 'Files not synced — retry sync'} title={syncing ? 'Not synced — synchronizing files' : synced ? 'Files synced — sync again' : 'Files not synced — retry sync'} disabled={!onSync || syncing || busy} onClick={onSync}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5" /></svg></button>
      </div>
    </div>
    {action && (action.type === 'RENAME' || action.type === 'DELETE') && <form className="explorer-action-form mb-3 grid gap-2 text-xs" key={`${action.type}/${action.path}`} onSubmit={(event) => {
      event.preventDefault(); if (busy || !onChange) return;
      const command: TreeCommand = { operationId: crypto.randomUUID(), expectedVersion: 0, type: action.type === 'DELETE' ? 'DELETE' : 'RENAME' };
      command.path = action.path; if (command.type === 'RENAME') command.targetPath = path;
      setBusy(true); setError('');
      void onChange(command).then(() => setAction(null)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
    }}>
      {action.type === 'DELETE' ? <p className="m-0 break-words">Delete <strong>{action.path}</strong> for everyone? Local contents will be kept in the recovery folder.</p> : <label>{`Rename ${action.path} to`}<input className="mt-1 block w-full rounded border p-2" autoFocus required disabled={busy} value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/Main.java" /></label>}
      <div className="flex gap-2"><button className="neutral-button" type="submit" autoFocus={action.type === 'DELETE'} disabled={busy || !onChange}>{busy ? 'Applying…' : action.type === 'DELETE' ? 'Delete for everyone' : 'Rename'}</button><button className="neutral-button" type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</button></div>
    </form>}
    {error && <p className="m-0 text-xs" role="alert">{error}</p>}
    <div id={treeId} hidden={!expanded}><FileTree entries={repository.files} onOpen={onOpen} selected={selected} onSelect={setSelected} onAction={onChange && !busy ? begin : undefined} onLocation={setCurrentFolder} currentFolder={currentFolder} draft={action && (action.type === 'FILE' || action.type === 'DIRECTORY') ? {
      parent: action.path.replace(/\/$/, ''),
      node: <InlineCreate key={`${action.type}/${action.path}`} kind={action.type} onCancel={() => setAction(null)} onCommit={(name) => {
        if (!onChange) { setError('Wait for file synchronization, then try again.'); setAction(null); return; }
        const command: TreeCommand = { operationId: crypto.randomUUID(), expectedVersion: 0, type: 'CREATE', entry: { id: crypto.randomUUID(), path: action.path + name, kind: action.type as 'FILE' | 'DIRECTORY' } };
        if (action.type === 'FILE') command.content = '';
        setAction(null); setBusy(true); setError('');
        void onChange(command).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false));
      }} />,
    } : undefined} /></div>
  </nav>;
}

function InlineCreate({ kind, onCommit, onCancel }: { kind: 'FILE' | 'DIRECTORY'; onCommit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const callbacks = useRef({ onCommit, onCancel });
  callbacks.current = { onCommit, onCancel };
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    const value = input.current?.value.trim() ?? '';
    if (value) callbacks.current.onCommit(value);
    else callbacks.current.onCancel();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target !== input.current) commit(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return <div className={`explorer-entry ${kind === 'FILE' ? 'explorer-file-entry' : ''}`}>
    <MaterialIcon name={name} directory={kind === 'DIRECTORY'} expanded={false} />
    <div className="explorer-name-field">
      <span className="explorer-name-measure" aria-hidden="true">{name || ' '}</span>
      <input ref={input} autoFocus aria-label={kind === 'FILE' ? 'File name' : 'Folder name'} value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finished.current = true; callbacks.current.onCancel(); }
      }} />
    </div>
  </div>;
}
