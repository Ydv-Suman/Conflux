import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
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
} from './features/auth/session';
import { API_URL, OAUTH_PATH } from './config';
import githubIcon from './assets/icons/github.svg';
import googleIcon from './assets/icons/google.svg';
import {
  inviteTeamMember,
  createTeam,
  getMyTeamCapabilities,
  type TeamInvitation,
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
  getDefaultWorkstream,
  getProjectRepository,
  type ProjectRepository,
  listProjects,
  listProjectTeams,
  listWorkstreams,
  removeProjectTeam,
  updateProject,
  type Project,
  type ProjectTeam,
  type Workstream,
} from './features/projects/api';
import { initializeSharedWorkspace, isRepositoryReady, openSharedRepository } from './features/projects/sharedWorkspace';
import { InvitationProjects } from './features/projects/InvitationProjects';
import { RepositorySettings } from './features/projects/RepositorySettings';
import { downloadSharedProject } from './features/projects/projectDownload';
import { SharedWorkspaceSetup } from './features/projects/SharedWorkspaceSetup';
import { EditorWorkspace } from './features/editor/EditorWorkspace';
import { FontSettings, readFontPreferences, saveFontPreferences, FILE_FONT_FAMILIES, EDITOR_FONT_FAMILIES, fontFamilyCss } from './features/editor/FontSettings';
import { RepositoryExplorer } from './features/repository/RepositoryExplorer';
import { InvitationInbox, PendingTeamInvitations, useInvitationInbox } from './features/invitations/Invitations';
import {
  connectRepository,
  isDesktop,
  loadLastWorkspace,
  readRepositoryFile,
  rememberOpenFile,
  restoreRepository,
  saveLastWorkspace,
  selectUnlinkedRepository,
  writeRepositoryFile,
  type RepositoryFile,
  type RepositoryInfo,
} from './features/repository/api';

type Route = '/' | '/sign-up' | '/check-email' | '/verify-email' | '/app';
type Notice = { message: string; kind?: 'error' | 'success' } | null;
type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'repository-settings'; project: Project }
  | { kind: 'fonts' }
  | { kind: 'joined-team'; invitation: TeamInvitation }
  | { kind: 'team'; team?: Team; projectId?: string }
  | { kind: 'assign-team'; project: Project; teams: Team[] }
  | { kind: 'member'; team: Team; capabilities: TeamCapabilities }
  | { kind: 'profile'; profile: UserProfile }
  | null;
type Confirmation = { title: string; message: string; label: string; action: () => Promise<void> } | null;
type RequestError = { title: string; message: string; actionLabel?: string; action?: () => Promise<void> } | null;

const fieldClass = 'form-label grid gap-2 text-xs font-semibold text-[#30342f]';
const inputClass = 'form-input h-11 w-full rounded-lg border border-[#c9c9c1] bg-[#fffefa] px-3 text-sm font-normal text-[#1d211e] outline-none transition duration-200 placeholder:text-[#969990] hover:border-[#999d96] focus:border-[#66707c] focus:ring-3 focus:ring-[#66707c]/15';
const primaryClass = 'flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-[#343a42] bg-[#343a42] px-4 font-bold text-white transition duration-200 hover:bg-[#484f59] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25 disabled:cursor-wait disabled:opacity-65';
const socialClass = 'flex min-h-12 cursor-pointer items-center justify-center gap-3 rounded-lg border border-[#c9c9c1] bg-[#fffefa] font-semibold text-[#252925] transition duration-200 hover:border-[#8d938b] hover:bg-[#f4f4ee] active:translate-y-px focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#66707c]/25';
const roles: UserRole[] = ['ADMIN', 'TEAM_LEAD', 'SENIOR_DEVELOPER', 'DEVELOPER', 'VIEWER'];
const messageFor = (error: unknown, fallback: string) => error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
const formValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

function navigate(path: Route) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function NoticeView({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <output className={`form-notice border-l-3 px-3 py-2 text-xs ${notice.kind === 'success' ? 'is-success border-[#66707c] bg-[#e8e9e7] text-[#414851]' : 'is-error border-[#a54d45] bg-[#f8eae7] text-[#7f342e]'}`} role="alert">{notice.message}</output>;
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
  return <div className="auth-page grid min-h-dvh bg-[#f8f7f2] md:grid-cols-[minmax(300px,.78fr)_minmax(440px,1.22fr)]"><Brand /><section className="grid place-items-center px-6 py-10 md:px-[clamp(34px,7vw,90px)] md:py-11">{children}</section></div>;
}

function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setNotice(null);
    const values = formValues(event.currentTarget);
    try { await login(String(values.usernameOrEmail), String(values.password)); onAuthenticated(); }
    catch (error) { setLoginError(error instanceof ApiError && error.status === 401 ? 'Incorrect username/email or password.' : messageFor(error, 'Unable to log in.')); }
    finally { setBusy(false); }
  };
  return <AuthShell><div className="w-full max-w-[510px]">
    <h2 className="mb-8 text-center text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em] text-[#111317]">Welcome back</h2>
    <form ref={formRef} className="grid gap-4" onSubmit={submit}><label className={fieldClass}>Email address/Username<input className={inputClass} name="usernameOrEmail" autoComplete="username" maxLength={100} required /></label><label className={fieldClass}>Password<PasswordInput name="password" autoComplete="current-password" /></label><NoticeView notice={notice} /><SubmitButton busy={busy} className="w-40 justify-self-center">Log in <span aria-hidden="true">→</span></SubmitButton></form>
    {loginError && <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal(); }} onCancel={() => setLoginError(null)} aria-labelledby="login-error-title" aria-describedby="login-error-message" className="fixed left-1/2 md:left-[68%] top-[42%] m-0 max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[#c9786f] bg-[#f8f7f2] p-6 text-[#1d211e] shadow-xl backdrop:bg-black/45"><h2 id="login-error-title" className="m-0 text-xl font-bold">Unable to log in</h2><p id="login-error-message" className="my-5 text-sm leading-relaxed">{loginError}</p><button autoFocus type="button" className={`${primaryClass} w-full`} onClick={() => { setLoginError(null); formRef.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus(); }}>Try again</button></dialog>}
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
  const verification = useRef<{ token: string; request: Promise<void> } | null>(null);
  useEffect(() => {
    if (!verify) return;
    const token = new URL(location.href).searchParams.get('token') || '';
    let active = true;
    // StrictMode replays effects; reuse the request so a link is submitted only once.
    if (verification.current?.token !== token) {
      verification.current = { token, request: post('/api/users/verify-email', { token }) };
    }
    void verification.current.request
      .then(() => { if (active) setNotice({ message: 'Email verified. You can now sign in.', kind: 'success' }); })
      .catch((error) => { if (active) setNotice({ message: messageFor(error, 'This verification link is invalid or expired.') }); });
    return () => { active = false; };
  }, [verify]);
  const resend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    try { await post('/api/users/resend-verification', { email: new FormData(event.currentTarget).get('email') }); setNotice({ message: 'If eligible, verification instructions will be sent.', kind: 'success' }); }
    catch (error) { setNotice({ message: messageFor(error, 'Unable to resend the email.') }); }
    finally { setBusy(false); }
  };
  const failed = verify && notice?.kind !== 'success' && notice?.message !== 'Verifying your email…';
  const complete = verify && notice?.kind === 'success' && notice.message.startsWith('Email verified');
  return <div className="auth-page grid min-h-dvh grid-rows-[auto_1fr_auto] bg-[#efede6] p-[clamp(26px,5vw,52px)]"><img className="mx-auto size-16 object-cover" src={logoUrl} alt="Conflux" /><section className="w-full max-w-[480px] place-self-center border border-[#d2d0c7] bg-[#faf9f4] p-[clamp(34px,7vw,60px)] text-center shadow-[0_24px_70px_-52px_rgba(27,35,30,.5)]"><span className={`mx-auto mb-6 grid size-[72px] place-items-center rounded-full ${failed ? 'bg-[#f3e5e2] text-[#8a3f39]' : 'bg-[#e8e9e7] text-[#414851]'}`} aria-hidden="true"><svg className="size-8 fill-none stroke-current stroke-[1.7] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24">{failed ? <><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></> : complete ? <path d="m5 12 4 4L19 6"/> : <><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></>}</svg></span><p className="mb-3 font-mono text-[10px] font-bold tracking-[.12em] text-[#59616c]">EMAIL VERIFICATION</p><h1 className="m-0 text-[clamp(30px,4vw,43px)] leading-none font-bold tracking-[-.045em]">{verify ? complete ? 'Email verified' : failed ? 'Link unavailable' : 'Verifying your email' : 'Check your inbox'}</h1><p className="mx-auto mb-7 mt-4 max-w-[37ch] text-sm leading-relaxed text-[#6d716b]">{notice?.message}</p>{!verify ? <form className="grid gap-4 text-left" onSubmit={resend}><label className={fieldClass}>Email<input className={inputClass} name="email" type="email" autoComplete="email" defaultValue={sessionStorage.getItem('verificationEmail') || ''} required /></label><button className="neutral-button" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Resend email'}</button><button className="text-center text-sm font-semibold text-[#414851] underline underline-offset-3" type="button" onClick={() => navigate('/')}>Continue to login</button></form> : <button className={complete ? `${primaryClass} w-full` : 'neutral-button w-full'} onClick={() => navigate(complete ? '/' : '/check-email')}>{complete ? 'Continue to login →' : 'Request a new link'}</button>}</section></div>;
}

function Modal({ title, children, onClose, compact = false }: { title: string; children: ReactNode; onClose: () => void; compact?: boolean }) {
  const surface = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = surface.current;
    (element?.querySelector<HTMLElement>('input, button, select, textarea') ?? element)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab' || !element) return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    element?.addEventListener('keydown', handleKey);
    return () => { element?.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={surface} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal-surface ${compact ? 'modal-compact' : ''} max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] shadow-[0_24px_70px_rgba(39,44,40,.24)]`}><header className="flex items-center justify-between border-b border-[#d8d6ce] px-7 py-6"><h2 className="m-0 text-3xl font-bold tracking-[-.04em]">{title}</h2><button className="panel-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button></header><div className="p-7">{children}</div></section></div>;
}

function EntityForm({ initial, labels, busy, notice, onSubmit }: { initial?: { name: string; description: string | null }; labels: { name: string; submit: string }; busy: boolean; notice: Notice; onSubmit: (name: string, description: string) => void }) {
  return <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const values = formValues(event.currentTarget); onSubmit(String(values.name), String(values.description ?? '')); }}><label className={fieldClass}>{labels.name}<input className={inputClass} name="name" defaultValue={initial?.name} required maxLength={100} /></label><label className={fieldClass}>Description<textarea className={`${inputClass} min-h-24 py-3`} name="description" defaultValue={initial?.description ?? ''} maxLength={500} /></label><NoticeView notice={notice} /><SubmitButton busy={busy}>{labels.submit}</SubmitButton></form>;
}

const roleRank: Record<UserRole, number> = { ADMIN: 0, TEAM_LEAD: 1, SENIOR_DEVELOPER: 2, DEVELOPER: 3, VIEWER: 4 };

function TeamMemberList({ members, capabilities, busy, onRoleChange, onRemove }: { members: TeamMember[]; capabilities: TeamCapabilities; busy: boolean; onRoleChange: (member: TeamMember, role: UserRole) => Promise<void>; onRemove: (member: TeamMember) => void }) {
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('VIEWER');
  const actorRole = capabilities.role;
  const canManage = (member: TeamMember) => capabilities.capabilities.includes('MANAGE_ROLES') && (actorRole === 'ADMIN' || roleRank[actorRole] < roleRank[member.role]);
  const allowedRoles = roles.filter((role) => actorRole === 'ADMIN' || roleRank[actorRole] < roleRank[role]);

  return <div className="divide-y divide-[#d8d6ce]">{members.map((member) => {
    const manageable = canManage(member);
    return <article className="relative py-4" key={member.userId}><div className="flex items-center justify-between gap-4"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><strong className="truncate text-sm font-semibold">{member.fullName || member.username}</strong><span className="shrink-0 text-xs text-[#59616c]">{member.role.replaceAll('_', ' ')}</span>{manageable && <button className="member-role-edit" type="button" aria-label={`Edit ${member.username}'s role`} title="Edit role" aria-expanded={editing?.userId === member.userId} onClick={() => { setEditing(editing?.userId === member.userId ? null : member); setSelectedRole(member.role); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg></button>}</div><span className="mt-1 block truncate text-xs text-[#6d716b]">@{member.username} · Joined {new Date(member.joinedAt).toLocaleDateString()}</span></div>{manageable && capabilities.capabilities.includes('MANAGE_MEMBERS') && <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => onRemove(member)}>Remove</button>}</div>
      {editing?.userId === member.userId && <><button className="member-role-backdrop" type="button" aria-label="Close role editor" onClick={() => setEditing(null)} /><div className="member-role-popover" role="dialog" aria-modal="true" aria-label={`Change ${member.username}'s role`}><label className="field-label">Role<select className="field-input" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as UserRole)}>{allowedRoles.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></label><div className="mt-3 grid grid-cols-2 gap-2"><button className="neutral-button min-h-9" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="neutral-button-filled min-h-9" type="button" disabled={busy || selectedRole === member.role} onClick={() => void onRoleChange(member, selectedRole).then(() => setEditing(null))}>{busy ? 'Saving…' : 'Save'}</button></div></div></>}
    </article>;
  })}</div>;
}

function Workspace() {
  const invitationInbox = useInvitationInbox();
  const [invitationRevision, setInvitationRevision] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [projectTeams, setProjectTeams] = useState<ProjectTeam[]>([]);
  const [team, setTeam] = useState<ProjectTeam | null>(null);
  const [identityTeam, setIdentityTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [capabilities, setCapabilities] = useState<TeamCapabilities | null>(null);
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [activeWorkstream, setActiveWorkstream] = useState<Workstream | null>(null);
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [repositoryAttempt, setRepositoryAttempt] = useState(0);
  const [remoteRepository, setRemoteRepository] = useState<ProjectRepository | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const loadVersion = useRef(0);
  const pendingWorkspace = useRef(false);
  const canLeaveWorkspace = useCallback(() => !pendingWorkspace.current || window.confirm(
    'Leave this workspace? Unsaved or unsynchronized changes in open tabs may be lost. Save locally or reconnect first to keep them.',
  ), []);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<'explorer' | 'projects' | 'profile' | 'settings' | 'invitations' | null>('projects');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
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
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (projectId?: string | null, teamId?: string | null, openShared = true) => {
    if (!canLeaveWorkspace()) return;
    const version = ++loadVersion.current;
    setLoading(true); setNotice(null); setOpenFile(null); setRepository(null); setActiveWorkstream(null);
    try {
      const [nextProjects, nextTeams] = await Promise.all([listProjects(), listTeams()]);
      const nextProject = nextProjects.find((item) => item.projectId === projectId) ?? null;
      const nextProjectTeams = nextProject ? await listProjectTeams(nextProject.projectId) : [];
      const nextTeam = nextProjectTeams.find((item) => item.teamId === teamId) ?? null;
      const owned = nextTeam ? nextTeams.find((item) => item.teamId === nextTeam.teamId) ?? null : null;
      let detail: Team | null = null; let nextMembers: TeamMember[] = []; let caps: TeamCapabilities | null = null; let streams: Workstream[] = []; let shared: Workstream | null = null;
      if (nextProject && nextTeam && owned) [detail, nextMembers, caps, streams, shared] = await Promise.all([getTeam(nextTeam.teamId), listTeamMembers(nextTeam.teamId), getMyTeamCapabilities(nextTeam.teamId), listWorkstreams(nextProject.projectId, nextTeam.teamId), getDefaultWorkstream(nextProject.projectId, nextTeam.teamId)]);
      if (version !== loadVersion.current) return;
      setProjects(nextProjects); setTeams(nextTeams); setProject(nextProject); setProjectTeams(nextProjectTeams); setTeam(nextTeam); setIdentityTeam(detail); setMembers(nextMembers); setCapabilities(caps); setWorkstreams(shared ? [shared, ...streams.filter((stream) => stream.workstreamId !== shared.workstreamId)] : streams); setActiveWorkstream(openShared ? shared : null);
      if (shared && openShared) setPanel('explorer');
    } catch (error) { if (version === loadVersion.current) setNotice({ message: messageFor(error, 'Unable to load projects.') }); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [canLeaveWorkspace]);
  useEffect(() => {
    if (!isDesktop()) { void load(); return; }
    void loadLastWorkspace().then((saved) => {
      if (!saved) return load();
      return load(saved.projectId, saved.teamId);
    }).catch(() => load());
  }, [load]);
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
    try { setOpenFile({ path: file.path, content: await readRepositoryFile(file.path) });  }
    catch (error) { setRequestError({ title: 'Unable to open file', message: messageFor(error, 'The file could not be opened.') }); }
  };
  const saveRepositoryFile = useCallback(async (path: string, content: string) => {
    try { await writeRepositoryFile(path, content); }
    catch (error) { setRequestError({ title: 'Unable to save file', message: messageFor(error, 'The file could not be saved.') }); throw error; }
  }, []);
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

  const projectNavigation = <nav className="team-sidebar bg-[#efede6] p-4" aria-label="Projects">
    <div className="mb-4 flex items-center justify-between gap-3 px-1"><h2 className="m-0 text-base font-semibold tracking-[-.02em]">PROJECTS</h2><button className="neutral-button project-create-compact" type="button" onClick={() => setDialog({ kind: 'project' })}>Create</button></div>
    <div className="grid gap-1">{projects.map((item) => <div key={item.projectId}><button className={`team-section-link project-switch ${item.projectId === project?.projectId ? 'is-active' : ''}`} type="button" aria-expanded={item.projectId === project?.projectId} disabled={busy || repositoryLoading || loading} onClick={() => void load(item.projectId === project?.projectId ? null : item.projectId, null)}><span className="truncate">{item.name}</span><svg className="size-3 shrink-0 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>{item.projectId === project?.projectId && <div className="ml-4 grid gap-1 border-l border-[#c7c5bd] pl-2"><p className="project-nav-heading">TEAMS</p>{projectTeams.map((itemTeam) => <button className={`team-section-link project-team-switch ${itemTeam.teamId === team?.teamId ? 'is-active' : ''}`} type="button" key={itemTeam.teamId} disabled={busy || repositoryLoading || loading} onClick={() => void load(item.projectId, itemTeam.teamId, !(activeWorkstream && team?.teamId === itemTeam.teamId))}><span className="truncate">{itemTeam.name || 'Unnamed team'}</span></button>)}<p className="project-nav-heading mt-2">PROJECT TOOLS</p><button className="team-section-link" type="button" disabled title="Project-wide chat will be connected through Collaboration Service">Project chat<span className="team-section-status">Later</span></button></div>}</div>)}</div>
  </nav>;

  const workspaceContent = loading ? <p className="p-7" role="status">Loading team workspace…</p> : activeWorkstream && project ? <div className="flex h-full flex-col">
    <div className="min-h-0 flex-1">{openFile && repository && !repositoryError && isRepositoryReady(activeWorkstream) ? <EditorWorkspace key={`${project.projectId}/${activeWorkstream.workstreamId}`} projectId={project.projectId} workstreamId={activeWorkstream.workstreamId} teamId={activeWorkstream.teamId} file={openFile} theme={theme} fontSize={fontPreferences.editor} fontFamily={fontFamilyCss(EDITOR_FONT_FAMILIES, fontPreferences.editorFamily)} onDirtyStateChange={(dirty) => { pendingWorkspace.current = dirty; }} onSave={saveRepositoryFile} onEmpty={() => setOpenFile(null)} onActivate={async (path) => { try { await rememberOpenFile(project.projectId, activeWorkstream.workstreamId, path); } catch (error) { setRequestError({ title: 'Unable to remember open file', message: messageFor(error, 'The file is open, but could not be remembered for next time.') }); } }} /> : <SharedWorkspaceSetup stream={activeWorkstream} repository={repository} desktop={isDesktop()} canInitialize={can('CREATE_WORKSTREAM')} busy={busy || repositoryLoading || remoteLoading} downloading={downloading} error={repositoryError || remoteError} remote={remoteRepository} canManageRepository={canManageProject} onConfigure={() => setDialog({ kind: 'repository-settings', project })} onDownload={can('JOIN_WORKSTREAM') ? () => void downloadProject(project, team!.teamId) : undefined} onConnect={() => void chooseRepository()} onInitialize={() => void setupSharedWorkspace()} onRetry={() => setRepositoryAttempt((attempt) => attempt + 1)} onExplore={() => setPanel('explorer')} />}</div>
  </div> : !project ? <section className="team-content grid min-h-[420px] place-items-center bg-[#f8f7f2] px-7 text-center"><div><h1 className="m-0 text-3xl font-bold tracking-[-.04em]">Welcome to Conflux</h1><p className="mb-0 mt-2 text-sm text-[#6d716b]">Choose a project to view its teams.</p></div></section> : <section className="team-content min-h-[420px] min-w-0 overflow-hidden bg-[#f8f7f2]">
    <header className="border-b border-[#d8d6ce] px-6 py-6"><div className="flex items-start justify-between gap-5"><div className="flex min-w-0 items-start gap-3">{team && <button className="panel-action team-back-button mt-0.5 shrink-0 rounded-xl" type="button" aria-label="Back to project" title="Back to project" disabled={busy || repositoryLoading || loading} onClick={() => void load(project.projectId, null)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></button>}<div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h1 className="m-0 truncate text-3xl font-bold tracking-[-.04em]">{team?.name || project.name}</h1>{team && identityTeam && can('MANAGE_TEAM') && <button className="inline-edit shrink-0 rounded-lg" type="button" aria-label="Edit team" title="Edit team" onClick={() => setDialog({ kind: 'team', team: identityTeam })}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg></button>}</div><p className="mb-0 mt-2 max-w-[70ch] text-sm leading-relaxed text-[#6d716b]">{team?.description || project.description || 'No description added.'}</p></div></div>{!team && canManageProject ? <button className="neutral-button shrink-0" type="button" onClick={() => setDialog({ kind: 'project', project })}>Edit project</button> : team && canManageProject ? <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => confirm(`Remove ${team.name} from ${project.name}?`) && void execute(() => removeProjectTeam(project.projectId, team.teamId), project.projectId, null)}>Remove team</button> : null}</div></header>
    {canManageProject && <div className="px-6 pt-4"><button className="neutral-button" type="button" disabled={busy} onClick={() => setDialog({ kind: 'repository-settings', project })}>Repository settings</button></div>}
    {!team ? <section className="px-6 py-6"><div className="flex items-center justify-between gap-4"><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Teams <span className="text-sm font-medium text-[#6d716b]">({projectTeams.length})</span></h3>{canManageProject && <div className="flex gap-2">{assignableTeams.length > 0 && <button className="neutral-button" type="button" onClick={() => setDialog({ kind: 'assign-team', project, teams: assignableTeams })}>Add team</button>}<button className="neutral-button-filled" type="button" onClick={() => setDialog({ kind: 'team', projectId: project.projectId })}>Create team</button></div>}</div><div className="mt-4 divide-y divide-[#d8d6ce]">{projectTeams.map((item) => <button className="project-team-row block w-full py-4 text-left" key={item.teamId} type="button" disabled={busy || repositoryLoading || loading} onClick={() => void load(project.projectId, item.teamId)}><strong className="block truncate text-sm">{item.name || 'Unnamed team'}</strong><span className="mt-1 block truncate text-xs text-[#6d716b]">{item.description || 'No description added.'}</span></button>)}</div></section> : identityTeam && capabilities ? <><section className="px-6 py-6"><div className="flex items-center justify-between gap-4"><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Members</h3>{can('MANAGE_MEMBERS') && <button className="neutral-button-filled" type="button" onClick={() => { setNotice(null); setDialog({ kind: 'member', team: identityTeam, capabilities }); }}>Invite member</button>}</div><div className="mt-3"><NoticeView notice={notice} /><TeamMemberList members={members} capabilities={capabilities} busy={busy} onRoleChange={(member, role) => execute(() => updateTeamMemberRole(identityTeam.teamId, member.userId, role))} onRemove={(member) => confirm(`Remove @${member.username}?`) && void execute(() => removeTeamMember(identityTeam.teamId, member.userId))} /></div>{can('MANAGE_MEMBERS') && <PendingTeamInvitations key={identityTeam.teamId} teamId={identityTeam.teamId} revision={invitationRevision} onMembersChanged={setMembers} />}</section><section className="border-t border-[#d8d6ce] px-6 py-6"><div className="flex items-center justify-between gap-4"><div><h3 className="m-0 text-lg font-semibold tracking-[-.02em]">Team workspace</h3><p className="mb-0 mt-1 text-xs text-[#6d716b]">One shared workspace for everyone on this team.</p></div>{sharedWorkstream && <button className="neutral-button-filled" type="button" disabled={busy || repositoryLoading} onClick={() => openWorkstream(sharedWorkstream)}>Open shared workspace</button>}</div>{workstreams.length ? <div className="mt-4 divide-y divide-[#d8d6ce]">{workstreams.map((stream) => <button className="workstream-row grid w-full gap-3 py-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" type="button" key={stream.workstreamId} disabled={busy || repositoryLoading} onClick={() => openWorkstream(stream)}><div className="min-w-0"><div className="flex items-center gap-2"><span className={`workstream-status-dot ${stream.status === 'ACTIVE' ? 'is-active' : ''}`} aria-hidden="true" /><strong className="truncate text-sm">{stream.name}{stream.defaultWorkstream ? ' · Shared' : ' · Previous work'}</strong></div><span className="ml-4 mt-1 block truncate font-mono text-[11px] text-[#6d716b]">{stream.branchName}</span></div><span className="workstream-open">Open <span aria-hidden="true">→</span></span></button>)}</div> : <div className="mt-5 border-l-2 border-[#c7c5bd] py-2 pl-4"><strong className="text-sm">Shared workspace unavailable</strong><p className="mb-0 mt-1 text-xs leading-relaxed text-[#6d716b]">Refresh the project to load its shared workspace.</p></div>}</section></> : <section className="grid min-h-64 place-items-center px-7 py-12 text-center"><div><h3 className="m-0 text-lg font-semibold">Team access is limited</h3><p className="mb-0 mt-2 max-w-[42ch] text-sm leading-relaxed text-[#6d716b]">You can see this team belongs to the project, but its members and workstreams are available only to team members.</p></div></section>}
  </section>;

  return <main className={`app-workspace min-h-dvh bg-[#f8f7f2] ${panel ? 'activity-panel-open' : ''}`} style={{ '--activity-panel-width': `${panelWidth}px` } as React.CSSProperties}>
    <nav className="activity-rail fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center border-r border-[#d8d6ce] bg-[#efede6] py-1" aria-label="Primary navigation"><img className="mt-1 size-8 rounded-[9px] object-cover" src={logoUrl} alt="Conflux" /><div className="mt-2"><button className="rail-button" aria-label="Explorer" aria-pressed={panel === 'explorer'} title="Explorer" onClick={() => setPanel(panel === 'explorer' ? null : 'explorer')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 5.5h6l2 2h9v11h-17z"/><path d="M3.5 9.5h17"/></svg></button></div><div className="mt-auto grid gap-1"><button className="rail-button relative" type="button" aria-label={`Invitations${invitationInbox.items.length ? ` (${invitationInbox.items.length} pending)` : ''}`} aria-pressed={panel === 'invitations'} title="Invitations" onClick={() => { setPanel(panel === 'invitations' ? null : 'invitations'); void invitationInbox.refresh(); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{(invitationInbox.error || invitationInbox.items.length > 0) && <span className="invitation-badge" aria-hidden="true">{invitationInbox.error ? '!' : invitationInbox.items.length > 99 ? '99+' : invitationInbox.items.length}</span>}</button><button className="rail-button" aria-label="Projects" aria-pressed={panel === 'projects'} title="Projects" onClick={() => setPanel(panel === 'projects' ? null : 'projects')}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.5 19c.5-3.7 2.3-5.5 5.5-5.5s5 1.8 5.5 5.5M14 15c3.8-.5 5.9.8 6.5 4"/></svg></button><button className="rail-button" aria-label="Profile" aria-pressed={panel === 'profile'} title="Profile" onClick={() => void openProfile()}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/><circle cx="12" cy="12" r="10"/></svg></button><button className="rail-button" aria-label="Settings" aria-pressed={panel === 'settings'} title="Settings" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg></button></div></nav>
    {panel && <aside className="activity-panel fixed bottom-1 left-13 top-1 z-10 overflow-y-auto rounded-2xl border border-[#d8d6ce] bg-[#efede6]" aria-label="Activity panel"><div className="activity-panel-surface">
      {panel === 'explorer' && <div className="p-4"><div className="mb-4 flex items-center justify-between"><h2 className="m-0 text-base font-semibold tracking-[-.02em]">EXPLORER</h2><button className="panel-close" type="button" aria-label="Close Explorer" onClick={() => setPanel(null)}>×</button></div><RepositoryExplorer projectName={project?.name} repository={activeWorkstream && (!isRepositoryReady(activeWorkstream) || repositoryError || repositoryLoading) ? null : repository} onConnect={() => void chooseRepository()} onChooseWorkstream={() => setPanel('projects')} onOpen={(file) => void openRepositoryFile(file)} /></div>}
      {panel === 'projects' && projectNavigation}
      {panel === 'invitations' && <InvitationInbox disabled={busy || repositoryLoading} inbox={invitationInbox} onAccepted={refreshMemberships} />}
      {panel === 'profile' && <div className="grid gap-5 px-5 pb-5 pt-5">{profile ? <><header className="flex items-center justify-between"><h2 className="m-0 text-lg font-semibold tracking-[-.02em]">Profile</h2><button className="panel-close" type="button" onClick={() => setPanel(null)}>×</button></header><section className="rounded-xl bg-[#e8e6df] p-4"><div className="flex items-center gap-3.5"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-[#4b535d] text-xl font-bold text-white">{profile.username.charAt(0).toUpperCase()}</div><div className="min-w-0"><strong className="block truncate text-base font-semibold">{profile.firstName} {profile.middleName} {profile.lastName}</strong><span className="mt-0.5 block truncate text-sm text-[#6d716b]">@{profile.username}</span></div></div><p className="mb-0 mt-4 break-all text-sm text-[#59616c]">{profile.email}</p></section><button className="neutral-button w-full" type="button" onClick={() => setDialog({ kind: 'profile', profile })}>Edit profile</button><button className="danger-button w-full" type="button" onClick={askToLogOut}>Log out</button><section className="rounded-xl bg-[#f8eae7] p-4"><h3 className="m-0 text-sm font-semibold text-[#7f342e]">Delete account</h3><p className="mb-4 mt-1.5 text-xs leading-relaxed text-[#694944]">Permanently remove your account and profile data.</p><button className="danger-button w-full" type="button" onClick={askToDeleteAccount}>Delete account</button></section></> : <p className="p-4">Loading profile…</p>}</div>}
      {panel === 'settings' && <div className="grid gap-7 px-7 pb-7 pt-4"><div className="flex justify-end"><button className="panel-close" type="button" onClick={() => setPanel(null)}>×</button></div><div className="grid justify-items-center text-center"><div className="grid size-20 place-items-center rounded-full bg-[#4b535d] text-white"><svg className="size-9 fill-none stroke-current stroke-[1.6]" viewBox="0 0 24 24"><path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z"/><circle cx="12" cy="11.5" r="3.25"/></svg></div><strong className="mt-4 text-lg font-semibold">Settings</strong><span className="mt-1 text-sm text-[#6d716b]">Customize your Conflux experience</span></div><button className="neutral-button flex w-full items-center justify-center gap-2.5" id="theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button><button className="neutral-button flex w-full items-center justify-between gap-3" type="button" aria-haspopup="dialog" onClick={() => setDialog({ kind: 'fonts' })}><span>Fonts</span><span aria-hidden="true">→</span></button></div>}
    </div><button className="activity-panel-resizer absolute inset-y-0 right-0 w-1 cursor-col-resize" type="button" aria-label="Resize activity panel" title="Drag to resize" onPointerDown={resizePanel} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setPanelWidth(Math.max(240, panelWidth - 20)); if (event.key === 'ArrowRight') setPanelWidth(Math.min(520, panelWidth + 20)); }}></button>
    </aside>}
    <section className={`editor-stage m-1 min-h-[calc(100dvh-.5rem)] rounded-2xl border border-[#d8d6ce] bg-[#f8f7f2] ${activeWorkstream ? 'overflow-hidden' : 'px-4 py-8 sm:px-8 lg:px-12 lg:py-10'}`}>
      <div className={activeWorkstream ? 'h-[calc(100dvh-.5rem)] w-full' : 'mx-auto w-full max-w-[1400px]'}><div className={activeWorkstream ? 'h-full' : ''} id="team-workspace">{workspaceContent}</div>{!activeWorkstream && <div className="mt-4"><NoticeView notice={notice} /></div>}</div>
    </section>
    {dialog?.kind === 'fonts' && <Modal title="Fonts" compact onClose={() => setDialog(null)}><FontSettings preferences={fontPreferences} onChange={setFontPreferences} onClose={() => setDialog(null)} /></Modal>}
    {dialog?.kind === 'joined-team' && <Modal title={`You joined ${dialog.invitation.teamName}`} onClose={() => { if (!busy) setDialog(null); }}><InvitationProjects teamId={dialog.invitation.teamId} desktop={isDesktop()} busy={busy || repositoryLoading} onDownload={(item) => void downloadProject(item, dialog.invitation.teamId)} onOpen={(item) => { setDialog(null); void load(item.projectId, dialog.invitation.teamId); }} />{downloading && <p role="status" className="mt-4 text-sm">Downloading and checking the project…</p>}</Modal>}
    {dialog?.kind === 'repository-settings' && <Modal title="Shared repository" onClose={() => setDialog(null)}><RepositorySettings projectId={dialog.project.projectId} localPath={repository?.path} onSaved={(configuration) => { setRemoteRepository(configuration); setRemoteError(null); setDialog(null); }} /></Modal>}
    {dialog?.kind === 'project' && <Modal title={dialog.project ? 'Edit project' : 'Create project'} onClose={() => setDialog(null)}><EntityForm initial={dialog.project} labels={{ name: 'Project name', submit: dialog.project ? 'Save project' : 'Create project' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.project) await updateProject(dialog.project.projectId, name, description); else { const created = await createProject(name, description); await load(created.projectId, null); } })} /></Modal>}
    {dialog?.kind === 'team' && <Modal title={dialog.team ? 'Edit team' : 'Create team'} onClose={() => setDialog(null)}><EntityForm initial={dialog.team} labels={{ name: 'Team name', submit: dialog.team ? 'Save team' : 'Create team' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.team) await updateTeam(dialog.team.teamId, name, description); else { const created = await createTeam(name, description); if (dialog.projectId) await assignProjectTeam(dialog.projectId, created.teamId); } }, dialog.projectId ?? project?.projectId, dialog.team?.teamId ?? null)} /></Modal>}
    {dialog?.kind === 'assign-team' && <Modal title="Assign team" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const teamId = String(new FormData(event.currentTarget).get('teamId')); void execute(() => assignProjectTeam(dialog.project.projectId, teamId), dialog.project.projectId, teamId); }}><select className={inputClass} name="teamId" required>{dialog.teams.map((item) => <option value={item.teamId} key={item.teamId}>{item.name}</option>)}</select><SubmitButton busy={busy}>Assign team</SubmitButton></form></Modal>}
    {dialog?.kind === 'member' && <Modal title="Invite member" onClose={() => setDialog(null)}><form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault(); const values = formValues(event.currentTarget);
      setBusy(true); setNotice(null);
      try {
        await inviteTeamMember(dialog.team.teamId, String(values.email), String(values.role) as UserRole);
        setInvitationRevision((current) => current + 1); setDialog(null);
        setInvitationSent(true);
      } catch (error) { setNotice({ message: messageFor(error, 'Unable to send invitation.') }); }
      finally { setBusy(false); }
    }}><p className="m-0 text-sm leading-relaxed text-[#6d716b]">Invite an existing user by their verified email. They must accept before joining this team.</p><label className={fieldClass}>Email<input className={inputClass} name="email" type="email" maxLength={100} required /></label><label className={fieldClass}>Role<select className={inputClass} name="role" defaultValue="DEVELOPER">{roles.filter((role) => dialog.capabilities.role === 'ADMIN' || roleRank[role] > roleRank[dialog.capabilities.role]).map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></label><NoticeView notice={notice} /><SubmitButton busy={busy}>Send invitation</SubmitButton></form></Modal>}

    {dialog?.kind === 'profile' && <Modal title="Edit profile" onClose={() => setDialog(null)}><form className="grid gap-5" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setNotice(null); const values = formValues(event.currentTarget); try { const updated = await authenticatedRequest<UserProfile>('/api/users/me', 'PUT', values); setProfile(updated); setDialog(null); } catch (error) { setNotice({ message: messageFor(error, 'Unable to update your profile.') }); } finally { setBusy(false); } }}><div className="grid grid-cols-2 gap-4"><label className="field-label">First name<input className="field-input" name="firstName" defaultValue={dialog.profile.firstName} required maxLength={50} /></label><label className="field-label">Last name<input className="field-input" name="lastName" defaultValue={dialog.profile.lastName} required maxLength={50} /></label></div><label className="field-label">Middle name <span>(optional)</span><input className="field-input" name="middleName" defaultValue={dialog.profile.middleName ?? ''} maxLength={50} /></label><label className="field-label">Username<input className="field-input" name="username" defaultValue={dialog.profile.username} required minLength={5} maxLength={50} pattern="[a-zA-Z0-9._-]+" /></label><label className="field-label">Email<input className="field-input bg-[#efede6] text-[#777b75]" value={dialog.profile.email} disabled /></label><NoticeView notice={notice} /><div className="grid grid-cols-2 gap-3"><button className="neutral-button" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="neutral-button-filled" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Save changes'}</button></div></form></Modal>}
    {invitationSent && <dialog ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={() => setInvitationSent(false)} aria-labelledby="invitation-sent-title" aria-describedby="invitation-sent-message" className="confirmation-dialog fixed left-1/2 top-1/2 m-0 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#c7c5bd] bg-[#f8f7f2] p-6 text-[#1d211e] shadow-xl backdrop:bg-black/45"><h2 id="invitation-sent-title" className="m-0 text-xl font-bold">Invitation sent</h2><p id="invitation-sent-message" className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]">Invitation sent. The user will join after accepting.</p><button className={`${primaryClass} w-full`} type="button" autoFocus onClick={() => setInvitationSent(false)}>OK</button></dialog>}
    {confirmation && <div className="fixed inset-0 z-[60] grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && setConfirmation(null)}><section className="confirmation-dialog w-full max-w-[390px] border border-[#c7c5bd] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message"><h2 className="m-0 text-xl font-bold tracking-[-.03em]" id="confirmation-title">{confirmation.title}</h2><p className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="confirmation-message">{confirmation.message}</p><div className="grid grid-cols-2 gap-3"><button className="neutral-button" type="button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="danger-button" type="button" disabled={busy} onClick={() => { const action = confirmation.action; setBusy(true); void action().catch((error) => setNotice({ message: messageFor(error, 'The action could not be completed.') })).finally(() => { setBusy(false); setConfirmation(null); }); }}>{busy ? 'Please wait…' : confirmation.label}</button></div></section></div>}
    {requestError && <div className="fixed inset-0 z-[70] grid place-items-center bg-[#111]/45 p-5" onMouseDown={(event) => event.target === event.currentTarget && setRequestError(null)}><section className="confirmation-dialog w-full max-w-[420px] border border-[#c9786f] bg-[#f8f7f2] p-6 shadow-[0_24px_70px_rgba(0,0,0,.28)]" role="alertdialog" aria-modal="true" aria-labelledby="request-error-title" aria-describedby="request-error-message"><h2 className="m-0 text-xl font-bold tracking-[-.03em]" id="request-error-title">{requestError.title}</h2><p className="mb-6 mt-3 text-sm leading-relaxed text-[#6d716b]" id="request-error-message">{requestError.message}</p><div className={`grid gap-3 ${requestError.action ? 'grid-cols-2' : ''}`}><button className="neutral-button" type="button" onClick={() => setRequestError(null)}>{requestError.action ? 'Close' : 'Correct the details'}</button>{requestError.action && <button className="neutral-button-filled" type="button" disabled={busy} autoFocus onClick={() => { const retry = requestError.action!; setBusy(true); void retry().then(() => setRequestError(null)).catch((error) => setRequestError((current) => current ? { ...current, message: messageFor(error, 'The local Git worktree could not be created.') } : null)).finally(() => setBusy(false)); }}>{busy ? 'Please wait…' : requestError.actionLabel}</button>}</div></section></div>}
  </main>;
}

export function App() {
  const [route, setRoute] = useState<Route>(location.pathname as Route);
  const [ready, setReady] = useState(false);
  useEffect(() => { const update = () => setRoute(location.pathname as Route); addEventListener('popstate', update); void restoreSession().finally(() => setReady(true)); return () => removeEventListener('popstate', update); }, []);
  if (!ready) return <main className="auth-page grid min-h-dvh place-items-center bg-[#f8f7f2]">Loading Conflux…</main>;
  if (route === '/app') return isAuthenticated() ? <Workspace /> : <Login onAuthenticated={() => navigate('/app')} />;
  if (isAuthenticated()) { queueMicrotask(() => navigate('/app')); return null; }
  if (route === '/sign-up') return <Register />;
  if (route === '/check-email') return <EmailStatus verify={false} />;
  if (route === '/verify-email') return <EmailStatus verify />;
  return <Login onAuthenticated={() => navigate('/app')} />;
}
