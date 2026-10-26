import { ApiError } from '../../api';
import { useEffect, useState } from 'react';
import { isDesktop, readRepositoryMetadata, type RepositoryMetadata } from '../repository/api';
import { getProjectRepository, updateProjectRepository, type ProjectRepository, type RepositoryAccessMode } from './api';

export function configurationFromGit(metadata?: RepositoryMetadata) {
  const repositoryUrl = metadata?.remoteUrl ?? '';
  return { repositoryUrl, accessMode: (repositoryUrl.startsWith('ssh://') ? 'SSH_AGENT' : 'HTTPS_CREDENTIAL_HELPER') as RepositoryAccessMode,
    canonicalBranch: metadata?.branch ?? '', canonicalRevision: metadata?.revision ?? '' };
}

export function RepositorySettings({ projectId, localPath, onSaved }: {
  projectId: string; localPath?: string; onSaved: (configuration: ProjectRepository) => void;
}) {
  const [configuration, setConfiguration] = useState(configurationFromGit());
  const [detectionNote, setDetectionNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoaded(false); setError(null);
    void getProjectRepository(projectId).then(async (current) => {
      if (cancelled) return;
      if (current) {
        setConfiguration(current); setVersion(current.version); setDetectionNote(null);
      } else {
        let metadata: RepositoryMetadata | undefined;
        if (localPath && isDesktop()) {
          try { metadata = await readRepositoryMetadata(localPath); }
          catch { /* Manual entry stays available if the local repository cannot be inspected. */ }
        }
        if (cancelled) return;
        setConfiguration(configurationFromGit(metadata)); setVersion(0);
        setDetectionNote(metadata ? metadata.remoteUrl
          ? 'Filled from your local Git repository. Confirm the branch and commit are pushed.' + (metadata.remoteUrl.startsWith('https://') ? ' HTTPS visibility cannot be detected locally; choose Public HTTPS if appropriate.' : '')
          : 'Git branch and commit detected, but no supported remote was selected. Add a remote URL below.'
          : 'Connect a local Git repository to detect these settings, or enter them below.');
      }
      setLoaded(true);
    }).catch(() => { if (!cancelled) setError('Repository settings could not load. Reload before saving.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, localPath, attempt]);
  return <form className="grid gap-4" onSubmit={async (event) => {
    event.preventDefault(); if (loading || saving || !loaded) return;
    setSaving(true); setError(null);
    try {
      // Send only the editable fields; the server owns the version and project identity.
      const { repositoryUrl, accessMode, canonicalBranch, canonicalRevision } = configuration;
      onSaved(await updateProjectRepository(projectId, { repositoryUrl, accessMode, canonicalBranch, canonicalRevision }, version));
    } catch (failure) { if (failure instanceof ApiError && failure.status === 409) setLoaded(false); setError(failure instanceof Error ? failure.message : 'Repository settings could not be saved.'); }
    finally { setSaving(false); }
  }}>
    <p className="m-0 text-sm text-[#6d716b]">Use a remote that your team can access. Push the project files and shared commits there before inviting members to download.</p>
    {detectionNote && !loading && <p className="m-0 text-xs text-[#6d716b]" role="status">{detectionNote}</p>}
    {loading ? <p role="status">Loading repository settings…</p> : <>
      <label className="field-label">Repository URL<input className="field-input" required maxLength={2048} value={configuration.repositoryUrl} placeholder="https://github.com/team/project.git" onChange={(e) => setConfiguration({ ...configuration, repositoryUrl: e.target.value })} /></label>
      <label className="field-label">Access<select className="field-input" value={configuration.accessMode} onChange={(e) => setConfiguration({ ...configuration, accessMode: e.target.value as RepositoryAccessMode })}><option value="PUBLIC">Public HTTPS</option><option value="HTTPS_CREDENTIAL_HELPER">HTTPS · My Git credentials</option><option value="SSH_AGENT">SSH · My SSH agent</option></select></label>
      <label className="field-label">Canonical branch<input className="field-input" required maxLength={200} value={configuration.canonicalBranch} onChange={(e) => setConfiguration({ ...configuration, canonicalBranch: e.target.value })} /></label>
      <label className="field-label">Published commit<input className="field-input font-mono" required pattern="([0-9a-fA-F]{40}|[0-9a-fA-F]{64})" title="Enter the full Git commit hash available on the remote branch." value={configuration.canonicalRevision} onChange={(e) => setConfiguration({ ...configuration, canonicalRevision: e.target.value })} /></label>
      <p className="m-0 text-xs text-[#6d716b]">Private repositories use each member’s own Git credentials. Do not include passwords or tokens in the URL.</p>
      <button className="neutral-button-filled" type="submit" disabled={saving || !loaded}>{saving ? 'Saving…' : 'Save repository settings'}</button>
    </>}
    {error && <div role="alert"><p className="form-notice is-error">{error}</p><button type="button" className="neutral-button" disabled={loading || saving} onClick={() => setAttempt((value) => value + 1)}>Reload settings</button></div>}
  </form>;
}
