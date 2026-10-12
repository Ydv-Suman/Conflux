import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import logoUrl from '../src-tauri/app-icon.png';
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
import githubIcon from './assets/icons/github.svg';
import googleIcon from './assets/icons/google.svg';
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
  assignProjectTeam,
  createProject,
  createWorkstream,
  listProjects,
  listProjectTeams,
  listWorkstreams,
  removeProjectTeam,
  updateProject,
  type Project,
  type ProjectTeam,
  type Workstream,
} from './features/projects/api';

type Route = '/' | '/sign-up' | '/check-email' | '/verify-email' | '/app';
type Notice = { message: string; kind?: 'error' | 'success' } | null;
type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'team'; team?: Team; projectId?: string }
  | { kind: 'assign-team'; project: Project; teams: Team[] }
  | { kind: 'member'; team: Team; capabilities: TeamCapabilities }
  | { kind: 'workstream'; project: Project; team: ProjectTeam }
  | { kind: 'profile'; profile: UserProfile }
  | null;
type Confirmation = { title: string; message: string; label: string; action: () => Promise<void> } | null;

const fieldClass = 'grid gap-2 text-xs font-semibold text-[#30342f]';
const inputClass = 'h-11 w-full rounded-lg border border-[#c9c9c1] bg-[#fffefa] px-3 text-sm font-normal text-[#1d211e] outline-none transition duration-200 placeholder:text-[#969990] hover:border-[#999d96] focus:border-[#66707c] focus:ring-3 focus:ring-[#66707c]/15';
const primaryClass = 'flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-[#343a42] bg-[#343a42] px-4 font-bold text-white transition duration-200 hover:bg-[#484f59] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25 disabled:cursor-wait disabled:opacity-65';
const socialClass = 'flex min-h-12 cursor-pointer items-center justify-center gap-3 rounded-lg border border-[#c9c9c1] bg-[#fffefa] font-semibold text-[#252925] transition duration-200 hover:border-[#8d938b] hover:bg-[#f4f4ee] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25';
const roles: UserRole[] = ['ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER'];
const messageFor = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const formValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

function navigate(path: Route) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function NoticeView({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <output className={`border-l-3 px-3 py-2 text-xs ${notice.kind === 'success' ? 'border-[#66707c] bg-[#e8e9e7] text-[#414851]' : 'border-[#a54d45] bg-[#f8eae7] text-[#7f342e]'}`} role="alert">{notice.message}</output>;
}

function SubmitButton({ busy, children, className = '' }: { busy: boolean; children: ReactNode; className?: string }) {
  return <button className={`${primaryClass} ${className}`} disabled={busy} type="submit">{busy ? 'Please wait…' : children}</button>;
}

function PasswordInput({ name, autoComplete }: { name: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <span className="relative block">
    <input className={`${inputClass} pr-12`} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={12} maxLength={128} required />
    <button className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[#6d716b] hover:text-[#414851] focus-visible:outline-3 focus-visible:-outline-offset-1 focus-visible:outline-[#66707c]/25" type="button" aria-label={`${visible ? 'Hide' : 'Show'} password`} aria-pressed={visible} onClick={() => setVisible(!visible)}><svg className="size-5 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg></button>
  </span>;
}

function Brand() {
  return <aside className="flex min-h-[260px] flex-col items-center bg-[#fa7f2d] p-7 text-center text-[#343a42] md:min-h-dvh md:p-[clamp(30px,5vw,58px)]">
    <div className="my-auto grid justify-items-center gap-10">
      <div className="flex items-center"><img className="size-[88px] object-cover" src={logoUrl} alt="" /><span className="-ml-2 text-4xl font-bold tracking-[-.04em] text-white">onflux</span></div>
      <h1 className="m-0 text-[clamp(30px,3.5vw,40px)] leading-[1.02] font-bold tracking-[-.05em]">Build together,<br />without losing<br />the thread.</h1>
    </div>
  </aside>;
}

function AuthShell({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh bg-[#f8f7f2] md:grid-cols-[minmax(300px,.78fr)_minmax(440px,1.22fr)]"><Brand /><section className="grid place-items-center px-6 py-10 md:px-[clamp(34px,7vw,90px)] md:py-11">{children}</section></div>;
}

function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    const values = formValues(event.currentTarget);
    try { await login(String(values.usernameOrEmail), String(values.password)); onAuthenticated(); }
    catch (error) { setNotice({ message: error instanceof ApiError && error.status === 401 ? 'Incorrect username/email or password.' : messageFor(error, 'Unable to log in.') }); }
    finally { setBusy(false); }
  };
  return <AuthShell><div className="w-full max-w-[510px]">
    <h2 className="mb-8 text-center text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em] text-[#111317]">Welcome back</h2>
    <form className="grid gap-4" onSubmit={submit}><label className={fieldClass}>Email address/Username<input className={inputClass} name="usernameOrEmail" autoComplete="username" maxLength={100} required /></label><label className={fieldClass}>Password<PasswordInput name="password" autoComplete="current-password" /></label><NoticeView notice={notice} /><SubmitButton busy={busy} className="w-40 justify-self-center">Log in <span aria-hidden="true">→</span></SubmitButton></form>
    <button className="mt-4 block w-full cursor-pointer border-0 bg-transparent text-center text-xs font-semibold text-[#4f554f] underline underline-offset-3" type="button" onClick={() => setNotice({ message: 'Password recovery is not available yet. Contact support if you cannot sign in.' })}>Forgot password?</button>
    <div className="my-6 flex items-center gap-4 text-[10px] font-bold text-[#858981] uppercase before:h-px before:flex-1 before:bg-[#d3d2cb] after:h-px after:flex-1 after:bg-[#d3d2cb]">or</div>
    <div className="grid gap-3"><button className={socialClass} type="button" onClick={() => location.assign(`${API_URL}${OAUTH_PATH}/google`)}><img className="size-5" src={googleIcon} alt="" />Continue with Google</button><button className={socialClass} type="button" onClick={() => location.assign(`${API_URL}${OAUTH_PATH}/github`)}><img className="size-5" src={githubIcon} alt="" />Continue with GitHub</button></div>
    <p className="mb-0 mt-7 text-center text-sm text-[#6d716b]">New to Conflux? <a className="font-bold text-[#414851] underline underline-offset-3" href="/sign-up" onClick={(event) => { event.preventDefault(); navigate('/sign-up'); }}>Sign up</a></p>
  </div></AuthShell>;
}

function Register() {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = formValues(event.currentTarget);
    if (values.password !== values.confirmPassword) { setNotice({ message: 'Passwords do not match.' }); return; }
    setBusy(true); setNotice(null);
    try { await post('/api/users', values); sessionStorage.setItem('verificationEmail', String(values.email)); navigate('/check-email'); }
    catch (error) { setNotice({ message: messageFor(error, 'Unable to create your account.') }); }
    finally { setBusy(false); }
  };
  return <AuthShell><div className="w-full max-w-[550px]"><h2 className="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em] text-[#111317]">Create your account</h2><p className="mb-8 mt-3 text-sm text-[#6d716b]">Join Conflux and start building together.</p><form className="grid gap-4" onSubmit={submit}>
    <div className="grid gap-4 sm:grid-cols-3"><label className={fieldClass}>First name<input className={inputClass} name="firstName" autoComplete="given-name" maxLength={50} required /></label><label className={fieldClass}>Middle name<input className={inputClass} name="middleName" autoComplete="additional-name" maxLength={50} /></label><label className={fieldClass}>Last name<input className={inputClass} name="lastName" autoComplete="family-name" maxLength={50} required /></label></div>
    <label className={fieldClass}>Username<input className={inputClass} name="username" minLength={5} required /></label>
    <label className={fieldClass}>Email<input className={inputClass} name="email" type="email" required /></label>
    <label className={fieldClass}>Password<PasswordInput name="password" autoComplete="new-password" /></label>
    <label className={fieldClass}>Confirm password<PasswordInput name="confirmPassword" autoComplete="new-password" /></label>
    <NoticeView notice={notice} /><SubmitButton busy={busy} className="w-52 justify-self-center">Create account <span aria-hidden="true">→</span></SubmitButton>
  </form><p className="mb-0 mt-7 text-center text-sm text-[#6d716b]">Already have an account? <a className="font-bold text-[#414851] underline underline-offset-3" href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}>Log in</a></p></div></AuthShell>;
}

function EmailStatus({ verify }: { verify: boolean }) {
  const [notice, setNotice] = useState<Notice>({ message: verify ? 'Verifying your email…' : 'Check your inbox.', kind: 'success' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!verify) return;
    const token = new URL(location.href).searchParams.get('token') || '';
    void post('/api/users/verify-email', { token })
      .then(() => setNotice({ message: 'Email verified. You can now sign in.', kind: 'success' }))
      .catch((error) => setNotice({ message: messageFor(error, 'This verification link is invalid or expired.') }));
  }, [verify]);
  const resend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    try { await post('/api/users/resend-verification', { email: new FormData(event.currentTarget).get('email') }); setNotice({ message: 'If eligible, verification instructions will be sent.', kind: 'success' }); }
    catch (error) { setNotice({ message: messageFor(error, 'Unable to resend the email.') }); }
    finally { setBusy(false); }
  };
  const failed = verify && notice?.kind !== 'success' && notice?.message !== 'Verifying your email…';
  const complete = verify && notice?.kind === 'success' && notice.message.startsWith('Email verified');
  return <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-[#efede6] p-[clamp(26px,5vw,52px)]"><img className="mx-auto size-16 object-cover" src={logoUrl} alt="Conflux" /><section className="w-full max-w-[480px] place-self-center border border-[#d2d0c7] bg-[#faf9f4] p-[clamp(34px,7vw,60px)] text-center shadow-[0_24px_70px_-52px_rgba(27,35,30,.5)]"><span className={`mx-auto mb-6 grid size-[72px] place-items-center rounded-full ${failed ? 'bg-[#f3e5e2] text-[#8a3f39]' : 'bg-[#e8e9e7] text-[#414851]'}`} aria-hidden="true"><svg className="size-8 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24">{failed ? <><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></> : complete ? <path d="m5 12 4 4L19 6"/> : <><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></>}</svg></span><p className="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">EMAIL VERIFICATION</p><h1 className="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]">{verify ? complete ? 'Email verified' : failed ? 'Link unavailable' : 'Verifying your email' : 'Check your inbox'}</h1><p className="mx-auto mb-7 mt-4 max-w-[37ch] text-sm leading-relaxed text-[#6d716b]">{notice?.message}</p>{!verify ? <form className="grid gap-4 text-left" onSubmit={resend}><label className={fieldClass}>Email<input className={inputClass} name="email" type="email" autoComplete="email" defaultValue={sessionStorage.getItem('verificationEmail') || ''} required /></label><button className="neutral-button" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Resend email'}</button><button className="text-center text-sm font-semibold text-[#414851] underline underline-offset-3" type="button" onClick={() => navigate('/')}>Continue to login</button></form> : <button className={complete ? `${primaryClass} w-full` : 'neutral-button w-full'} onClick={() => navigate(complete ? '/' : '/check-email')}>{complete ? 'Continue to login →' : 'Request a new link'}</button>}</section></div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] shadow-[0_24px_70px_rgba(39,44,40,.24)]"><header className="flex items-center justify-between border-b border-[#d8d6ce] px-7 py-6"><h2 className="m-0 text-3xl font-bold tracking-[-.04em]">{title}</h2><button className="panel-close" type="button" onClick={onClose}>×</button></header><div className="p-7">{children}</div></section></div>;
}

function EntityForm({ initial, labels, busy, notice, onSubmit }: { initial?: { name: string; description: string | null }; labels: { name: string; submit: string }; busy: boolean; notice: Notice; onSubmit: (name: string, description: string) => void }) {
  return <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = formValues(event.currentTarget); onSubmit(String(values.name), String(values.description ?? '')); }}><label className={fieldClass}>{labels.name}<input className={inputClass} name="name" defaultValue={initial?.name} required maxLength={100} /></label><label className={fieldClass}>Description<textarea className={`${inputClass} min-h-24 py-3`} name="description" defaultValue={initial?.description ?? ''} maxLength={500} /></label><NoticeView notice={notice} /><SubmitButton busy={busy}>{labels.submit}</SubmitButton></form>;
}

function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [projectTeams, setProjectTeams] = useState<ProjectTeam[]>([]);
  const [team, setTeam] = useState<ProjectTeam | null>(null);
  const [identityTeam, setIdentityTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [capabilities, setCapabilities] = useState<TeamCapabilities | null>(null);
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<'projects' | 'profile' | 'settings' | null>('projects');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('activityPanelWidth'));
    return saved >= 240 && saved <= 520 ? saved : 300;
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (projectId?: string | null, teamId?: string | null) => {
    setNotice(null);
    try {
      const [nextProjects, nextTeams] = await Promise.all([listProjects(), listTeams()]);
      const nextProject = nextProjects.find((item) => item.projectId === projectId) ?? null;
      const nextProjectTeams = nextProject ? await listProjectTeams(nextProject.projectId) : [];
      const nextTeam = nextProjectTeams.find((item) => item.teamId === teamId) ?? null;
      const owned = nextTeam ? nextTeams.find((item) => item.teamId === nextTeam.teamId) ?? null : null;
      let detail: Team | null = null; let nextMembers: TeamMember[] = []; let caps: TeamCapabilities | null = null; let streams: Workstream[] = [];
      if (nextProject && nextTeam && owned) [detail, nextMembers, caps, streams] = await Promise.all([getTeam(nextTeam.teamId), listTeamMembers(nextTeam.teamId), getMyTeamCapabilities(nextTeam.teamId), listWorkstreams(nextProject.projectId, nextTeam.teamId)]);
      setProjects(nextProjects); setTeams(nextTeams); setProject(nextProject); setProjectTeams(nextProjectTeams); setTeam(nextTeam); setIdentityTeam(detail); setMembers(nextMembers); setCapabilities(caps); setWorkstreams(streams);
    } catch (error) { setNotice({ message: messageFor(error, 'Unable to load projects.') }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const execute = async (action: () => Promise<unknown>, reloadProject = project?.projectId ?? null, reloadTeam = team?.teamId ?? null) => {
    setBusy(true); setNotice(null);
    try { await action(); setDialog(null); await load(reloadProject, reloadTeam); }
    catch (error) { setNotice({ message: messageFor(error, 'The request could not be completed.') }); }
    finally { setBusy(false); }
  };
  const can = (capability: string) => capabilities?.capabilities.includes(capability as never) ?? false;
  const canManageProject = !!project && (project.createdBy === getCurrentUser()?.id || teams.some((item) => ['ADMIN', 'TEAM_LEAD'].includes(item.role)));
  const assignableTeams = teams.filter((item) => ['ADMIN', 'TEAM_LEAD'].includes(item.role) && !projectTeams.some((assigned) => assigned.teamId === item.teamId));

  const openProfile = async () => { setPanel('profile'); try { setProfile(await authenticatedRequest<UserProfile>('/api/users/me', 'GET')); } catch (error) { setNotice({ message: messageFor(error, 'Unable to load profile.') }); } };
  const signOut = async () => { try { await logout(); navigate('/'); } catch { setNotice({ message: 'Logout could not be confirmed. Try again while connected.' }); } };
  const deleteAccount = async () => {
    await authenticatedRequest('/api/users/me', 'DELETE');
    try { await logout(); } catch { /* The deleted account no longer needs a server logout. */ }
    navigate('/');
  };
  const askToLogOut = () => setConfirmation({ title: 'Log out?', message: 'Are you sure you want to log out of Conflux on this device?', label: 'Continue', action: signOut });
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

  const projectNavigation = <nav className="team-sidebar bg-[#efede6] p-4" aria-label="Projects">
    <div className="mb-4 flex items-center justify-between gap-3 px-1"><h2 className="m-0 text-base font-semibold tracking-[-.02em]">PROJECTS</h2><button className="neutral-button project-create-compact" type="button" onClick={() => setDialog({ kind: 'project' })}>Create</button></div>
    <div className="grid gap-1">{projects.map((item) => <div key={item.projectId}><button className={`team-section-link project-switch ${item.projectId === project?.projectId ? 'is-active' : ''}`} type="button" aria-expanded={item.projectId === project?.projectId} onClick={() => void load(item.projectId === project?.projectId ? null : item.projectId, null)}><span className="truncate">{item.name}</span><svg className="size-3 shrink-0 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>{item.projectId === project?.projectId && <div className="ml-4 grid gap-1 border-l border-[#c7c5bd] pl-2"><p className="project-nav-heading">TEAMS</p>{projectTeams.map((itemTeam) => <button className={`team-section-link project-team-switch ${itemTeam.teamId === team?.teamId ? 'is-active' : ''}`} type="button" key={itemTeam.teamId} onClick={() => void load(item.projectId, itemTeam.teamId)}><span className="truncate">{itemTeam.name || 'Unnamed team'}</span></button>)}<p className="project-nav-heading mt-2">PROJECT TOOLS</p><button className="team-section-link" type="button" disabled title="Project-wide chat will be connected through Collaboration Service">Project chat<span className="team-section-status">Later</span></button></div>}</div>)}</div>
  </nav>;

  const workspaceContent = !project ? <section className="team-content grid min-h-[420px] place-items-center bg-[#f8f7f2] px-7 text-center"><div><h1 className="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h1><p className="mb-0 mt-2 text-sm text-[#6d716b]">Choose a project to view its teams.</p></div></section> : <section className="team-content min-h-[420px] min-w-0 overflow-hidden bg-[#f8f7f2]">
    <header className="border-b border-[#d8d6ce] px-6 py-6"><div className="flex items-start justify-between gap-5"><div className="flex min-w-0 items-start gap-3">{team && <button className="panel-action team-back-button mt-0.5 shrink-0 rounded-xl" type="button" aria-label="Back to project" title="Back to project" onClick={() => void load(project.projectId, null)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></button>}<div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h1 className="m-0 truncate text-3xl font-bold tracking-[-.04em]">{team?.name || project.name}</h1>{team && identityTeam && can('MANAGE_TEAM') && <button className="inline-edit shrink-0 rounded-lg" type="button" aria-label="Edit team" title="Edit team" onClick={() => setDialog({ kind: 'team', team: identityTeam })}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg></button>}</div><p className="mb-0 mt-2 max-w-[70ch] text-sm leading-relaxed text-[#6d716b]">{team?.description || project.description || 'No description added.'}</p></div></div>{!team && canManageProject ? <button className="neutral-button shrink-0" type="button" onClick={() => setDialog({ kind: 'project', project })}>Edit project</button> : team && canManageProject ? <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => confirm(`Remove ${team.name} from ${project.name}?`) && void execute(() => removeProjectTeam(project.projectId, team.teamId), project.projectId, null)}>Remove team</button> : null}</div></header>
    {!team ? <section className="px-6 py-6"><div className="flex items-center justify-between gap-4"><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Teams <span className="text-sm font-medium text-[#6d716b]">({projectTeams.length})</span></h3>{canManageProject && <div className="flex gap-2">{assignableTeams.length > 0 && <button className="neutral-button" type="button" onClick={() => setDialog({ kind: 'assign-team', project, teams: assignableTeams })}>Add team</button>}<button className="neutral-button-filled" type="button" onClick={() => setDialog({ kind: 'team', projectId: project.projectId })}>Create team</button></div>}</div><div className="mt-4 divide-y divide-[#d8d6ce]">{projectTeams.map((item) => <button className="project-team-row block w-full py-4 text-left" key={item.teamId} type="button" onClick={() => void load(project.projectId, item.teamId)}><strong className="block truncate text-sm">{item.name || 'Unnamed team'}</strong><span className="mt-1 block truncate text-xs text-[#6d716b]">{item.description || 'No description added.'}</span></button>)}</div></section> : identityTeam && capabilities ? <><section className="px-6 py-6"><div className="flex items-center justify-between gap-4"><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Members</h3>{can('MANAGE_MEMBERS') && <button className="neutral-button-filled" type="button" onClick={() => setDialog({ kind: 'member', team: identityTeam, capabilities })}>Add member</button>}</div><div className="mt-3"><NoticeView notice={notice} /><div className="divide-y divide-[#d8d6ce]">{members.map((member) => <article className="py-4" key={member.userId}><div className="flex items-center justify-between gap-4"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><strong className="truncate text-sm font-semibold">{member.fullName || member.username}</strong><span className="shrink-0 text-xs text-[#59616c]">{member.role.replaceAll('_', ' ')}</span></div><span className="mt-1 block truncate text-xs text-[#6d716b]">@{member.username} · Joined {new Date(member.joinedAt).toLocaleDateString()}</span></div>{can('MANAGE_MEMBERS') && <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => confirm(`Remove @${member.username}?`) && void execute(() => removeTeamMember(identityTeam.teamId, member.userId))}>Remove</button>}</div>{can('MANAGE_ROLES') && <select className="field-input member-role mt-3 h-12 w-full text-sm" value={member.role} disabled={busy} onChange={(event) => void execute(() => updateTeamMemberRole(identityTeam.teamId, member.userId, event.target.value as UserRole))}>{roles.map((role) => <option key={role}>{role}</option>)}</select>}</article>)}</div></div></section><section className="border-t border-[#d8d6ce] px-6 py-6"><div className="flex items-center justify-between gap-4"><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Workstreams</h3>{can('CREATE_WORKSTREAM') && <button className="neutral-button-filled" type="button" onClick={() => setDialog({ kind: 'workstream', project, team })}>Create workstream</button>}</div>{workstreams.length ? <div className="mt-4 divide-y divide-[#d8d6ce]">{workstreams.map((stream) => <article className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={stream.workstreamId}><div className="min-w-0"><strong className="block truncate text-sm">{stream.name}</strong><span className="mt-1 block truncate font-mono text-[11px] text-[#6d716b]">{stream.branchName}</span></div><span className="rounded-full bg-[#e3e1da] px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[.04em]">{stream.status.replaceAll('_', ' ')}</span></article>)}</div> : <p className="mb-0 mt-4 text-sm text-[#6d716b]">No workstreams for this team yet.</p>}</section></> : <section className="grid min-h-64 place-items-center px-7 py-12 text-center"><div><h3 className="m-0 text-lg font-semibold">Team access is limited</h3><p className="mb-0 mt-2 max-w-[42ch] text-sm leading-relaxed text-[#6d716b]">You can see this team belongs to the project, but its members and workstreams are available only to team members.</p></div></section>}
  </section>;

  return <main className={`app-workspace min-h-dvh bg-[#f8f7f2] ${panel ? 'activity-panel-open' : ''}`} style={{ '--activity-panel-width': `${panelWidth}px` } as React.CSSProperties}>
    <nav className="activity-rail fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center border-r border-[#d8d6ce] bg-[#efede6] py-1" aria-label="Primary navigation"><img className="mt-1 size-8 rounded-[9px] object-cover" src={logoUrl} alt="Conflux" /><div className="mt-auto grid gap-1"><button className="rail-button" aria-label="Projects" aria-pressed={panel === 'projects'} title="Projects" onClick={() => setPanel(panel === 'projects' ? null : 'projects')}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 19c.5-3.7 2.3-5.5 5.5-5.5s5 1.8 5.5 5.5M14 15c3.8-.5 5.9.8 6.5 4"/></svg></button><button className="rail-button" aria-label="Profile" aria-pressed={panel === 'profile'} title="Profile" onClick={() => void openProfile()}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/><circle cx="12" cy="12" r="10"/></svg></button><button className="rail-button" aria-label="Settings" aria-pressed={panel === 'settings'} title="Settings" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg></button></div></nav>
    {panel && <aside className="activity-panel fixed bottom-1 left-13 top-1 z-10 overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#efede6]" aria-label="Activity panel"><div className="activity-panel-surface">
      {panel === 'projects' && projectNavigation}
      {panel === 'profile' && <div className="grid gap-5 px-5 pb-5 pt-5">{profile ? <><header className="flex items-center justify-between"><h2 className="m-0 text-lg font-semibold tracking-[-.02em]">Profile</h2><button className="panel-close" type="button" onClick={() => setPanel(null)}>×</button></header><section className="rounded-xl bg-[#e8e6df] p-4"><div className="flex items-center gap-3.5"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-[#4b535d] text-xl font-bold text-white">{profile.username.charAt(0).toUpperCase()}</div><div className="min-w-0"><strong className="block truncate text-base font-semibold">{profile.firstName} {profile.middleName} {profile.lastName}</strong><span className="mt-0.5 block truncate text-sm text-[#6d716b]">@{profile.username}</span></div></div><p className="mb-0 mt-4 break-all text-sm text-[#59616c]">{profile.email}</p></section><button className="neutral-button w-full" type="button" onClick={() => setDialog({ kind: 'profile', profile })}>Edit profile</button><button className="danger-button w-full" type="button" onClick={askToLogOut}>Log out</button><section className="rounded-xl bg-[#f8eae7] p-4"><h3 className="m-0 text-sm font-semibold text-[#7f342e]">Delete account</h3><p className="mb-4 mt-1.5 text-xs leading-relaxed text-[#694944]">Permanently remove your account and profile data.</p><button className="danger-button w-full" type="button" onClick={askToDeleteAccount}>Delete account</button></section></> : <p className="p-4">Loading profile…</p>}</div>}
      {panel === 'settings' && <div className="grid gap-7 px-7 pb-7 pt-4"><div className="flex justify-end"><button className="panel-close" type="button" onClick={() => setPanel(null)}>×</button></div><div className="grid justify-items-center text-center"><div className="grid size-20 place-items-center rounded-full bg-[#4b535d] text-white"><svg className="size-9 fill-none stroke-current stroke-[1.6]" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg></div><strong className="mt-4 text-lg font-semibold">Settings</strong><span className="mt-1 text-sm text-[#6d716b]">Customize your Conflux experience</span></div><button className="neutral-button flex w-full items-center justify-center gap-2.5" id="theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button></div>}
    </div><button className="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" type="button" aria-label="Resize activity panel" title="Drag to resize" onPointerDown={resizePanel} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setPanelWidth(Math.max(240, panelWidth - 20)); if (event.key === 'ArrowRight') setPanelWidth(Math.min(520, panelWidth + 20)); }}></button>
    </aside>}
    <section className="editor-stage m-1 min-h-[calc(100dvh-.5rem)] rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] px-4 py-8 sm:px-8 lg:px-12 lg:py-10">
      <div className="mx-auto w-full max-w-[1400px]"><div id="team-workspace">{workspaceContent}</div><div className="mt-4"><NoticeView notice={notice} /></div></div>
    </section>
    {dialog?.kind === 'project' && <Modal title={dialog.project ? 'Edit project' : 'Create project'} onClose={() => setDialog(null)}><EntityForm initial={dialog.project} labels={{ name: 'Project name', submit: dialog.project ? 'Save project' : 'Create project' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.project) await updateProject(dialog.project.projectId, name, description); else { const created = await createProject(name, description); await load(created.projectId, null); } })} /></Modal>}
    {dialog?.kind === 'team' && <Modal title={dialog.team ? 'Edit team' : 'Create team'} onClose={() => setDialog(null)}><EntityForm initial={dialog.team} labels={{ name: 'Team name', submit: dialog.team ? 'Save team' : 'Create team' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.team) await updateTeam(dialog.team.teamId, name, description); else { const created = await createTeam(name, description); if (dialog.projectId) await assignProjectTeam(dialog.projectId, created.teamId); } }, dialog.projectId ?? project?.projectId, dialog.team?.teamId ?? null)} /></Modal>}
    {dialog?.kind === 'assign-team' && <Modal title="Assign team" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const teamId = String(new FormData(event.currentTarget).get('teamId')); void execute(() => assignProjectTeam(dialog.project.projectId, teamId), dialog.project.projectId, teamId); }}><select className={inputClass} name="teamId" required>{dialog.teams.map((item) => <option value={item.teamId} key={item.teamId}>{item.name}</option>)}</select><SubmitButton busy={busy}>Assign team</SubmitButton></form></Modal>}
    {dialog?.kind === 'member' && <Modal title="Add member" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = formValues(event.currentTarget); void execute(() => addTeamMember(dialog.team.teamId, String(values.email), String(values.role) as UserRole)); }}><label className={fieldClass}>Email<input className={inputClass} name="email" type="email" required /></label><label className={fieldClass}>Role<select className={inputClass} name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></label><SubmitButton busy={busy}>Add member</SubmitButton></form></Modal>}
    {dialog?.kind === 'workstream' && <Modal title="Create workstream" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = formValues(event.currentTarget); void execute(() => createWorkstream(dialog.project.projectId, dialog.team.teamId, String(values.name), String(values.branchName), String(values.baseRevision))); }}><label className={fieldClass}>Name<input className={inputClass} name="name" required /></label><label className={fieldClass}>Branch name<input className={inputClass} name="branchName" required /></label><label className={fieldClass}>Base revision<input className={inputClass} name="baseRevision" required /></label><SubmitButton busy={busy}>Create workstream</SubmitButton></form></Modal>}
    {dialog?.kind === 'profile' && <Modal title="Edit profile" onClose={() => setDialog(null)}><form className="grid gap-5" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setNotice(null); const values = formValues(event.currentTarget); try { const updated = await authenticatedRequest<UserProfile>('/api/users/me', 'PUT', values); setProfile(updated); setDialog(null); } catch (error) { setNotice({ message: messageFor(error, 'Unable to update your profile.') }); } finally { setBusy(false); } }}><div className="grid grid-cols-2 gap-4"><label className="field-label">First name<input className="field-input" name="firstName" defaultValue={dialog.profile.firstName} required maxLength={50} /></label><label className="field-label">Last name<input className="field-input" name="lastName" defaultValue={dialog.profile.lastName} required maxLength={50} /></label></div><label className="field-label">Middle name <span>(optional)</span><input className="field-input" name="middleName" defaultValue={dialog.profile.middleName ?? ''} maxLength={50} /></label><label className="field-label">Username<input className="field-input" name="username" defaultValue={dialog.profile.username} required minLength={5} maxLength={50} pattern="[a-zA-Z0-9._-]+" /></label><label className="field-label">Email<input className="field-input bg-[#efede6] text-[#777b75]" value={dialog.profile.email} disabled /></label><NoticeView notice={notice} /><div className="grid grid-cols-2 gap-3"><button className="neutral-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="neutral-button-filled" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Save changes'}</button></div></form></Modal>}
    {confirmation && <div className="fixed inset-0 z-[60] grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}><section className="confirmation-dialog w-full max-w-[390px] border border-[#c7c5bd] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message"><h2 className="m-0 text-xl font-bold tracking-[-.03em]" id="confirmation-title">{confirmation.title}</h2><p className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="confirmation-message">{confirmation.message}</p><div className="grid grid-cols-2 gap-3"><button className="neutral-button" type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="danger-button" type="button" disabled={busy} onClick={() => { const action = confirmation.action; setBusy(true); void action().catch((error) => setNotice({ message: messageFor(error, 'The action could not be completed.') })).finally(() => { setBusy(false); setConfirmation(null); }); }}>{busy ? 'Please wait…' : confirmation.label}</button></div></section></div>}
  </main>;
}

export function App() {
  const [route, setRoute] = useState<Route>(location.pathname as Route);
  const [ready, setReady] = useState(false);
  useEffect(() => { const update = () => setRoute(location.pathname as Route); addEventListener('popstate', update); void restoreSession().finally(() => setReady(true)); return () => removeEventListener('popstate', update); }, []);
  if (!ready) return <main className="grid min-h-dvh place-items-center bg-[#f8f7f2]">Loading Conflux…</main>;
  if (route === '/app') return isAuthenticated() ? <Workspace /> : <Login onAuthenticated={() => navigate('/app')} />;
  if (isAuthenticated()) { queueMicrotask(() => navigate('/app')); return null; }
  if (route === '/sign-up') return <Register />;
  if (route === '/check-email') return <EmailStatus verify={false} />;
  if (route === '/verify-email') return <EmailStatus verify />;
  return <Login onAuthenticated={() => navigate('/app')} />;
}
