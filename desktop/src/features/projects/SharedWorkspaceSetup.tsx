import type { Workstream } from './api';
import type { RepositoryInfo } from '../repository/api';
import { isRepositoryReady } from './sharedWorkspace';

export function SharedWorkspaceSetup({ stream, repository, desktop, canInitialize, busy, error, onConnect, onInitialize, onRetry, onExplore }: {
  stream: Workstream; repository: RepositoryInfo | null; desktop: boolean; canInitialize: boolean;
  busy: boolean; error: string | null; onConnect: () => void; onInitialize: () => void;
  onRetry: () => void; onExplore: () => void;
}) {
  const ready = isRepositoryReady(stream);
  const branchConflict = repository?.branches.includes(stream.branchName) && repository.branch !== stream.branchName;
  return <section className="grid h-full min-h-80 place-items-center px-7 py-8 text-center"><div className="grid max-w-lg justify-items-center gap-4">
    <h2 className="m-0 text-xl font-semibold">{ready ? repository ? 'Your team workspace is ready' : 'Connect your local project copy' : canInitialize ? 'Set up the shared workspace' : 'Waiting for workspace setup'}</h2>
    <p className="m-0 text-sm leading-relaxed text-[#6d716b]">{!desktop ? 'Open Conflux desktop to connect a local repository and work with your team.' : !ready ? canInitialize ? 'Choose the project repository once to set the shared branch and starting revision for your team.' : 'A team member with setup permission needs to connect the project repository. This page updates when it is ready.' : repository ? 'Open a file in Explorer to work with your team.' : 'Choose an existing local clone of this project. Conflux will open the shared branch. Automatic project download is not available yet.'}</p>
    {error && <p className="form-notice is-error m-0 w-full border-l-3 px-3 py-2 text-left text-sm" role="alert">{error}</p>}
    {busy && <p className="m-0 text-sm" role="status">Opening workspace…</p>}
    {desktop && ((!ready && canInitialize) || (ready && (!repository || !!error))) && <button className="neutral-button" type="button" disabled={busy} onClick={onConnect}>{repository ? 'Choose another folder' : 'Select local folder'}</button>}
    {desktop && !ready && canInitialize && repository && <>
      <p className="m-0 break-all text-xs text-[#6d716b]">{repository.name} · {repository.branch} · {repository.revision.slice(0, 7)}</p>
      {(repository.modified || branchConflict) && <p className="form-notice is-error m-0 text-sm" role="alert">{repository.modified ? 'Commit or stash local changes before setup.' : `Open ${stream.branchName} locally before using it for setup.`}</p>}
      <button className="neutral-button-filled" type="button" disabled={busy || repository.modified || branchConflict} onClick={onInitialize}>Set up shared workspace</button>
    </>}
    {desktop && ready && repository && !error && <button className="neutral-button-filled" type="button" disabled={busy} onClick={onExplore}>Open Explorer</button>}
    {error && <button className="neutral-button" type="button" disabled={busy} onClick={onRetry}>Retry</button>}
  </div></section>;
}
