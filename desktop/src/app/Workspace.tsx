import { PanelHeader } from '../components/PanelHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import {
  authenticatedRequest,
  getCurrentUser,
  logout,
  type UserProfile
} from '../features/auth/session';
import { EditorWorkspace } from '../features/editor/EditorWorkspace';
import { EDITOR_FONT_FAMILIES, FILE_FONT_FAMILIES, fontFamilyCss, readFontPreferences, saveFontPreferences } from '../features/editor/FontSettings';
import { InvitationInbox, PendingTeamInvitations, useInvitationInbox } from '../features/invitations/Invitations';
import { ProfilePanel } from '../features/profile/ProfilePanel';
import { ProjectNavigation } from '../features/projects/ProjectNavigation';
import { SharedWorkspaceSetup } from '../features/projects/SharedWorkspaceSetup';
import {
  createProject,
  listProjects,
  removeProjectTeam,
  type Project,
  type Workstream
} from '../features/projects/api';
import { downloadSharedProject } from '../features/projects/projectDownload';
import { initializeSharedWorkspace, isRepositoryReady, openSharedRepository } from '../features/projects/sharedWorkspace';
import { RepositoryExplorer } from '../features/repository/RepositoryExplorer';
import {
  connectRepository,
  isDesktop,
  readRepositoryFile,
  rememberOpenFile,
  selectUnlinkedRepository,
  type RepositoryFile
} from '../features/repository/api';
import { useFileTree } from '../features/repository/useFileTree';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import {
  listTeams,
  removeTeamMember,
  updateTeamMemberRole,
  type TeamInvitation
} from '../features/teams/api';
import { ActivityRail } from './ActivityRail';
import { WorkspaceDialogs } from './WorkspaceDialogs';
import { useWorkspaceRepository } from './useWorkspaceRepository';
import { useWorkspaceSelection } from './useWorkspaceSelection';

import { NoticeView, primaryClass } from '../components/FormControls';
import { TeamMemberList } from '../features/teams/TeamMemberList';
import { messageFor } from './messages';
import { navigate } from './navigation';
import type { Confirmation, Dialog, Panel, RequestError } from './workspaceTypes';

export function Workspace() {
  const invitationInbox = useInvitationInbox();
  const [invitationRevision, setInvitationRevision] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const pendingWorkspace = useRef(false);
  const dirtyPaths = useRef<string[]>([]);
  const canLeaveWorkspace = useCallback(() => !pendingWorkspace.current || window.confirm(
    'Leave this workspace? Unsaved or unsynchronized changes in open tabs may be lost. Save locally or reconnect first to keep them.',
  ), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<Panel>('projects');
  const [openTeamForWork, setOpenTeamForWork] = useState(false);
  const chooseTeamForWork = () => { setOpenTeamForWork(true); setPanel('projects'); };
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [fontPreferences, setFontPreferences] = useState(readFontPreferences);
  useEffect(() => {
    document.documentElement.style.setProperty('--file-name-font-size', `${fontPreferences.fileNames}px`);
    document.documentElement.style.setProperty('--file-name-font-family', fontFamilyCss(FILE_FONT_FAMILIES, fontPreferences.fileFamily));
    saveFontPreferences(fontPreferences);
  }, [fontPreferences]);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('activityPanelWidth'));
    return saved >= 240 && saved <= 520 ? saved : 300;
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [invitationSent, setInvitationSent] = useState(false);
  const [requestError, setRequestError] = useState<RequestError>(null);
  const [busy, setBusy] = useState(false);
  const onOpenShared = useCallback(() => setPanel('explorer'), []);
  const { projects, setProjects, teams, setTeams, project, projectTeams, team, identityTeam,
    members, setMembers, capabilities, workstreams, setWorkstreams, activeWorkstream, setActiveWorkstream,
    loading, notice, setNotice, load } = useWorkspaceSelection(canLeaveWorkspace, onOpenShared);
  const { repository, setRepository, openFile, setOpenFile, repositoryLoading, repositoryError, setRepositoryError,
    setRepositoryAttempt, remoteRepository, setRemoteRepository, remoteError, setRemoteError, remoteLoading, saveRepositoryFile
  } = useWorkspaceRepository({ project, activeWorkstream, loading, busy, setActiveWorkstream, setWorkstreams, setRequestError });
  const treeSync = useFileTree({
    root: repositoryLoading ? undefined : repository?.path, projectId: project?.projectId,
    workstreamId: activeWorkstream?.workstreamId, teamId: activeWorkstream?.teamId, revision: activeWorkstream?.currentRevision
  }, {
    dirtyPaths: () => dirtyPaths.current,
    onTree: (files, entries) => {
      setRepository((previous) => previous ? { ...previous, files } : previous);
      setOpenFile((previous) => {
        if (!previous) return previous;
        const entry = entries.find((item) => item.id === previous.documentId || item.path === previous.path);
        return entry && !previous.documentId ? { ...previous, documentId: entry.id } : previous;
      });
    },
  });

  const downloadProject = async (target: Project, targetTeamId: string) => {
    if (downloadLock.current || busy || repositoryLoading || !canLeaveWorkspace()) return;
    downloadLock.current = true; setBusy(true); setDownloading(true); setRequestError(null);
    try {
      const result = await downloadSharedProject(target, targetTeamId, () => setOpenFile(null));
      if (result) { setDialog(null); await load(target.projectId, targetTeamId); }
    } catch (error) {
      setDialog(null);
      await load(target.projectId, targetTeamId);
      setRequestError({ title: 'Unable to open downloaded project', message: messageFor(error, 'Project download failed. Check your connection and Git access, then retry.') });
    } finally { downloadLock.current = false; setBusy(false); setDownloading(false); }
  };

  const execute = async (action: () => Promise<unknown>, reloadProject = project?.projectId ?? null, reloadTeam = team?.teamId ?? null) => {
    setBusy(true); setNotice(null); setRequestError(null);
    try { await action(); setDialog(null); await load(reloadProject, reloadTeam, false); }
    catch (error) {
      const invalid = error instanceof ApiError && error.status === 400;
      setRequestError({
        title: invalid ? 'Check the details' : 'Unable to complete request',
        message: invalid ? `${error.message}. Enter the correct details and try again.` : messageFor(error, 'The request could not be completed.'),
      });
    }
    finally { setBusy(false); }
  };
  const refreshMemberships = async (invitation: TeamInvitation) => {
    setDialog({ kind: 'joined-team', invitation });
    try {
      const [nextProjects, nextTeams] = await Promise.all([listProjects(), listTeams()]);
      setProjects(nextProjects); setTeams(nextTeams);

    } catch (error) { setNotice({ message: messageFor(error, 'You joined the team, but project access could not refresh. Reopen Projects to try again.') }); }
  };
  const can = (capability: string) => capabilities?.capabilities.includes(capability as never) ?? false;
  const canManageProject = !!project && (project.createdBy === getCurrentUser()?.id || teams.some((item) => ['ADMIN', 'TEAM_LEAD'].includes(item.role) && projectTeams.some((assigned) => assigned.teamId === item.teamId)));
  const assignableTeams = teams.filter((item) => ['ADMIN', 'TEAM_LEAD'].includes(item.role) && !projectTeams.some((assigned) => assigned.teamId === item.teamId));

  const openProfile = async () => { setPanel('profile'); try { setProfile(await authenticatedRequest<UserProfile>('/api/users/me', 'GET')); } catch (error) { setNotice({ message: messageFor(error, 'Unable to load profile.') }); } };
  const signOut = async () => { try { await logout(); navigate('/'); } catch { setNotice({ message: 'Logout could not be confirmed. Try again while connected.' }); } };
  const deleteAccount = async () => {
    await authenticatedRequest('/api/users/me', 'DELETE');
    try { await logout(); } catch { /* The deleted account no longer needs a server logout. */ }
    navigate('/');
  };
  const askToLogOut = () => setConfirmation({ title: 'Log out?', message: pendingWorkspace.current ? 'Logging out will close your open documents. Unsaved or unsynchronized edits may be lost. Save locally or reconnect first to keep them.' : 'Are you sure you want to log out of Conflux on this device?', label: 'Continue', action: signOut });
  const askToDeleteAccount = () => setConfirmation({ title: 'Delete account?', message: 'Are you sure you want to permanently delete your account? This cannot be undone.', label: 'Continue', action: deleteAccount });
  const toggleTheme = () => { const nextTheme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = nextTheme; localStorage.setItem('theme', nextTheme); setTheme(nextTheme); };
  const resizePanel = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const resize = (moveEvent: PointerEvent) => {
      const width = Math.min(520, Math.max(240, moveEvent.clientX - 52));
      setPanelWidth(width); localStorage.setItem('activityPanelWidth', String(width));
    };
    const stop = () => { document.removeEventListener('pointermove', resize); document.removeEventListener('pointerup', stop); };
    document.addEventListener('pointermove', resize); document.addEventListener('pointerup', stop);
  };
  const chooseRepository = async () => {
    if (!canLeaveWorkspace()) return;
    if (busy || repositoryLoading) return;
    if (!isDesktop()) { setRequestError({ title: 'Desktop app required', message: 'Local folder access is available in the Conflux desktop app. Run npm start to test it.' }); return; }
    setBusy(true); setOpenFile(null);
    try {
      if (!project) {
        const selected = await selectUnlinkedRepository();
        if (!selected) return;
        const created = await createProject(selected.repository.name, 'Created from a local repository.');
        await connectRepository(created.projectId, null, selected.path);
        await load(created.projectId, null);
        setPanel('projects');
        return;
      }
      const selected = await selectUnlinkedRepository();
      if (!selected) return;
      await connectRepository(project.projectId, null, selected.path);
      if (activeWorkstream && isRepositoryReady(activeWorkstream)) await openSharedRepository(activeWorkstream, selected.repository);
    } catch (error) { setRequestError({ title: 'Unable to connect repository', message: messageFor(error, 'Select a valid local Git repository.') }); }
    finally { setBusy(false); setRepositoryAttempt((attempt) => attempt + 1); }
  };
  const openRepositoryFile = async (file: RepositoryFile) => {
    if (!activeWorkstream || !isRepositoryReady(activeWorkstream) || !repository || busy || repositoryLoading || repositoryError) { setRequestError({ title: 'Open the shared workspace', message: 'Choose a team and connect its shared repository before opening a collaborative file.' }); return; }
    const entry = treeSync.entries.find((item) => item.path === file.path);
    if (!entry || treeSync.status.phase !== 'connected') { setRequestError({ title: 'File synchronization is pending', message: 'Wait for the file tree to synchronize, or resolve the issue shown in Explorer.' }); return; }
    try { setOpenFile({ path: file.path, content: await readRepositoryFile(file.path), documentId: entry.id }); }
    catch (error) { setRequestError({ title: 'Unable to open file', message: messageFor(error, 'The file could not be opened.') }); }
  };
  const setupSharedWorkspace = async () => {
    if (!activeWorkstream || !repository) return;
    setBusy(true); setRepositoryError(null);
    try {
      const shared = await initializeSharedWorkspace(activeWorkstream, repository);
      setActiveWorkstream(shared);
      setWorkstreams((current) => current.map((stream) => stream.workstreamId === shared.workstreamId ? shared : stream));
      setRepositoryAttempt((attempt) => attempt + 1);
    } catch (error) { setRepositoryError(messageFor(error, 'Unable to set up the shared workspace.')); }
    finally { setBusy(false); }
  };
  const openWorkstream = (stream: Workstream) => { if (!canLeaveWorkspace()) return; setActiveWorkstream(stream); setOpenFile(null); setRepository(null); setPanel('explorer'); };
  const sharedWorkstream = workstreams.find((stream) => stream.defaultWorkstream);

  const workspaceContent = loading ? <p className="p-7" role="status">Loading team workspace…</p> : activeWorkstream && project ? <div className="flex h-full flex-col">

    <div className="min-h-0 flex-1">{openFile && repository && !repositoryError && openFile.documentId && isRepositoryReady(activeWorkstream) ? <EditorWorkspace key={`${project.projectId}/${activeWorkstream.workstreamId}`} projectId={project.projectId} workstreamId={activeWorkstream.workstreamId} teamId={activeWorkstream.teamId} file={openFile} entries={treeSync.entries} treeReady={treeSync.manifestReady} onDirtyPathsChange={(paths) => { dirtyPaths.current = paths; }} theme={theme} fontSize={fontPreferences.editor} fontFamily={fontFamilyCss(EDITOR_FONT_FAMILIES, fontPreferences.editorFamily)} onDirtyStateChange={(dirty) => { pendingWorkspace.current = dirty; }} onSave={saveRepositoryFile} onEmpty={() => setOpenFile(null)} onActivate={async (path) => { try { await rememberOpenFile(project.projectId, activeWorkstream.workstreamId, path); } catch (error) { setRequestError({ title: 'Unable to remember open file', message: messageFor(error, 'The file is open, but could not be remembered for next time.') }); } }} /> : <SharedWorkspaceSetup stream={activeWorkstream} repository={repository} desktop={isDesktop()} canInitialize={can('CREATE_WORKSTREAM')} busy={busy || repositoryLoading || remoteLoading} downloading={downloading} error={repositoryError || remoteError} remote={remoteRepository} canManageRepository={canManageProject} onConfigure={() => setDialog({ kind: 'repository-settings', project })} onDownload={can('JOIN_WORKSTREAM') ? () => void downloadProject(project, team!.teamId) : undefined} onConnect={() => void chooseRepository()} onInitialize={() => void setupSharedWorkspace()} onRetry={() => setRepositoryAttempt((attempt) => attempt + 1)} onExplore={() => setPanel('explorer')} />}</div>

  </div> : !project ? <section className="team-content grid min-h-[420px] place-items-center bg-[#f8f7f2] px-7 text-center">
    <div>
      <h1 className="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h1>
      <p className="mb-0 mt-2 text-sm text-[#6d716b]">Choose a project to view its teams.</p>
    </div>
  </section> : <section className="team-content min-h-[420px] min-w-0 overflow-hidden bg-[#f8f7f2]">

    <header className="border-b border-[#d8d6ce] px-6 py-6">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          {team && <button className="panel-action team-back-button mt-0.5 shrink-0 rounded-xl" type="button" aria-label="Back to project" title="Back to project" disabled={busy || repositoryLoading || loading} onClick={() => void load(project.projectId, null)}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="m-0 truncate text-3xl font-bold tracking-[-.04em]">{team?.name || project.name}</h1>
              {team && identityTeam && can('MANAGE_TEAM') && <button className="inline-edit shrink-0 rounded-lg" type="button" aria-label="Edit team" title="Edit team" onClick={() => setDialog({ kind: 'team', team: identityTeam })}>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z" />
                  <path d="m13.5 6.5 4 4" />
                </svg>
              </button>}
            </div>
            <p className="mb-0 mt-2 max-w-[70ch] text-sm leading-relaxed text-[#6d716b]">{team?.description || project.description || 'No description added.'}</p>
          </div>
        </div>
        {!team && canManageProject ? <button className="neutral-button shrink-0" type="button" onClick={() => setDialog({ kind: 'project', project })}>Edit project</button> : team && canManageProject ? <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => confirm(`Remove ${team.name} from ${project.name}?`) && void execute(() => removeProjectTeam(project.projectId, team.teamId), project.projectId, null)}>Remove team</button> : null}
      </div>
    </header>

    {canManageProject && <div className="px-6 pt-4">
      <button className="neutral-button" type="button" disabled={busy} onClick={() => setDialog({ kind: 'repository-settings', project })}>Repository settings</button>
    </div>}

    {!team ? <section className="px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Teams
          <span className="text-sm font-medium text-[#6d716b]">({projectTeams.length})</span>
        </h3>
        {canManageProject && <div className="flex gap-2">
          {assignableTeams.length > 0 && <button className="neutral-button" type="button" onClick={() => setDialog({ kind: 'assign-team', project, teams: assignableTeams })}>Add team</button>}
          <button className="neutral-button-filled" type="button" onClick={() => setDialog({ kind: 'team', projectId: project.projectId })}>Create team</button>
        </div>}
      </div>
      <div className="mt-4 divide-y divide-[#d8d6ce]">{projectTeams.map((item) => <button className="project-team-row block w-full py-4 text-left" key={item.teamId} type="button" disabled={busy || repositoryLoading || loading} onClick={() => void load(project.projectId, item.teamId)}>
        <strong className="block truncate text-sm">{item.name || 'Unnamed team'}</strong>
        <span className="mt-1 block truncate text-xs text-[#6d716b]">{item.description || 'No description added.'}</span>
      </button>)}</div>
    </section> : identityTeam && capabilities ? <><section className="px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Members</h3>
        {can('MANAGE_MEMBERS') && <button className="neutral-button-filled" type="button" onClick={() => { setNotice(null); setDialog({ kind: 'member', team: identityTeam, capabilities }); }}>Invite member</button>}
      </div>
      <div className="mt-3">
        <NoticeView notice={notice} />
        <TeamMemberList members={members} capabilities={capabilities} busy={busy} onRoleChange={(member, role) => execute(() => updateTeamMemberRole(identityTeam.teamId, member.userId, role))} onRemove={(member) => confirm(`Remove @${member.username}?`) && void execute(() => removeTeamMember(identityTeam.teamId, member.userId))} />
      </div>
      {can('MANAGE_MEMBERS') && <PendingTeamInvitations key={identityTeam.teamId} teamId={identityTeam.teamId} revision={invitationRevision} onMembersChanged={setMembers} />}
    </section><section className="border-t border-[#d8d6ce] px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Team workspace</h3>
            <p className="mb-0 mt-1 text-xs text-[#6d716b]">One shared workspace for everyone on this team.</p>
          </div>
          {sharedWorkstream && <button className="neutral-button-filled" type="button" disabled={busy || repositoryLoading} onClick={() => openWorkstream(sharedWorkstream)}>Open shared workspace</button>}
        </div>
        {workstreams.length ? <div className="mt-4 divide-y divide-[#d8d6ce]">{workstreams.map((stream) => <button className="workstream-row grid w-full gap-3 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" type="button" key={stream.workstreamId} disabled={busy || repositoryLoading} onClick={() => openWorkstream(stream)}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`workstream-status-dot ${stream.status === 'ACTIVE' ? 'is-active' : ''}`} aria-hidden="true" />
              <strong className="truncate text-sm">{stream.name}{stream.defaultWorkstream ? ' · Shared' : ' · Previous work'}</strong>
            </div>
            <span className="ml-4 mt-1 block truncate font-mono text-[11px] text-[#6d716b]">{stream.branchName}</span>
          </div>
          <span className="workstream-open">Open
            <span aria-hidden="true">→</span>
          </span>
        </button>)}</div> : <div className="mt-5 border-l-2 border-[#c7c5bd] py-2 pl-4">
          <strong className="text-sm">Shared workspace unavailable</strong>
          <p className="mb-0 mt-1 text-xs leading-relaxed text-[#6d716b]">Refresh the project to load its shared workspace.</p>
        </div>}
      </section></> : <section className="grid min-h-64 place-items-center px-7 py-12 text-center">
      <div>
        <h3 className="m-0 text-lg font-semibold">Team access is limited</h3>
        <p className="mb-0 mt-2 max-w-[42ch] text-sm leading-relaxed text-[#6d716b]">You can see this team belongs to the project, but its members and workstreams are available only to team members.</p>
      </div>
    </section>}

  </section>;

  return <main className={`app-workspace min-h-dvh bg-[#f8f7f2] ${panel ? 'activity-panel-open' : ''}`} style={{ '--activity-panel-width': `${panelWidth}px` } as React.CSSProperties}>

    <ActivityRail panel={panel} setPanel={setPanel} invitationInbox={invitationInbox} openProfile={openProfile} onProjects={() => { setOpenTeamForWork(false); setPanel(panel === 'projects' && !openTeamForWork ? null : 'projects'); }} />

    {panel && <aside className="activity-panel fixed bottom-1 left-13 top-1 z-10 overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#efede6]" aria-label="Activity panel">
      <div className="activity-panel-surface">
        {panel === 'explorer' && <div className="p-4">
          <div className="mb-4">
            <PanelHeader title="Explorer" onClose={() => setPanel(null)}>
              <button className="panel-close shrink-0" type="button" title="Switch team" aria-label="Switch team" onClick={chooseTeamForWork}>
                <svg className="size-4 fill-none stroke-current stroke-[1.6]" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
                </svg>
              </button>
            </PanelHeader>
          </div>
          {treeSync.status.message && treeSync.status.phase !== 'connected' && <div className="mb-3 text-xs" role="status">{treeSync.status.message}{treeSync.status.phase === 'error' && <button type="button" className="neutral-button mt-2" onClick={treeSync.retry}>Retry file sync</button>}{treeSync.status.phase === 'error' && <button type="button" className="neutral-button mt-2" onClick={() => { if (window.confirm('Reconcile using the current local tree? Missing shared files will be published as deletions, and local additions or moves will be shared. Review your files first.')) treeSync.reconcile(); }}>Use reviewed local tree</button>}</div>}
          <RepositoryExplorer key={repository?.path ?? 'no-repository'} onSync={activeWorkstream ? treeSync.retry : undefined} synced={treeSync.status.phase === 'connected'} syncing={!!treeSync.status.message && treeSync.status.phase === 'connecting'} onChange={activeWorkstream && treeSync.status.phase === 'connected' ? treeSync.edit : undefined} projectName={project?.name} repository={activeWorkstream && (!isRepositoryReady(activeWorkstream) || repositoryError || repositoryLoading) ? null : repository} onConnect={() => void chooseRepository()} onChooseWorkstream={chooseTeamForWork} onOpen={(file) => void openRepositoryFile(file)} />
        </div>}
        {panel === 'projects' && <ProjectNavigation projects={projects} project={project} projectTeams={projectTeams} team={team} openShared={openTeamForWork} disabled={busy || repositoryLoading || loading} onSelect={load} onCreate={() => setDialog({ kind: 'project' })} onClose={() => setPanel(null)} />}
        {panel === 'invitations' && <InvitationInbox disabled={busy || repositoryLoading} inbox={invitationInbox} onAccepted={refreshMemberships} />}
        {panel === 'profile' && <ProfilePanel profile={profile} onClose={() => setPanel(null)} onEdit={() => { if (profile) setDialog({ kind: 'profile', profile }); }} onLogout={askToLogOut} onDelete={askToDeleteAccount} />}
        {panel === 'settings' && <SettingsPanel theme={theme} onToggleTheme={toggleTheme} onFonts={() => setDialog({ kind: 'fonts' })} onClose={() => setPanel(null)} />}
      </div>
      <button className="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" type="button" aria-label="Resize activity panel" title="Drag to resize" onPointerDown={resizePanel} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setPanelWidth(Math.max(240, panelWidth - 20)); if (event.key === 'ArrowRight') setPanelWidth(Math.min(520, panelWidth + 20)); }}></button>

    </aside>}

    <section className={`editor-stage m-1 min-h-[calc(100dvh-.5rem)] rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] ${activeWorkstream ? 'overflow-hidden' : 'px-4 py-8 sm:px-8 lg:px-12 lg:py-10'}`}>

      <div className={activeWorkstream ? 'h-[calc(100dvh-.5rem)] w-full' : 'mx-auto w-full max-w-[1400px]'}>
        <div className={activeWorkstream ? 'h-full' : ''} id="team-workspace">{workspaceContent}</div>
        {!activeWorkstream && <div className="mt-4">
          <NoticeView notice={notice} />
        </div>}
      </div>

    </section>

    <WorkspaceDialogs dialog={dialog} setDialog={setDialog} busy={busy} setBusy={setBusy}
      notice={notice} setNotice={setNotice} fontPreferences={fontPreferences} setFontPreferences={setFontPreferences}
      repositoryLoading={repositoryLoading} downloading={downloading} repository={repository} project={project}
      downloadProject={downloadProject} load={load} execute={execute} setRemoteRepository={setRemoteRepository}
      setRemoteError={setRemoteError} setProfile={setProfile}
      onInvitationSent={() => { setInvitationRevision((current) => current + 1); setInvitationSent(true); }} />

    {invitationSent && <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={() => setInvitationSent(false)} aria-labelledby="invitation-sent-title" aria-describedby="invitation-sent-message" className="confirmation-dialog fixed left-1/2 top-1/2 m-0 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#c7c5bd] bg-[#f8f7f2] p-6 text-[#1d211e] shadow-xl backdrop:bg-black/45">
      <h2 id="invitation-sent-title" className="m-0 text-xl font-bold">Invitation sent</h2>
      <p id="invitation-sent-message" className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]">Invitation sent. The user will join after accepting.</p>
      <button className={`${primaryClass} w-full`} type="button" autoFocus onClick={() => setInvitationSent(false)}>OK</button>
    </dialog>}

    {confirmation && <div className="fixed inset-0 z-[60] grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}>
      <section className="confirmation-dialog w-full max-w-[390px] border border-[#c7c5bd] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
        <h2 className="m-0 text-xl font-bold tracking-[-.03em]" id="confirmation-title">{confirmation.title}</h2>
        <p className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="confirmation-message">{confirmation.message}</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="neutral-button" type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
          <button className="danger-button" type="button" disabled={busy} onClick={() => { const action = confirmation.action; setBusy(true); void action().catch((error) => setNotice({ message: messageFor(error, 'The action could not be completed.') })).finally(() => { setBusy(false); setConfirmation(null); }); }}>{busy ? 'Please wait…' : confirmation.label}</button>
        </div>
      </section>
    </div>}

    {requestError && <div className="fixed inset-0 z-[70] grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && setRequestError(null)}>
      <section className="confirmation-dialog w-full max-w-[420px] border border-[#c9786f] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="request-error-title" aria-describedby="request-error-message">
        <h2 className="m-0 text-xl font-bold tracking-[-.03em]" id="request-error-title">{requestError.title}</h2>
        <p className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="request-error-message">{requestError.message}</p>
        <div className={`grid gap-3 ${requestError.action ? 'grid-cols-2' : ''}`}>
          <button className="neutral-button" type="button" onClick={() => setRequestError(null)}>{requestError.action ? 'Close' : 'Correct the details'}</button>
          {requestError.action && <button className="neutral-button-filled" type="button" disabled={busy} autoFocus onClick={() => { const retry = requestError.action!; setBusy(true); void retry().then(() => setRequestError(null)).catch((error) => setRequestError((current) => current ? { ...current, message: messageFor(error, 'The local Git worktree could not be created.') } : null)).finally(() => setBusy(false)); }}>{busy ? 'Please wait…' : requestError.actionLabel}</button>}
        </div>
      </section>
    </div>}

  </main>;
}

