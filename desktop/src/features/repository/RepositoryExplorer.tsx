import type { RepositoryFile, RepositoryInfo } from './api';

function FileTree({ entries, onOpen }: { entries: RepositoryFile[]; onOpen: (file: RepositoryFile) => void }) {
  return <ul className="m-0 list-none p-0">{entries.map((entry) => <li key={entry.path}>
    {entry.directory ? <details><summary className="explorer-entry"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5h6l2 2h9v11h-17z" /></svg><span>{entry.name}</span></summary><div className="border-l border-[#d8d6ce] pl-3"><FileTree entries={entry.children} onOpen={onOpen} /></div></details> : <button className="explorer-entry" type="button" onClick={() => onOpen(entry)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /></svg><span>{entry.name}</span></button>}
  </li>)}</ul>;
}

export function RepositoryExplorer({ repository, onConnect, onChooseWorkstream, onOpen }: { repository: RepositoryInfo | null; onConnect: () => void; onChooseWorkstream: () => void; onOpen: (file: RepositoryFile) => void }) {
  if (!repository) return <div className="grid gap-2"><button className="neutral-button-filled w-full" type="button" onClick={onConnect}>Select local folder</button><button className="neutral-button w-full" type="button" onClick={onChooseWorkstream}>Choose team</button></div>;
  return <nav aria-label="Repository files">
    <div className="mb-3 border-b border-[#d8d6ce] pb-3"><strong className="block truncate text-sm">{repository.name}</strong><span className="mt-1 block truncate font-mono text-[10px] text-[#6d716b]">{repository.branch} · {repository.revision.slice(0, 7)}{repository.modified ? ' · modified' : ''}</span></div>
    <FileTree entries={repository.files} onOpen={onOpen} />
  </nav>;
}
