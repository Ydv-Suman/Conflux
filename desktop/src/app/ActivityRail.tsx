import type { Dispatch, SetStateAction } from 'react';
import logoUrl from '../../src-tauri/app-icon.png';
import type { Panel } from './workspaceTypes';
type Props = {
  panel: Panel; setPanel: Dispatch<SetStateAction<Panel>>;
  invitationInbox: { items: unknown[]; error: string | null; refresh: () => Promise<void> };
  openProfile: () => Promise<void>; onProjects: () => void;
};
export function ActivityRail({ panel, setPanel, invitationInbox, openProfile, onProjects }: Props) {
  return <nav className="activity-rail fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center border-r border-[#d8d6ce] bg-[#efede6] py-1" aria-label="Primary navigation">
    <img className="mt-1 size-8 rounded-[9px] object-cover" src={logoUrl} alt="Conflux" />
    <div className="mt-2">
      <button className="rail-button" aria-label="Explorer" aria-pressed={panel === 'explorer'} title="Explorer" onClick={() => setPanel(panel === 'explorer' ? null : 'explorer')}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3.5 5.5h6l2 2h9v11h-17z" />
          <path d="M3.5 9.5h17" />
        </svg>
      </button>
    </div>
    <div className="mt-auto grid gap-1">
      <button className="rail-button relative" type="button" aria-label={`Invitations${invitationInbox.items.length ? ` (${invitationInbox.items.length} pending)` : ''}`} aria-pressed={panel === 'invitations'} title="Invitations" onClick={() => { setPanel(panel === 'invitations' ? null : 'invitations'); void invitationInbox.refresh(); }}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {(invitationInbox.error || invitationInbox.items.length > 0) && <span className="invitation-badge" aria-hidden="true">{invitationInbox.error ? '!' : invitationInbox.items.length > 99 ? '99+' : invitationInbox.items.length}</span>}
      </button>
      <button className="rail-button" aria-label="Projects" aria-pressed={panel === 'projects'} title="Projects" onClick={onProjects}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M3.5 19c.5-3.7 2.3-5.5 5.5-5.5s5 1.8 5.5 5.5M14 15c3.8-.5 5.9.8 6.5 4" />
        </svg>
      </button>
      <button className="rail-button" aria-label="Profile" aria-pressed={panel === 'profile'} title="Profile" onClick={() => void openProfile()}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      </button>
      <button className="rail-button" aria-label="Settings" aria-pressed={panel === 'settings'} title="Settings" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M9.4 4.6 10 2h4l.6 2.6 2.1 1.2 2.5-.8 2 3.5-1.9 1.8v2.4l1.9 1.8-2 3.5-2.5-.8-2.1 1.2L14 21h-4l-.6-2.6-2.1-1.2-2.5.8-2-3.5 1.9-1.8v-2.4L2.8 8.5l2-3.5 2.5.8 2.1-1.2Z" />
          <circle cx="12" cy="11.5" r="3.25" />
        </svg>
      </button>
    </div>
  </nav>;
}
