import type { ProjectRepository, Workstream } from './api';
import type { RepositoryInfo } from '../repository/api';
import { isRepositoryReady } from './sharedWorkspace';

export function SharedWorkspaceSetup({ stream, repository, desktop, canInitialize, busy, error, remote, downloading, canManageRepository, onDownload, onConfigure, onConnect, onInitialize, onRetry, onExplore }: {
  remote?: ProjectRepository | null; downloading?: boolean; canManageRepository?: boolean;
  onDownload?: () => void; onConfigure?: () => void;
  stream: Workstream; repository: RepositoryInfo | null; desktop: boolean; canInitialize: boolean;
  busy: boolean; error: string | null; onConnect: () => void; onInitialize: () => void;
  onRetry: () => void; onExplore: () => void;
}) {
  const ready = isRepositoryReady(stream);
  const dirtySharedBranch = repository?.modified && repository.branch === stream.branchName;
  const separateSnapshot = repository?.modified && repository.branch !== stream.branchName;
  const branchConflict = repository?.branches.includes(stream.branchName) && repository.branch !== stream.branchName;
  return <section className="grid h-full min-h-80 place-items-center px-7 py-8 text-center"><div className="grid max-w-lg justify-items-center gap-4">
    <h2 className="m-0 text-xl font-semibold">{ready ? repository ? 'Your team workspace is ready' : remote ? 'Download the team project' : 'Connect your local project copy' : canInitialize ? 'Set up the shared workspace' : 'Waiting for workspace setup'}</h2>
    <p className="m-0 text-sm leading-relaxed text-[#6d716b]">{!desktop ? 'Open Conflux desktop to connect a local repository and work with your team.' : !ready ? canInitialize ? 'Choose the project repository once to set the shared branch and starting revision for your team.' : 'A team member with setup permission needs to connect the project repository. This page updates when it is ready.' : repository ? 'Open a file in Explorer to work with your team.' : remote ? 'Download a local copy and open the shared branch to work with your team.' : 'A project manager needs to configure the remote for downloads. You can also connect an existing local copy.'}</p>
    {error && <p className="form-notice is-error m-0 w-full border-l-3 px-3 py-2 text-left text-sm" role="alert">{error}</p>}
    {busy && <p className="m-0 text-sm" role="status">{downloading ? 'Downloading and checking the project…' : 'Opening workspace…'}</p>}
    {desktop && remote && (!repository || !!error) && onDownload && <button className="neutral-button-filled" type="button" disabled={busy} onClick={onDownload}>{!ready && canInitialize ? 'Download and set up workspace' : 'Download project'}</button>}
    {desktop && remote && (!repository || !!error) && <p className="m-0 break-all text-xs text-[#6d716b]">{remote.repositoryUrl}{remote.accessMode !== 'PUBLIC' && ' · Requires your Git provider access'}</p>}
    {canManageRepository && onConfigure && <button className="neutral-button" type="button" disabled={busy} onClick={onConfigure}>Repository settings</button>}
    {desktop && ((!ready && canInitialize) || (ready && (!repository || !!error))) && <button className="neutral-button" type="button" disabled={busy} onClick={onConnect}>{repository ? 'Change folder' : 'Select local folder'}</button>}
    {desktop && !ready && canInitialize && repository && <>
      <p className="m-0 break-all text-xs text-[#6d716b]">{repository.name} · {repository.branch} · {repository.revision.slice(0, 7)}</p>
      {(dirtySharedBranch || branchConflict) && <p className="form-notice is-error m-0 text-sm" role="alert">{dirtySharedBranch ? 'This folder already uses the shared branch. Commit or stash its changes before initial setup.' : `Open ${stream.branchName} locally before using it for setup.`}</p>}
      {separateSnapshot && !branchConflict && <p className="m-0 text-sm text-[#6d716b]">Setup will use your last commit in a separate folder. Your uncommitted changes stay in this folder and will not be included.</p>}
      <button className="neutral-button-filled" type="button" disabled={busy || dirtySharedBranch || branchConflict} onClick={onInitialize}>{separateSnapshot ? 'Set up from last commit' : 'Set up shared workspace'}</button>
    </>}
    {desktop && ready && repository && !error && <button className="neutral-button-filled" type="button" disabled={busy} onClick={onExplore}>Open Explorer</button>}
    {error && <button className="neutral-button" type="button" disabled={busy} onClick={onRetry}>Retry</button>}
  </div></section>;
}
