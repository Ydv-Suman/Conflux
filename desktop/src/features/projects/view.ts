import { escapeHtml } from '../../html';
import type { Team, TeamCapabilities, TeamMember } from '../teams/api';
import type { Project, ProjectTeam, Workstream } from './api';

const memberName = (member: TeamMember) =>
  member.fullName?.trim() || member.username || 'Team member';

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const projectForm = (project?: Project) => `
  <form class="grid gap-4" id="project-form" data-project-id="${escapeHtml(project?.projectId ?? '')}">
    <label class="field-label">Project name<input class="field-input" name="name" maxlength="100" required value="${escapeHtml(project?.name ?? '')}" placeholder="Payments Platform"></label>
    <label class="field-label">Description (optional)<textarea class="field-input min-h-28 resize-y" name="description" maxlength="500" placeholder="What this project owns">${escapeHtml(project?.description ?? '')}</textarea></label>
    <button class="neutral-button-filled justify-self-center" data-label="${project ? 'Save project' : 'Create project'}" type="submit">${project ? 'Save project' : 'Create project'}</button>
    <output class="hidden text-xs text-[#7f342e]" id="project-form-message" role="alert"></output>
  </form>`;

export const projectPanelView = (project?: Project) => `
  <header class="flex items-start justify-between border-b border-[#d8d6ce] px-7 pb-6 pt-8"><div>${project ? '<p class="mb-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">Project settings</p>' : ''}<h2 class="m-0 text-3xl font-bold tracking-[-.04em]">${project ? 'Edit project' : 'Create project'}</h2></div><button class="panel-close" type="button" aria-label="Close project panel">×</button></header>
  <div class="p-7">${projectForm(project)}</div>`;

export const workstreamPanelView = (project: Project, team: ProjectTeam) => `
  <header class="flex items-start justify-between border-b border-[#d8d6ce] px-7 pb-6 pt-8"><div><p class="mb-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">${escapeHtml(project.name)} · ${escapeHtml(team.name)}</p><h2 class="m-0 text-3xl font-bold tracking-[-.04em]">Create workstream</h2></div><button class="panel-close" type="button" aria-label="Close workstream panel">×</button></header>
  <form class="grid gap-4 p-7" id="workstream-form" data-project-id="${escapeHtml(project.projectId)}" data-team-id="${escapeHtml(team.teamId)}">
    <label class="field-label">Name<input class="field-input" name="name" maxlength="100" required placeholder="Refresh-token rotation"></label>
    <label class="field-label">Branch name<input class="field-input font-mono" name="branchName" maxlength="200" required placeholder="feature/auth-refresh"></label>
    <label class="field-label">Base revision<input class="field-input font-mono" name="baseRevision" minlength="7" maxlength="64" pattern="[0-9a-fA-F]{7,64}" required placeholder="7f9a21c"></label>
    <button class="neutral-button-filled justify-self-center" data-label="Create workstream" type="submit">Create workstream</button>
    <output class="hidden text-xs text-[#7f342e]" id="workstream-form-message" role="alert"></output>
  </form>`;

export const projectsLoadingView = `
  <div class="team-shell grid gap-px overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#d8d6ce] md:grid-cols-[270px_minmax(0,1fr)]" aria-busy="true"><div class="grid content-start gap-3 bg-[#efede6] p-4"><div class="h-10 animate-pulse rounded-lg bg-[#dedcd4]"></div><div class="h-9 animate-pulse rounded-lg bg-[#dedcd4]"></div><div class="h-9 animate-pulse rounded-lg bg-[#dedcd4]"></div></div><div class="min-h-[420px] bg-[#f8f7f2] p-7"><div class="h-9 w-56 animate-pulse rounded-lg bg-[#dedcd4]"></div><div class="mt-4 h-4 w-96 max-w-full animate-pulse rounded bg-[#e3e1da]"></div></div></div>`;

export const projectsErrorView = (message: string) => `
  <div class="team-shell grid gap-px overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#d8d6ce] md:grid-cols-[270px_minmax(0,1fr)]"><nav class="team-sidebar bg-[#efede6] p-4" aria-label="Projects"><h2 class="m-0 px-1 text-base font-semibold">PROJECTS</h2></nav><section class="team-content grid min-h-[420px] place-items-center bg-[#f8f7f2] p-7 text-center"><div><p class="m-0 text-sm font-semibold text-[#7f342e]">${escapeHtml(message)}</p><button class="neutral-button mt-4" id="retry-projects" type="button">Try again</button></div></section></div>`;

const workstreamList = (workstreams: Workstream[], canCreate: boolean) => `
  <section class="border-t border-[#d8d6ce] px-6 py-6"><div class="flex items-center justify-between gap-4"><h3 class="m-0 text-lg font-semibold tracking-[-.02em]">Workstreams</h3>${canCreate ? '<button class="neutral-button-filled" id="open-create-workstream" type="button">Create workstream</button>' : ''}</div>
    ${workstreams.length ? `<div class="mt-4 divide-y divide-[#d8d6ce]">${workstreams.map((workstream) => `<article class="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div class="min-w-0"><strong class="block truncate text-sm">${escapeHtml(workstream.name)}</strong><span class="mt-1 block truncate font-mono text-[11px] text-[#6d716b]">${escapeHtml(workstream.branchName)}</span></div><span class="rounded-full bg-[#e3e1da] px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[.04em]">${label(workstream.status)}</span></article>`).join('')}</div>` : '<p class="mb-0 mt-4 text-sm text-[#6d716b]">No workstreams for this team yet.</p>'}
  </section>`;

export const projectWorkspaceView = (
  projects: Project[], activeProject: Project | null, projectTeams: ProjectTeam[],
  activeTeam: ProjectTeam | null, identityTeam: Team | null, members: TeamMember[],
  capabilities: TeamCapabilities | null, workstreams: Workstream[],
  canCreateProject: boolean, canManageProject: boolean,
) => {
  const canManageTeam = Boolean(capabilities?.capabilities.some((capability) =>
    ['MANAGE_TEAM', 'MANAGE_MEMBERS', 'MANAGE_ROLES'].includes(capability)));
  const canCreateWorkstream = Boolean(capabilities?.capabilities.includes('CREATE_WORKSTREAM'));
  const sidebar = `
    <nav class="team-sidebar bg-[#efede6] p-4" aria-label="Projects">
      <div class="mb-4 flex items-center justify-between gap-3 px-1">
        <h2 class="m-0 text-base font-semibold tracking-[-.02em]">PROJECTS</h2>
        ${canCreateProject ? '<button class="neutral-button project-create-compact" id="open-create-project" type="button">Create</button>' : ''}
      </div>
      <div class="grid gap-1">
        ${projects.map((project) => `
          <button class="team-section-link project-switch ${project.projectId === activeProject?.projectId ? 'is-active' : ''}" data-project-id="${escapeHtml(project.projectId)}" type="button" aria-expanded="${project.projectId === activeProject?.projectId}">
            <span class="truncate">${escapeHtml(project.name)}</span>
            <svg class="size-3 shrink-0 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
          </button>
          ${project.projectId === activeProject?.projectId ? `
            <div class="ml-4 grid gap-1 border-l border-[#c7c5bd] pl-2">
              <p class="project-nav-heading">TEAMS</p>
              ${projectTeams.map((team) => `<button class="team-section-link project-team-switch ${team.teamId === activeTeam?.teamId ? 'is-active' : ''}" data-team-id="${escapeHtml(team.teamId)}" type="button"><span class="truncate">${escapeHtml(team.name || 'Unnamed team')}</span></button>`).join('')}
              <p class="project-nav-heading mt-2">PROJECT TOOLS</p>
              <button class="team-section-link" type="button" disabled title="Project-wide chat will be connected through Collaboration Service">Project chat<span class="team-section-status">Later</span></button>
            </div>` : ''}`)
          .join('')}
      </div>
    </nav>`;

  if (!activeProject) {
    return `<div class="team-shell grid gap-px overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#d8d6ce] md:grid-cols-[270px_minmax(0,1fr)]">${sidebar}<section class="team-content grid min-h-[420px] place-items-center bg-[#f8f7f2] px-7 text-center"><div><h1 class="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h1><p class="mb-0 mt-2 text-sm text-[#6d716b]">Choose a project to view its teams.</p></div></section></div>`;
  }

  const header = `<header class="border-b border-[#d8d6ce] px-6 py-6"><div class="flex items-start justify-between gap-5"><div class="flex min-w-0 items-start gap-3">${activeTeam ? '<button class="panel-action team-back-button mt-0.5 shrink-0 rounded-xl" id="back-to-project" type="button" aria-label="Back to project" title="Back to project"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>' : ''}<div class="min-w-0"><h1 class="m-0 truncate text-3xl font-bold tracking-[-.04em]">${escapeHtml(activeTeam?.name || activeProject.name)}</h1><p class="mb-0 mt-2 max-w-[70ch] text-sm leading-relaxed text-[#6d716b]">${escapeHtml(activeTeam?.description || activeProject.description || 'No description added.')}</p></div></div><div class="flex shrink-0 gap-2">${!activeTeam && canManageProject ? '<button class="neutral-button" id="open-edit-project" type="button">Edit project</button>' : ''}${activeTeam && canManageTeam ? '<button class="neutral-button" id="open-team-settings" type="button">Edit team</button>' : ''}</div></div></header>`;
  const content = activeTeam ? (identityTeam && capabilities ? `<section class="px-6 py-6"><div class="flex items-center justify-between"><h3 class="m-0 text-lg font-semibold tracking-[-.02em]">Members</h3><span class="text-xs text-[#6d716b]">Your role: ${label(capabilities.role)}</span></div><div class="mt-3 divide-y divide-[#d8d6ce]">${members.map((member) => `<article class="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div class="min-w-0"><strong class="block truncate text-sm">${escapeHtml(memberName(member))}</strong><span class="mt-1 block truncate text-xs text-[#6d716b]">@${escapeHtml(member.username)} · Joined ${new Date(member.joinedAt).toLocaleDateString()}</span></div><span class="text-xs text-[#59616c]">${label(member.role)}</span></article>`).join('')}</div></section>${workstreamList(workstreams, canCreateWorkstream)}` : `<section class="grid min-h-64 place-items-center px-7 py-12 text-center"><div><h3 class="m-0 text-lg font-semibold">Team access is limited</h3><p class="mb-0 mt-2 max-w-[42ch] text-sm leading-relaxed text-[#6d716b]">You can see this team belongs to the project, but its members and workstreams are available only to team members.</p></div></section>`) : `<section class="px-6 py-6"><div class="flex items-center justify-between gap-4"><h3 class="m-0 text-lg font-semibold tracking-[-.02em]">Teams <span class="text-sm font-medium text-[#6d716b]">(${projectTeams.length})</span></h3>${canManageProject ? '<button class="neutral-button-filled open-create-team" type="button">Create team</button>' : ''}</div><div class="mt-4 divide-y divide-[#d8d6ce]">${projectTeams.map((team) => `<button class="project-team-row block w-full py-4 text-left" data-team-id="${escapeHtml(team.teamId)}" type="button"><strong class="block truncate text-sm">${escapeHtml(team.name || 'Unnamed team')}</strong><span class="mt-1 block truncate text-xs text-[#6d716b]">${escapeHtml(team.description || 'No description added.')}</span></button>`).join('')}</div></section>`;
  return `<div class="team-shell grid gap-px overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#d8d6ce] md:grid-cols-[270px_minmax(0,1fr)]">${sidebar}<section class="team-content min-h-[420px] min-w-0 overflow-hidden bg-[#f8f7f2]">${header}${content}</section></div>`;
};
