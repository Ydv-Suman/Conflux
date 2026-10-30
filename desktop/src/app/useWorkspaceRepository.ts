import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { EditorFile } from '../features/editor/editorTabs';
import { getDefaultWorkstream, getProjectRepository, type Project, type ProjectRepository, type Workstream } from '../features/projects/api';
import { isRepositoryReady, openSharedRepository } from '../features/projects/sharedWorkspace';
import { isDesktop, readRepositoryFile, restoreRepository, saveLastWorkspace, writeRepositoryFile, type RepositoryInfo } from '../features/repository/api';
import { messageFor } from './messages';
import type { RequestError } from './workspaceTypes';

type Options = {
  project: Project | null; activeWorkstream: Workstream | null; loading: boolean; busy: boolean;
  setActiveWorkstream: Dispatch<SetStateAction<Workstream | null>>;
  setWorkstreams: Dispatch<SetStateAction<Workstream[]>>;
  setRequestError: Dispatch<SetStateAction<RequestError>>;
};
export function useWorkspaceRepository({ project, activeWorkstream, loading, busy, setActiveWorkstream, setWorkstreams, setRequestError }: Options) {
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [openFile, setOpenFile] = useState<EditorFile | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [repositoryAttempt, setRepositoryAttempt] = useState(0);
  const [remoteRepository, setRemoteRepository] = useState<ProjectRepository | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  useEffect(() => {
    setRepository(null); setOpenFile(null); setRepositoryError(null);
    if (!project || !isDesktop() || loading) { setRepositoryLoading(false); return; }
    let cancelled = false;
    setRepositoryLoading(true);
    const restore = async () => {
      const saved = activeWorkstream && isRepositoryReady(activeWorkstream)
        ? await openSharedRepository(activeWorkstream)
        : await restoreRepository(project.projectId, null);
      if (cancelled) return;
      setRepository(saved);
      if (activeWorkstream) {
        await saveLastWorkspace(project.projectId, activeWorkstream.teamId, activeWorkstream.workstreamId);
        if (cancelled) return;
      }
      if (activeWorkstream && isRepositoryReady(activeWorkstream) && saved?.lastOpenedFile) {
        try {
          const content = await readRepositoryFile(saved.lastOpenedFile);
          if (!cancelled) setOpenFile({ path: saved.lastOpenedFile, content });
        } catch { /* The file may have moved. */ }
      }
    };
    void restore().catch((error) => {
      if (!cancelled) setRepositoryError(messageFor(error, 'Unable to open the local shared repository.'));
    }).finally(() => { if (!cancelled) setRepositoryLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectId, activeWorkstream?.workstreamId, activeWorkstream?.currentRevision, repositoryAttempt, loading]);

  useEffect(() => {
    if (!activeWorkstream || isRepositoryReady(activeWorkstream) || busy) return;
    let cancelled = false;
    let checking = false;
    const refresh = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const shared = await getDefaultWorkstream(activeWorkstream.projectId, activeWorkstream.teamId);
        if (!cancelled && isRepositoryReady(shared)) {
          setActiveWorkstream(shared);
          setWorkstreams((current) => current.map((stream) => stream.workstreamId === shared.workstreamId ? shared : stream));
        }
      } catch (error) {
        if (!cancelled) setRepositoryError(messageFor(error, 'Unable to check workspace setup.'));
      } finally { checking = false; }
    };
    const timer = window.setInterval((): void => { void refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [activeWorkstream, busy]);

  useEffect(() => {
    setRemoteRepository(null); setRemoteError(null);
    if (!project || loading) { setRemoteLoading(false); return; }
    let cancelled = false;
    setRemoteLoading(true);
    void getProjectRepository(project.projectId).then((configuration) => { if (!cancelled) setRemoteRepository(configuration); })
      .catch((error) => { if (!cancelled) setRemoteError(messageFor(error, 'Unable to load the shared repository settings.')); })
      .finally(() => { if (!cancelled) setRemoteLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectId, loading, repositoryAttempt]);

  const saveRepositoryFile = useCallback(async (path: string, content: string, previousContent: string) => {
    if (!repository) throw new Error('The local workspace is no longer open.');
    try { await writeRepositoryFile(path, content, repository.path, previousContent); }
    catch (error) { setRequestError({ title: 'Unable to save file', message: messageFor(error, 'The file could not be saved.') }); throw error; }
  }, [repository?.path]);
  return {
    repository, setRepository, openFile, setOpenFile, repositoryLoading, repositoryError, setRepositoryError,
    setRepositoryAttempt, remoteRepository, setRemoteRepository, remoteError, setRemoteError, remoteLoading, saveRepositoryFile
  };
}
