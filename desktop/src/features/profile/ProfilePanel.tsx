import { PanelHeader } from '../../components/PanelHeader';
import type { UserProfile } from '../auth/session';

type Props = {
  profile: UserProfile | null;
  onClose: () => void; onEdit: () => void; onLogout: () => void; onDelete: () => void;
};

export function ProfilePanel({ profile, onClose, onEdit, onLogout, onDelete }: Props) {
  return <div className="sidebar-content">

    <PanelHeader title="Profile" onClose={onClose} />

    {profile ? <>
      <section className="sidebar-section profile-summary">

        <div className="flex items-center gap-3">

          <div className="profile-avatar" aria-hidden="true">{profile.username.charAt(0).toUpperCase()}</div>

          <div className="min-w-0">

            <strong className="block truncate">{[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')}</strong>

            <span className="sidebar-muted block truncate">@{profile.username}</span>

          </div>

        </div>

        <p className="break-all">{profile.email}</p>

        <button className="neutral-button w-full" type="button" onClick={onEdit}>Edit profile</button>

      </section>
      <button className="neutral-button w-full" type="button" onClick={onLogout}>Log out</button>
      <section className="sidebar-section account-danger">

        <h3>Delete account</h3>

        <p>Permanently remove your account and profile data.</p>

        <button className="danger-button w-full" type="button" onClick={onDelete}>Delete account</button>

      </section>
    </> : <p className="sidebar-muted" role="status">Loading profile…</p>}

  </div>;
}
