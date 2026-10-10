import { ApiError, post } from './api';
import {
  authenticatedRequest,
  getCurrentUser,
  isAuthenticated,
  login,
  logout,
  restoreSession,
  type UserProfile,
} from './auth';
import { API_URL, OAUTH_PATH } from './config';
import { loginView } from './views/login';
import { registrationView } from './views/register';
import { checkEmailAction, continueAction, retryAction, statusView } from './views/status';
import {
  homeView,
  editProfileView,
  loadingView,
  logoutFailedView,
  profileLoadingView,
  profileView,
  settingsView,
} from './views/home';
import { escapeHtml } from './html';
import {
  addTeamMember,
  createTeam,
  getMyTeamCapabilities,
  getTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  updateTeam,
  updateTeamMemberRole,
  type Team,
  type TeamCapabilities,
  type TeamMember,
  type UserRole,
} from './features/teams/api';
import {
  addTeamMemberPanelView,
  createTeamPanelView,
  editTeamPanelView,
} from './features/teams/view';
import {
  assignProjectTeam,
  createWorkstream,
  createProject,
  listProjectTeams,
  listProjects,
  listWorkstreams,
  removeProjectTeam,
  updateProject,
  type Project,
  type ProjectTeam,
  type Workstream,
} from './features/projects/api';
import {
  assignProjectTeamPanelView,
  projectPanelView,
  projectsErrorView,
  projectsLoadingView,
  projectWorkspaceView,
  workstreamPanelView,
} from './features/projects/view';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('App root is missing');

const setRoute = (path: string) => {
  history.pushState({}, '', path);
  render();
};

let cooldownTimer: number | undefined;

const showMessage = (message: string, type: 'error' | 'success' = 'error') => {
  const output = document.querySelector<HTMLOutputElement>('#form-message');
  if (!output) return;
  output.textContent = message;
  output.classList.remove('hidden');
  if (type === 'success') {
    output.className = `
      border-l-3 border-[#66707c] bg-[#e8e9e7] px-3 py-2
      text-xs leading-relaxed text-[#414851]
    `;
  }
};

const setSubmitting = (form: HTMLFormElement, active: boolean) => {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  button.disabled = active;
  button.textContent = active ? 'Please wait…' : button.dataset.label || 'Submit';
};

const confirmAction = (title: string, message: string, confirmLabel: string) => new Promise<boolean>((resolve) => {
  document.querySelector('#confirmation-modal')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="fixed inset-0 z-50 grid place-items-center bg-[#111]/45 p-5" id="confirmation-modal">
      <section class="confirmation-dialog w-full max-w-[390px] border border-[#c7c5bd] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
        <h2 class="m-0 text-xl font-bold tracking-[-.03em]" id="confirmation-title">${escapeHtml(title)}</h2>
        <p class="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="confirmation-message">${escapeHtml(message)}</p>
        <div class="grid grid-cols-2 gap-3">
          <button class="neutral-button" id="confirmation-cancel" type="button">Cancel</button>
          <button class="danger-button" id="confirmation-confirm" type="button">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    </div>`);
  const modal = document.querySelector<HTMLElement>('#confirmation-modal')!;
  const finish = (confirmed: boolean) => {
    modal.remove();
    resolve(confirmed);
  };
  modal.querySelector('#confirmation-cancel')?.addEventListener('click', () => finish(false));
  modal.querySelector('#confirmation-confirm')?.addEventListener('click', () => finish(true));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) finish(false);
  });
  modal.querySelector<HTMLButtonElement>('#confirmation-cancel')?.focus();
});

const startCooldown = (form: HTMLFormElement, seconds: number) => {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  window.clearInterval(cooldownTimer);
  let remaining = Math.max(1, Math.ceil(seconds));
  button.disabled = true;
  const update = () => {
    button.textContent = `Try again in ${remaining}s`;
    remaining -= 1;
    if (remaining < 0) {
      window.clearInterval(cooldownTimer);
      button.disabled = false;
      button.textContent = button.dataset.label || 'Submit';
    }
  };
  update();
  cooldownTimer = window.setInterval(update, 1000);
};

const bindLinks = () => {
  document.querySelectorAll<HTMLAnchorElement>('[data-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setRoute(new URL(link.href).pathname);
    });
  });
};

const bindPasswordToggles = () => {
  document.querySelectorAll<HTMLButtonElement>('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.previousElementSibling as HTMLInputElement;
      const show = input.type === 'password';

      input.type = show ? 'text' : 'password';
      button.ariaLabel = show ? 'Hide password' : 'Show password';
      button.ariaPressed = String(show);
    });
  });
};

const bindRegistration = () => {
  const form = document.querySelector<HTMLFormElement>('#register-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.confirmPassword) {
      showMessage('Passwords do not match.');
      return;
    }

    setSubmitting(form, true);

    try {
      await post('/api/users', values);
      sessionStorage.setItem('verificationEmail', String(values.email));
      setRoute('/check-email');
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Unable to create your account.',
      );
    } finally {
      setSubmitting(form, false);
    }
  });
};

const bindLogin = () => {
  const form = document.querySelector<HTMLFormElement>('#login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    let rateLimited = false;
    setSubmitting(form, true);

    try {
      const data = new FormData(form);
      await login(String(data.get('usernameOrEmail')), String(data.get('password')));
      setRoute('/app');
    } catch (error) {
      const password = form.querySelector<HTMLInputElement>('[name="password"]');
      if (password) password.value = '';
      if (error instanceof ApiError && error.status === 429) {
        rateLimited = true;
        showMessage('Too many login attempts. Please wait before trying again.');
        startCooldown(form, error.retryAfter ?? 60);
        return;
      }
      showMessage(
        error instanceof ApiError && error.status === 401
          ? 'Incorrect username/email or password.'
          : error instanceof Error ? error.message : 'Unable to log in.',
      );
    } finally {
      if (!rateLimited) setSubmitting(form, false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      location.assign(`${API_URL}${OAUTH_PATH}/${button.dataset.provider}`);
    });
  });

  document.querySelector<HTMLButtonElement>('#forgot-password')?.addEventListener('click', () => {
    showMessage('Password recovery is not available yet. Contact support if you cannot sign in.');
  });
};

const bindLogout = () => {
  document.querySelectorAll<HTMLButtonElement>('#logout-button, #logout-button-secondary')
    .forEach((button) => button.addEventListener('click', async () => {
      const confirmed = await confirmAction(
        'Log out?',
        'Are you sure you want to log out of Conflux on this device?',
        'Log out',
      );
      if (!confirmed) return;
      button.disabled = true;
      button.textContent = 'Logging out…';
      try {
        await logout();
        setRoute('/');
      } catch {
        app.innerHTML = logoutFailedView;
        bindLogoutFailure();
      }
    }));
};

const closeAccountPanel = () => {
  activeActivityPanel = null;
  document.querySelector('#account-panel')?.classList.add('hidden');
  document.querySelector('#profile-popover')?.classList.add('hidden');
  document.querySelector('.app-workspace')?.classList.remove('activity-panel-open');
  document.querySelector('#account-backdrop')?.classList.add('hidden');
  document.querySelectorAll('.rail-button').forEach((button) => {
    button.setAttribute('aria-pressed', 'false');
  });
};

const closeDialog = () => {
  document.querySelector('#account-panel')?.classList.add('hidden');
  document.querySelector('#account-backdrop')?.classList.add('hidden');
};

const showProfilePanel = (content: string, activeButton = 'profile-button') => {
  const panel = document.querySelector<HTMLElement>('#profile-popover');
  if (!panel) return;
  activeActivityPanel = activeButton;
  document.querySelector('#account-panel')?.classList.add('hidden');
  document.querySelector('#account-backdrop')?.classList.add('hidden');
  panel.innerHTML = `<div class="activity-panel-surface">${content}</div><button class="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" id="activity-panel-resizer" type="button" aria-label="Resize activity panel" title="Drag to resize"></button>`;
  panel.classList.remove('hidden');
  document.querySelector('.app-workspace')?.classList.add('activity-panel-open');
  bindActivityPanelResize();
  document.querySelectorAll('.rail-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.id === activeButton));
  });
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeAccountPanel);
};

const showEditTeamPanel = (
  team: Team,
  members: TeamMember[],
) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = editTeamPanelView(team);
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  bindTeamAdminControls(team, members);
};

const showAddTeamMemberPanel = (
  team: Team,
  members: TeamMember[],
  capabilities: TeamCapabilities,
) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = addTeamMemberPanelView(capabilities);
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  bindTeamAdminControls(team, members);
};

const showCreateTeamPanel = (projectId?: string) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = createTeamPanelView;
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  bindCreateTeamForms(panel, projectId);
};

const showProjectPanel = (project?: Project) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = projectPanelView(project);
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  bindProjectForm(panel, project);
};

const showAssignProjectTeamPanel = (project: Project, teams: Team[]) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = assignProjectTeamPanelView(teams);
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  const form = panel.querySelector<HTMLFormElement>('#assign-project-team-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true);
    try {
      const data = new FormData(form);
      await assignProjectTeam(project.projectId, String(data.get('teamId')));
      closeDialog();
      await loadProjectWorkspace(project.projectId, null);
    } catch (error) {
      const output = form.querySelector<HTMLOutputElement>('#assign-project-team-message');
      if (output) {
        output.textContent = projectErrorMessage(error);
        output.classList.remove('hidden');
      }
      setSubmitting(form, false);
    }
  });
};

const showWorkstreamPanel = (project: Project, team: ProjectTeam) => {
  const panel = document.querySelector<HTMLElement>('#account-panel');
  const backdrop = document.querySelector<HTMLElement>('#account-backdrop');
  if (!panel || !backdrop) return;
  panel.innerHTML = workstreamPanelView(project, team);
  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  panel.querySelector<HTMLButtonElement>('.panel-close')?.addEventListener('click', closeDialog);
  bindWorkstreamForm(panel, project, team);
};

const bindDeleteAccount = () => {
  document.querySelector<HTMLButtonElement>('#delete-account')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const confirmed = await confirmAction(
      'Delete account?',
      'Are you sure you want to permanently delete your account? This cannot be undone.',
      'Delete account',
    );
    if (!confirmed) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await authenticatedRequest('/api/users/me', 'DELETE');
      try {
        await logout();
      } catch {
        // The account is already deleted; local logout still succeeded.
      }
      setRoute('/');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete account';
      showMessage(error instanceof Error ? error.message : 'Unable to delete your account.');
    }
  });
};

const bindThemeToggle = () => {
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  const updateLabel = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'Dark' : 'Light';
    if (button) button.ariaLabel = `Switch to ${theme === 'Dark' ? 'light' : 'dark'} theme`;
    const label = button?.querySelector<HTMLElement>('.theme-label');
    if (label) label.textContent = `${theme} mode`;
  };
  updateLabel();
  button?.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    updateLabel();
  });
};

const showProfile = (profile: UserProfile) => {
  showProfilePanel(profileView(profile));
  bindLogout();
  bindDeleteAccount();
  document.querySelectorAll('[data-edit-profile]').forEach((button) => {
    button.addEventListener('click', () => {
      showProfilePanel(editProfileView(profile));
      bindProfileForm(profile);
    });
  });
};

const bindProfileForm = (originalProfile: UserProfile) => {
  const form = document.querySelector<HTMLFormElement>('#profile-form');
  document.querySelector('#cancel-profile-edit')?.addEventListener('click', () => showProfile(originalProfile));
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true);
    try {
      const values = Object.fromEntries(new FormData(form));
      const profile = await authenticatedRequest<UserProfile>('/api/users/me', 'PUT', values);
      showProfile(profile);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unable to update your profile.');
      setSubmitting(form, false);
    }
  });
};

const bindActivityPanelResize = () => {
  const handle = document.querySelector<HTMLButtonElement>('#activity-panel-resizer');
  const shell = document.querySelector<HTMLElement>('.app-workspace');
  if (!handle || !shell || handle.dataset.bound) return;
  handle.dataset.bound = 'true';

  const setWidth = (width: number) => {
    const bounded = Math.min(520, Math.max(240, width));
    shell.style.setProperty('--activity-panel-width', `${bounded}px`);
    localStorage.setItem('activityPanelWidth', String(bounded));
  };
  const resize = (event: PointerEvent) => setWidth(event.clientX - 52);
  const stop = () => {
    document.removeEventListener('pointermove', resize);
    document.removeEventListener('pointerup', stop);
  };
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    document.addEventListener('pointermove', resize);
    document.addEventListener('pointerup', stop);
  });
  handle.addEventListener('keydown', (event) => {
    const current = Number.parseInt(
      getComputedStyle(shell).getPropertyValue('--activity-panel-width'),
      10,
    ) || 300;
    if (event.key === 'ArrowLeft') setWidth(current - 20);
    if (event.key === 'ArrowRight') setWidth(current + 20);
  });
};

const bindAccountControls = () => {
  const savedPanelWidth = Number(localStorage.getItem('activityPanelWidth'));
  const shell = document.querySelector<HTMLElement>('.app-workspace');
  if (shell && savedPanelWidth >= 240 && savedPanelWidth <= 520) {
    shell.style.setProperty('--activity-panel-width', `${savedPanelWidth}px`);
  }
  bindActivityPanelResize();
  document.querySelector('#account-backdrop')?.addEventListener('click', closeDialog);
  document.querySelector('#profile-button')?.addEventListener('click', async () => {
    if (activeActivityPanel === 'profile-button') {
      closeAccountPanel();
      return;
    }
    showProfilePanel(profileLoadingView);
    try {
      const profile = await authenticatedRequest<UserProfile>('/api/users/me', 'GET');
      if (activeActivityPanel === 'profile-button') showProfile(profile);
    } catch (error) {
      if (activeActivityPanel !== 'profile-button') return;
      const message = escapeHtml(error instanceof Error ? error.message : 'Unable to load your profile.');
      showProfilePanel(`${profileLoadingView}<p class="m-7 text-sm text-[#7f342e]">${message}</p>`);
    }
  });
  document.querySelector('#settings-button')?.addEventListener('click', () => {
    if (activeActivityPanel === 'settings-button') {
      closeAccountPanel();
      return;
    }
    showProfilePanel(settingsView, 'settings-button');
    bindThemeToggle();
  });
  document.querySelector('#projects-button')?.addEventListener('click', () => {
    if (activeActivityPanel === 'projects-button') {
      closeAccountPanel();
      return;
    }
    activeActivityPanel = 'projects-button';
    closeDialog();
    document.querySelector('#profile-popover')?.classList.remove('hidden');
    document.querySelector('.app-workspace')?.classList.add('activity-panel-open');
    document.querySelectorAll('.rail-button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.id === 'projects-button'));
    });
    void loadProjectWorkspace();
  });
};

let activeActivityPanel: string | null = 'projects-button';
let activeProjectId: string | null = null;
let activeProjectTeamId: string | null = null;

const setTeamWorkspace = (content: string) => {
  const workspace = document.querySelector<HTMLElement>('#team-workspace');
  if (!workspace) return;
  const template = document.createElement('template');
  template.innerHTML = content;
  const sidebar = template.content.querySelector<HTMLElement>('.team-sidebar');
  const teamContent = template.content.querySelector<HTMLElement>('.team-content');
  const activityPanel = document.querySelector<HTMLElement>('#profile-popover');
  if (sidebar && teamContent && activityPanel) {
    activityPanel.innerHTML = `<div class="activity-panel-surface">${sidebar.outerHTML}</div><button class="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" id="activity-panel-resizer" type="button" aria-label="Resize activity panel" title="Drag to resize"></button>`;
    workspace.innerHTML = teamContent.outerHTML;
    if (activeActivityPanel === 'projects-button') {
      activityPanel.classList.remove('hidden');
      document.querySelector('.app-workspace')?.classList.add('activity-panel-open');
      bindActivityPanelResize();
    }
    return;
  }
  workspace.innerHTML = content;
};

const showTeamFormError = (selector: string, error: unknown) => {
  const output = document.querySelector<HTMLOutputElement>(selector);
  if (!output) return;
  output.textContent = error instanceof Error ? error.message : 'The request could not be completed.';
  output.classList.remove('hidden');
};

const bindCreateTeamForms = (root: ParentNode, projectId?: string) => {
  root.querySelectorAll<HTMLFormElement>('[data-create-team-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setSubmitting(form, true);
      try {
        const data = new FormData(form);
        const created = await createTeam(
          String(data.get('name')),
          String(data.get('description') ?? ''),
        );
        if (projectId) await assignProjectTeam(projectId, created.teamId);
        closeDialog();
        await loadProjectWorkspace(projectId ?? activeProjectId, projectId ? created.teamId : activeProjectTeamId);
      } catch (error) {
        const output = form.querySelector<HTMLOutputElement>('[data-team-create-message]');
        if (output) {
          output.textContent = error instanceof Error ? error.message : 'Unable to create this team.';
          output.classList.remove('hidden');
        }
        setSubmitting(form, false);
      }
    });
  });
};

const bindTeamAdminControls = (selected: Team, members: TeamMember[]) => {
  const updateTeamForm = document.querySelector<HTMLFormElement>('#update-team-form');
  updateTeamForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(updateTeamForm, true);
    try {
      const data = new FormData(updateTeamForm);
      await updateTeam(
        selected.teamId,
        String(data.get('name')),
        String(data.get('description') ?? ''),
      );
      closeDialog();
      await loadProjectWorkspace(activeProjectId, selected.teamId);
    } catch (error) {
      showTeamFormError('#update-team-message', error);
      setSubmitting(updateTeamForm, false);
    }
  });

  const addMemberForm = document.querySelector<HTMLFormElement>('#add-team-member-form');
  addMemberForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(addMemberForm, true);
    const data = new FormData(addMemberForm);
    try {
      await addTeamMember(selected.teamId, String(data.get('email')), String(data.get('role')) as UserRole);
      closeDialog();
      await loadProjectWorkspace(activeProjectId, selected.teamId);
    } catch (error) {
      showTeamFormError('#team-form-message', error);
      setSubmitting(addMemberForm, false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>('.edit-member-role').forEach((button) => {
    button.addEventListener('click', () => {
      const select = button.closest<HTMLElement>('[data-member-id]')
        ?.querySelector<HTMLSelectElement>('.member-role');
      if (!select) return;
      const opening = select.classList.contains('hidden');
      select.classList.toggle('hidden', !opening);
      button.setAttribute('aria-expanded', String(opening));
      if (opening) select.focus();
    });
  });

  document.querySelectorAll<HTMLSelectElement>('.member-role').forEach((select) => {
    select.addEventListener('change', async () => {
      const row = select.closest<HTMLElement>('[data-member-id]');
      const member = members.find((candidate) => candidate.userId === row?.dataset.memberId);
      if (!member) return;
      select.disabled = true;
      try {
        await updateTeamMemberRole(selected.teamId, member.userId, select.value as UserRole);
        closeDialog();
        await loadProjectWorkspace(activeProjectId, selected.teamId);
      } catch (error) {
        select.value = member.role;
        select.disabled = false;
        showTeamFormError('#team-settings-message', error);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.remove-member').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest<HTMLElement>('[data-member-id]');
      const member = members.find((candidate) => candidate.userId === row?.dataset.memberId);
      if (!member) return;
      const confirmed = await confirmAction(
        'Remove team member?',
        `Remove @${member.username} from ${selected.name}?`,
        'Remove member',
      );
      if (!confirmed) return;
      button.disabled = true;
      try {
        await removeTeamMember(selected.teamId, member.userId);
        closeDialog();
        await loadProjectWorkspace(activeProjectId, selected.teamId);
      } catch (error) {
        button.disabled = false;
        showTeamFormError('#team-settings-message', error);
      }
    });
  });
};

const bindProjectForm = (root: ParentNode, project?: Project) => {
  const form = root.querySelector<HTMLFormElement>('#project-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setSubmitting(form, true);
    try {
      if (project) {
        await updateProject(
          project.projectId,
          String(data.get('name')),
          String(data.get('description') ?? ''),
        );
      } else {
        const created = await createProject(
          String(data.get('name')),
          String(data.get('description') ?? ''),
        );
        activeProjectId = created.projectId;
        activeProjectTeamId = null;
      }
      closeDialog();
      await loadProjectWorkspace(activeProjectId, activeProjectTeamId);
    } catch (error) {
      const output = form.querySelector<HTMLOutputElement>('#project-form-message');
      if (output) {
        output.textContent = projectErrorMessage(error);
        output.classList.remove('hidden');
      }
      setSubmitting(form, false);
    }
  });
};

const projectErrorMessage = (error: unknown) => {
  if (error instanceof ApiError && error.status === 404) {
    return 'You no longer have access to manage this project.';
  }
  if (error instanceof ApiError && error.status === 409) {
    return 'A project with this name already exists.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'Team authorization is temporarily unavailable. Try again shortly.';
  }
  return error instanceof Error ? error.message : 'Unable to save this project.';
};

const bindWorkstreamForm = (
  root: ParentNode,
  project: Project,
  team: ProjectTeam,
) => {
  const form = root.querySelector<HTMLFormElement>('#workstream-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setSubmitting(form, true);
    try {
      await createWorkstream(
        project.projectId,
        team.teamId,
        String(data.get('name')),
        String(data.get('branchName')),
        String(data.get('baseRevision')),
      );
      closeDialog();
      await loadProjectWorkspace(project.projectId, team.teamId);
    } catch (error) {
      const output = form.querySelector<HTMLOutputElement>('#workstream-form-message');
      if (output) {
        output.textContent = projectErrorMessage(error);
        output.classList.remove('hidden');
      }
      setSubmitting(form, false);
    }
  });
};

const bindProjectWorkspace = (
  activeProject: Project | null,
  projectTeams: ProjectTeam[],
  activeTeam: ProjectTeam | null,
  identityTeam: Team | null,
  members: TeamMember[],
  capabilities: TeamCapabilities | null,
  assignableTeams: Team[],
) => {
  document.querySelectorAll<HTMLButtonElement>('.project-switch').forEach((button) => {
    button.addEventListener('click', () => {
      const projectId = button.dataset.projectId ?? null;
      void loadProjectWorkspace(
        projectId === activeProject?.projectId ? null : projectId,
        null,
      );
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.project-team-switch, .project-team-row')
    .forEach((button) => {
    button.addEventListener('click', () => {
      void loadProjectWorkspace(activeProject?.projectId ?? null, button.dataset.teamId ?? null);
    });
  });

  document.querySelector('#open-edit-team')?.addEventListener('click', () => {
    if (identityTeam) showEditTeamPanel(identityTeam, members);
  });

  document.querySelector('#open-add-member')?.addEventListener('click', () => {
    if (identityTeam && capabilities) {
      showAddTeamMemberPanel(identityTeam, members, capabilities);
    }
  });

  document.querySelectorAll('.open-create-team').forEach((button) => {
    button.addEventListener('click', () => {
      if (activeProject) showCreateTeamPanel(activeProject.projectId);
    });
  });

  document.querySelector('#open-assign-team')?.addEventListener('click', () => {
    if (activeProject && assignableTeams.length) {
      showAssignProjectTeamPanel(activeProject, assignableTeams);
    }
  });

  document.querySelector('#remove-project-team')?.addEventListener('click', async () => {
    if (!activeProject || !activeTeam) return;
    const confirmed = await confirmAction(
      'Remove team from project?',
      `Remove ${activeTeam.name} from ${activeProject.name}?`,
      'Remove team',
    );
    if (!confirmed) return;
    try {
      await removeProjectTeam(activeProject.projectId, activeTeam.teamId);
      await loadProjectWorkspace(activeProject.projectId, null);
    } catch (error) {
      showMessage(projectErrorMessage(error));
    }
  });

  document.querySelector('#open-create-project')?.addEventListener('click', () => {
    showProjectPanel();
  });

  document.querySelector('#open-edit-project')?.addEventListener('click', () => {
    if (activeProject) showProjectPanel(activeProject);
  });

  document.querySelector('#back-to-project')?.addEventListener('click', () => {
    void loadProjectWorkspace(activeProject?.projectId ?? null, null);
  });

  document.querySelector('#open-create-workstream')?.addEventListener('click', () => {
    if (activeProject && activeTeam) showWorkstreamPanel(activeProject, activeTeam);
  });

  if (identityTeam) bindTeamAdminControls(identityTeam, members);
};

const loadProjectWorkspace = async (
  preferredProjectId: string | null = activeProjectId,
  preferredTeamId: string | null = activeProjectTeamId,
) => {
  if (!document.querySelector('#team-workspace .team-content')) {
    setTeamWorkspace(projectsLoadingView);
  }
  try {
    const [projects, teams] = await Promise.all([listProjects(), listTeams()]);
    const activeProject = projects.find((project) => project.projectId === preferredProjectId) ?? null;
    activeProjectId = activeProject?.projectId ?? null;
    const projectTeams = activeProject ? await listProjectTeams(activeProject.projectId) : [];
    const activeTeam = projectTeams.find((team) => team.teamId === preferredTeamId) ?? null;
    activeProjectTeamId = activeTeam?.teamId ?? null;
    const ownedTeam = activeTeam
      ? teams.find((team) => team.teamId === activeTeam.teamId) ?? null
      : null;
    let identityTeam: Team | null = null;
    let members: TeamMember[] = [];
    let capabilities: TeamCapabilities | null = null;
    let workstreams: Workstream[] = [];
    if (activeProject && activeTeam && ownedTeam) {
      [identityTeam, members, capabilities, workstreams] = await Promise.all([
        getTeam(activeTeam.teamId),
        listTeamMembers(activeTeam.teamId),
        getMyTeamCapabilities(activeTeam.teamId),
        listWorkstreams(activeProject.projectId, activeTeam.teamId),
      ]);
    }
    const canManageProject = activeProject?.createdBy === getCurrentUser()?.id
      || projectTeams.some((team) => {
        const owned = teams.find((candidate) => candidate.teamId === team.teamId);
        return owned ? ['ADMIN', 'TEAM_LEAD'].includes(owned.role) : false;
      });
    const assignableTeams = canManageProject ? teams.filter((team) =>
      ['ADMIN', 'TEAM_LEAD'].includes(team.role)
      && !projectTeams.some((assigned) => assigned.teamId === team.teamId)) : [];
    setTeamWorkspace(projectWorkspaceView(
      projects, activeProject, projectTeams, activeTeam, identityTeam, members,
      capabilities, workstreams, true, canManageProject, assignableTeams,
    ));
    bindProjectWorkspace(
      activeProject, projectTeams, activeTeam, identityTeam, members, capabilities,
      assignableTeams,
    );
  } catch (error) {
    setTeamWorkspace(projectsErrorView(
      error instanceof ApiError && error.status === 503
        ? 'Identity authorization is temporarily unavailable. Try again shortly.'
        : error instanceof Error ? error.message : 'Unable to load projects.',
    ));
    document.querySelector('#retry-projects')?.addEventListener(
      'click', () => void loadProjectWorkspace(),
    );
  }
};

const bindLogoutFailure = () => {
  document.querySelector<HTMLButtonElement>('#retry-logout')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Retrying…';
    try {
      await logout();
      setRoute('/');
    } catch {
      button.disabled = false;
      button.textContent = 'Retry logout';
      showMessage('The server is still unavailable. Your server session may remain active.');
    }
  });
  document.querySelector<HTMLButtonElement>('#close-app')?.addEventListener('click', () => {
    window.close();
  });
};

const bindResend = () => {
  const form = document.querySelector<HTMLFormElement>('#resend-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSubmitting(form, true);

    try {
      await post('/api/users/resend-verification', {
        email: new FormData(form).get('email'),
      });
      showMessage('If the account is eligible, verification instructions will be sent.', 'success');
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Unable to resend the email.',
      );
    } finally {
      setSubmitting(form, false);
    }
  });
};

const verifyEmail = async (token: string) => {
  try {
    await post('/api/users/verify-email', { token });
    app.innerHTML = statusView({
      icon: 'check',
      title: 'Email verified',
      body: 'Your account is ready. You can now log in.',
      action: continueAction,
    });
  } catch (error) {
    app.innerHTML = statusView({
      icon: 'error',
      title: 'Link unavailable',
      body: error instanceof Error
        ? escapeHtml(error.message)
        : 'This verification link is invalid or has expired.',
      action: retryAction,
    });
  }
  bindLinks();
};

const render = () => {
  const { pathname, searchParams } = new URL(location.href);
  if (pathname === '/verify-email') {
    app.innerHTML = statusView({
      icon: 'mail',
      title: 'Verifying your email',
      body: 'Please wait while we confirm your verification link.',
    });
    void verifyEmail(searchParams.get('token') || '');
  } else if (pathname === '/check-email') {
    const email = sessionStorage.getItem('verificationEmail') || '';
    app.innerHTML = statusView({
      icon: 'mail',
      title: 'Check your inbox',
      body: email
        ? `If registration can be completed for <strong>${escapeHtml(email)}</strong>, verification instructions will arrive shortly. If you already have an account, sign in instead.`
        : 'If the account is eligible, verification instructions will be sent.',
      action: checkEmailAction(email),
    });
    bindResend();
  } else if (pathname === '/sign-up') {
    if (isAuthenticated()) {
      setRoute('/app');
      return;
    }
    app.innerHTML = registrationView();
    bindRegistration();
  } else if (pathname === '/app') {
    const user = getCurrentUser();
    if (!user) {
      setRoute('/');
      return;
    }
    app.innerHTML = homeView();
    bindLogout();
    bindAccountControls();
    void loadProjectWorkspace();
  } else {
    if (isAuthenticated()) {
      setRoute('/app');
      return;
    }
    app.innerHTML = loginView();
    bindLogin();
  }

  bindLinks();
  bindPasswordToggles();
};

export const startApp = () => {
  window.addEventListener('popstate', render);
  window.addEventListener('focus', () => {
    if (location.pathname === '/app'
      && isAuthenticated()
      && activeActivityPanel === 'projects-button') {
      void loadProjectWorkspace();
    }
  });
  app.innerHTML = loadingView;
  void restoreSession().finally(render);
};
