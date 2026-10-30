import { type Dispatch, type SetStateAction } from 'react';
import { EntityForm, fieldClass, formValues, inputClass, NoticeView, SubmitButton, type Notice } from '../components/FormControls';
import { Modal } from '../components/Modal';
import { authenticatedRequest, type UserProfile } from '../features/auth/session';
import { FontSettings, type FontPreferences } from '../features/editor/FontSettings';
import { InvitationProjects } from '../features/projects/InvitationProjects';
import { RepositorySettings } from '../features/projects/RepositorySettings';
import { assignProjectTeam, createProject, updateProject, type Project, type ProjectRepository } from '../features/projects/api';
import { isDesktop, type RepositoryInfo } from '../features/repository/api';
import { createTeam, inviteTeamMember, updateTeam, type UserRole } from '../features/teams/api';
import { roleRank, roles } from '../features/teams/roles';
import { messageFor } from './messages';
import type { Dialog } from './workspaceTypes';

type Props = {
  dialog: Dialog; setDialog: Dispatch<SetStateAction<Dialog>>;
  busy: boolean; setBusy: Dispatch<SetStateAction<boolean>>;
  notice: Notice; setNotice: Dispatch<SetStateAction<Notice>>;
  fontPreferences: FontPreferences; setFontPreferences: Dispatch<SetStateAction<FontPreferences>>;
  repositoryLoading: boolean; downloading: boolean; repository: RepositoryInfo | null;
  project: Project | null;
  downloadProject: (project: Project, teamId: string) => Promise<void>;
  load: (projectId?: string | null, teamId?: string | null, openShared?: boolean) => Promise<void>;
  execute: (action: () => Promise<unknown>, projectId?: string | null, teamId?: string | null) => Promise<void>;
  setRemoteRepository: Dispatch<SetStateAction<ProjectRepository | null>>;
  setRemoteError: Dispatch<SetStateAction<string | null>>;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  onInvitationSent: () => void;
};
export function WorkspaceDialogs({ dialog, setDialog, busy, setBusy, notice, setNotice,
  fontPreferences, setFontPreferences, repositoryLoading, downloading, repository, project,
  downloadProject, load, execute, setRemoteRepository, setRemoteError, setProfile, onInvitationSent }: Props) {
  return <>
    {dialog?.kind === 'fonts' && <Modal title="Fonts" compact onClose={() => setDialog(null)}>
      <FontSettings preferences={fontPreferences} onChange={setFontPreferences} onClose={() => setDialog(null)} />
    </Modal>}
    {dialog?.kind === 'joined-team' && <Modal title={`You joined ${dialog.invitation.teamName}`} onClose={() => { if (!busy) setDialog(null); }}>
      <InvitationProjects teamId={dialog.invitation.teamId} desktop={isDesktop()} busy={busy || repositoryLoading} onDownload={(item) => void downloadProject(item, dialog.invitation.teamId)} onOpen={(item) => { setDialog(null); void load(item.projectId, dialog.invitation.teamId); }} />
      {downloading && <p role="status" className="mt-4 text-sm">Downloading and checking the project…</p>}
    </Modal>}
    {dialog?.kind === 'repository-settings' && <Modal title="Shared repository" onClose={() => setDialog(null)}>
      <RepositorySettings projectId={dialog.project.projectId} localPath={repository?.path} onSaved={(configuration) => { setRemoteRepository(configuration); setRemoteError(null); setDialog(null); }} />
    </Modal>}
    {dialog?.kind === 'project' && <Modal title={dialog.project ? 'Edit project' : 'Create project'} onClose={() => setDialog(null)}>
      <EntityForm initial={dialog.project} labels={{ name: 'Project name', submit: dialog.project ? 'Save project' : 'Create project' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.project) await updateProject(dialog.project.projectId, name, description); else { const created = await createProject(name, description); await load(created.projectId, null); } })} />
    </Modal>}
    {dialog?.kind === 'team' && <Modal title={dialog.team ? 'Edit team' : 'Create team'} onClose={() => setDialog(null)}>
      <EntityForm initial={dialog.team} labels={{ name: 'Team name', submit: dialog.team ? 'Save team' : 'Create team' }} busy={busy} notice={notice} onSubmit={(name, description) => void execute(async () => { if (dialog.team) await updateTeam(dialog.team.teamId, name, description); else { const created = await createTeam(name, description); if (dialog.projectId) await assignProjectTeam(dialog.projectId, created.teamId); } }, dialog.projectId ?? project?.projectId, dialog.team?.teamId ?? null)} />
    </Modal>}
    {dialog?.kind === 'assign-team' && <Modal title="Assign team" onClose={() => setDialog(null)}>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const teamId = String(new FormData(event.currentTarget).get('teamId')); void execute(() => assignProjectTeam(dialog.project.projectId, teamId), dialog.project.projectId, teamId); }}>
        <select className={inputClass} name="teamId" required>{dialog.teams.map((item) => <option value={item.teamId} key={item.teamId}>{item.name}</option>)}</select>
        <SubmitButton busy={busy}>Assign team</SubmitButton>
      </form>
    </Modal>}
    {dialog?.kind === 'member' && <Modal title="Invite member" onClose={() => setDialog(null)}>
      <form className="grid gap-4" onSubmit={async (event) => {
        event.preventDefault(); const values = formValues(event.currentTarget);
        setBusy(true); setNotice(null);
        try {
          await inviteTeamMember(dialog.team.teamId, String(values.email), String(values.role) as UserRole);
          setDialog(null); onInvitationSent();
        } catch (error) { setNotice({ message: messageFor(error, 'Unable to send invitation.') }); }
        finally { setBusy(false); }
      }}>
        <p className="m-0 text-sm leading-relaxed text-[#6d716b]">Invite an existing user by their verified email. They must accept before joining this team.</p>
        <label className={fieldClass}>Email
          <input className={inputClass} name="email" type="email" maxLength={100} required />
        </label>
        <label className={fieldClass}>Role
          <select className={inputClass} name="role" defaultValue="DEVELOPER">{roles.filter((role) => dialog.capabilities.role === 'ADMIN' || roleRank[role] > roleRank[dialog.capabilities.role]).map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select>
        </label>
        <NoticeView notice={notice} />
        <SubmitButton busy={busy}>Send invitation</SubmitButton>
      </form>
    </Modal>}

    {dialog?.kind === 'profile' && <Modal title="Edit profile" onClose={() => setDialog(null)}>
      <form className="grid gap-5" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setNotice(null); const values = formValues(event.currentTarget); try { const updated = await authenticatedRequest<UserProfile>('/api/users/me', 'PUT', values); setProfile(updated); setDialog(null); } catch (error) { setNotice({ message: messageFor(error, 'Unable to update your profile.') }); } finally { setBusy(false); } }}>
        <div className="grid grid-cols-2 gap-4">
          <label className="field-label">First name
            <input className="field-input" name="firstName" defaultValue={dialog.profile.firstName} required maxLength={50} />
          </label>
          <label className="field-label">Last name
            <input className="field-input" name="lastName" defaultValue={dialog.profile.lastName} required maxLength={50} />
          </label>
        </div>
        <label className="field-label">Middle name
          <span>(optional)</span>
          <input className="field-input" name="middleName" defaultValue={dialog.profile.middleName ?? ''} maxLength={50} />
        </label>
        <label className="field-label">Username
          <input className="field-input" name="username" defaultValue={dialog.profile.username} required minLength={5} maxLength={50} pattern="[a-zA-Z0-9._-]+" />
        </label>
        <label className="field-label">Email
          <input className="field-input bg-[#efede6] text-[#777b75]" value={dialog.profile.email} disabled />
        </label>
        <NoticeView notice={notice} />
        <div className="grid grid-cols-2 gap-3">
          <button className="neutral-button" type="button" onClick={() => setDialog(null)}>Cancel</button>
          <button className="neutral-button-filled" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>}
  </>;
}
