import { getDefaultWorkstream, getProjectRepository, type Project } from './api';
import { getMyTeamCapabilities } from '../teams/api';
import { downloadRepository, isDesktop, selectDownloadFolder, restoreRepository } from '../repository/api';
import { initializeSharedWorkspace, isRepositoryReady, openSharedRepository, validateSharedRepository } from './sharedWorkspace';

export async function downloadSharedProject(project: Pick<Project, 'projectId' | 'name'>, teamId: string, onStart: () => void = () => {}) {
  const { projectId, name } = project;
  if (!isDesktop()) throw new Error('Open Conflux desktop to download project files.');
  // The destination picker is consent to download; cancellation leaves membership and files unchanged.
  const parent = await selectDownloadFolder();
  if (!parent) return null;
  const [configuration, current, capabilities] = await Promise.all([
    getProjectRepository(projectId), getDefaultWorkstream(projectId, teamId), getMyTeamCapabilities(teamId),
  ]);
  if (!configuration) throw new Error('A project manager needs to configure the shared repository before it can be downloaded.');
  if (!capabilities.capabilities.includes('JOIN_WORKSTREAM')) throw new Error('Your team role does not allow joining a shared workspace.');
  onStart();
  if (isRepositoryReady(current)) {
    const saved = await restoreRepository(projectId, current.workstreamId);
    if (saved) { validateSharedRepository(current, saved); return { stream: current, repository: saved }; }
  }
  const local = await downloadRepository(configuration, parent, current.branchName,
    isRepositoryReady(current) ? current.currentRevision! : configuration.canonicalRevision, name);
  const stream = !isRepositoryReady(current) && capabilities.capabilities.includes('CREATE_WORKSTREAM')
    ? await initializeSharedWorkspace(current, local) : current;
  // Re-read after the download: setup or access may have changed while Git was running.
  const latest = await getDefaultWorkstream(projectId, teamId);
  const access = await getMyTeamCapabilities(teamId);
  if (!access.capabilities.includes('JOIN_WORKSTREAM')) throw new Error('Team access changed during download. Your local copy was preserved.');
  if (isRepositoryReady(latest)) return { stream: latest, repository: await openSharedRepository(latest, local) };
  return { stream, repository: local };
}
