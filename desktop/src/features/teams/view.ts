import { escapeHtml } from '../../html';
import type { Capability, Team, TeamCapabilities, TeamMember, UserRole } from './api';

export type TeamSection = 'all-teams' | 'members';

const roleLabel = (role?: UserRole) => (role ?? 'VIEWER').replaceAll('_', ' ').toLowerCase()
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const memberName = (member: TeamMember) => member.fullName?.trim() || member.username || 'Team member';

const roles: UserRole[] = ['ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER'];
const roleRank: Record<UserRole, number> = {
  ADMIN: 0,
  TEAM_LEAD: 1,
  SENIOR_DEVELOPER: 2,
  DEVELOPER: 3,
  VIEWER: 4,
};

const hasCapability = (capabilities: TeamCapabilities, capability: Capability) =>
  capabilities.capabilities.includes(capability);

const canManageMember = (actor: TeamCapabilities, target: TeamMember) =>
  actor.role === 'ADMIN' || roleRank[actor.role] < roleRank[target.role];

const assignableRoles = (actor: TeamCapabilities) =>
  actor.role === 'ADMIN' ? roles : roles.filter((role) => roleRank[role] > roleRank[actor.role]);

const roleOptions = (availableRoles: UserRole[], selected?: UserRole) => availableRoles
  .map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${roleLabel(role)}</option>`)
  .join('');

export const teamsLoadingView = `
  <div class="grid gap-5" aria-busy="true">
    <div class="h-12 w-56 animate-pulse bg-[#dedcd4]"></div>
    <div class="grid gap-px bg-[#d8d6ce] md:grid-cols-[240px_1fr]">
      <div class="h-72 animate-pulse bg-[#efede6]"></div>
      <div class="h-72 animate-pulse bg-[#f8f7f2]"></div>
    </div>
  </div>`;

export const teamsErrorView = (message: string) => `
  <section class="border-l-3 border-[#a54d45] bg-[#f8eae7] p-6">
    <p class="m-0 text-sm font-semibold text-[#7f342e]">${escapeHtml(message)}</p>
    <button class="neutral-button mt-4" id="retry-teams" type="button">Try again</button>
  </section>`;

export const teamsView = (
  teams: Team[],
  selected: Team | null,
  members: TeamMember[],
  capabilities: TeamCapabilities | null,
  activeSection: TeamSection = 'all-teams',
  teamsExpanded = false,
) => {
  if (!selected || !capabilities) {
    return `
      <div class="team-shell grid gap-px md:grid-cols-[240px_minmax(0,1fr)]">
        <nav class="team-sidebar bg-[#efede6] p-4" aria-label="Teams">
          <button class="neutral-button-filled w-full" id="open-create-team" type="button">Create team</button>
        </nav>
        <section class="team-content grid min-h-[420px] place-items-center px-6 text-center">
          <h2 class="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h2>
        </section>
      </div>`;
  }

  const canManageTeam = hasCapability(capabilities, 'MANAGE_MEMBERS')
    || hasCapability(capabilities, 'MANAGE_ROLES')
    || hasCapability(capabilities, 'MANAGE_TEAM');

  const futureSection = (label: string, reason: string) => `
    <button class="team-section-link" type="button" disabled title="${reason}">${label}<span class="team-section-status">Soon</span></button>`;

  const memberDirectory = `
    <div class="divide-y divide-[#d8d6ce]" id="team-member-list">
      ${members.map((member) => `
          <article class="grid gap-4 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_190px] sm:items-center" data-member-id="${member.userId}">
            <div class="min-w-0">
              <strong class="member-full-name block truncate text-sm font-semibold">${escapeHtml(memberName(member))}</strong>
              <span class="mt-1 block truncate text-xs text-[#6d716b]">@${escapeHtml(member.username)} · Joined ${new Date(member.joinedAt).toLocaleDateString()}</span>
            </div>
            <span class="font-mono text-[10px] tracking-[.08em] text-[#59616c]">${roleLabel(member.role)}</span>
          </article>`).join('')}
    </div>`;

  const sectionContent = activeSection === 'all-teams' ? `
    <div class="grid min-h-64 place-items-center px-6 py-12 text-center">
      <p class="m-0 max-w-[32ch] text-sm leading-relaxed text-[#6d716b]">Select a team from the navigation to view its members and settings.</p>
    </div>` : memberDirectory;

  return `
    <div class="team-shell grid gap-px overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#d8d6ce] md:grid-cols-[240px_minmax(0,1fr)]">
      <nav class="team-sidebar bg-[#efede6] p-4" aria-label="Teams">
        <div class="grid gap-1 pb-4">
          <button class="team-section-link ${activeSection === 'all-teams' ? 'is-active' : ''}" data-team-section="all-teams" type="button" aria-pressed="${activeSection === 'all-teams'}" aria-expanded="${teamsExpanded}">
            All teams
            <svg class="team-list-chevron size-3 fill-none stroke-current stroke-2 transition-transform ${teamsExpanded ? 'rotate-90' : ''}" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>
          </button>
          <nav class="team-list ml-4 ${teamsExpanded ? 'grid' : 'hidden'} gap-1 border-l border-[#c7c5bd] pl-2" aria-label="Your teams">
            ${teams.map((team) => `
              <button class="team-switch team-section-link ${activeSection === 'members' && team.teamId === selected.teamId ? 'is-active' : ''}" data-team-id="${team.teamId}" type="button">
                <span class="truncate">${escapeHtml(team.name)}</span>
              </button>`).join('')}
          </nav>
          ${futureSection('Workstreams', 'Requires the Workspace Service')}
          ${futureSection('Project chat', 'Requires project membership and the Collaboration Service')}
          <button class="neutral-button-filled mt-3 w-full" id="open-create-team" type="button">Create team</button>
        </div>
      </nav>

      ${activeSection === 'all-teams' ? `
        <section class="team-content grid min-h-[420px] min-w-0 place-items-center px-6 text-center">
          <h2 class="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h2>
        </section>` : `
      <section class="team-content min-w-0 overflow-hidden rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2]">
        <header class="border-b border-[#d8d6ce] px-6 py-6">
          <div>
            <div class="flex items-center justify-between gap-4">
              <h2 class="m-0 min-w-0 truncate text-3xl font-bold tracking-[-.04em]">${escapeHtml(selected.name)}</h2>
              <div class="flex shrink-0 items-center gap-2">
                ${canManageTeam ? `
                  <button class="neutral-button" id="open-team-settings" type="button" aria-label="Edit ${escapeHtml(selected.name)}">Edit team</button>` : ''}
                <button class="neutral-button" id="close-team-detail" type="button">Close</button>
              </div>
            </div>
            <p class="mb-0 mt-2 text-sm text-[#6d716b]">Manage members, roles, and team access.</p>
          </div>
        </header>
        ${sectionContent}
      </section>`}
    </div>`;
};

export const teamSettingsView = (
  team: Team,
  members: TeamMember[],
  capabilities: TeamCapabilities,
) => {
  const canAdd = hasCapability(capabilities, 'MANAGE_MEMBERS');
  const canChangeRoles = hasCapability(capabilities, 'MANAGE_ROLES');
  const canEditTeam = hasCapability(capabilities, 'MANAGE_TEAM');
  const availableRoles = assignableRoles(capabilities);

  return `
    <header class="relative px-14 pb-4 pt-8 text-center">
      <h2 class="m-0 text-3xl font-bold tracking-[-.04em]">${escapeHtml(team.name)}</h2>
      <button class="panel-close absolute right-5 top-5" type="button" aria-label="Close team settings">×</button>
    </header>
    <output class="mx-7 mt-5 hidden border-l-3 border-[#a54d45] bg-[#f8eae7] px-3 py-2 text-xs text-[#7f342e]" id="team-settings-message" role="alert"></output>
    <div class="grid gap-7 p-7">
      <section>
        ${canEditTeam ? `
          <form class="grid gap-4" id="update-team-form">
            <label class="field-label">Team name<input class="field-input" name="name" maxlength="100" required value="${escapeHtml(team.name)}"></label>
            <button class="neutral-button-filled" data-label="Save team" type="submit">Save team</button>
            <output class="hidden text-xs text-[#7f342e]" id="update-team-message" role="alert"></output>
          </form>` : `
          <div class="grid gap-1 border-l-2 border-[#66707c] pl-4">
            <strong class="text-sm">${escapeHtml(team.name)}</strong>
            <span class="text-xs text-[#6d716b]">Your role: ${roleLabel(capabilities.role)}</span>
          </div>`}
      </section>

      ${canAdd ? `
        <section class="pt-2">
          <h3 class="mb-4 mt-0 text-center text-lg font-semibold tracking-[-.02em]">Add member</h3>
          <form class="grid w-full gap-4" id="add-team-member-form">
            <label class="field-label">Email<input class="field-input" name="email" type="email" maxlength="100" autocomplete="off" required placeholder="developer@company.com"></label>
            <label class="field-label w-full">Role<select class="field-input h-12 w-full px-3 text-sm" name="role" required>${roleOptions(availableRoles)}</select></label>
            <button class="neutral-button-filled justify-self-center" data-label="Add" type="submit">Add</button>
            <output class="hidden text-xs text-[#7f342e]" id="team-form-message" role="alert"></output>
          </form>
        </section>` : ''}

      <section class="pt-2">
        <h3 class="mb-3 mt-0 text-center text-lg font-semibold tracking-[-.02em]">Members & roles</h3>
        <div class="grid gap-2">
          ${members.map((member) => {
            const manageable = canManageMember(capabilities, member);
            return `
              <article class="py-4" data-member-id="${member.userId}">
                <div class="flex items-center justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-2">
                      <strong class="member-full-name truncate text-sm font-semibold">${escapeHtml(memberName(member))}</strong>
                      <span class="shrink-0 text-xs text-[#59616c]">${roleLabel(member.role)}</span>
                      ${canChangeRoles && manageable ? `
                        <button class="panel-action edit-member-role shrink-0 rounded-lg" type="button" aria-label="Edit role for ${escapeHtml(member.username)}" aria-expanded="false" title="Edit role">
                          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg>
                        </button>` : ''}
                    </div>
                    <span class="mt-1 block truncate text-xs text-[#6d716b]">@${escapeHtml(member.username)} · Joined ${new Date(member.joinedAt).toLocaleDateString()}</span>
                  </div>
                  ${canAdd && manageable ? `<button class="danger-button danger-button-compact remove-member shrink-0" type="button">Remove</button>` : ''}
                </div>
                ${canChangeRoles && manageable ? `
                  <select class="field-input member-role mt-3 hidden h-12 w-full text-sm" aria-label="Role for ${escapeHtml(member.username)}">${roleOptions(availableRoles, member.role)}</select>` : ''}
              </article>`;
          }).join('')}
        </div>
      </section>

    </div>`;
};

export const createTeamPanelView = `
  <header class="flex items-start justify-between border-b border-[#d8d6ce] px-7 pb-6 pt-8">
    <div>
      <p class="mb-2 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">New team</p>
      <h2 class="m-0 text-3xl font-bold tracking-[-.04em]">Create team</h2>
    </div>
    <button class="panel-close" type="button" aria-label="Close create team panel">×</button>
  </header>
  <div class="p-7">${createTeamForm()}</div>`;

function createTeamForm() {
  return `
    <form class="grid gap-3" data-create-team-form>
      <label class="field-label">Team name<input class="field-input" name="name" maxlength="100" required placeholder="Payments Platform"></label>
      <button class="neutral-button-filled" data-label="Create team" type="submit">Create team</button>
      <output class="hidden text-xs text-[#7f342e]" data-team-create-message role="alert"></output>
    </form>`;
}
