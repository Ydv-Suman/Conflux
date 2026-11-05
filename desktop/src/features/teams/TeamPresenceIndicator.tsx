import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { listTeamMembers, type TeamMember } from './api';
import type { TeamPresenceState } from './presenceConnection';

function OnlineMembers({ teamId, userIds, onClose }: { teamId: string; userIds: string[]; onClose: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const rosterKey = userIds.join(',');
  useEffect(() => {
    let disposed = false;
    setLoading(true); setError(false);
    void listTeamMembers(teamId).then((next) => { if (!disposed) setMembers(next); })
      .catch(() => { if (!disposed) setError(true); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [teamId, rosterKey]);
  return <Modal compact title="Online team members" onClose={onClose}>
    {loading ? <p role="status">Loading members…</p> : error ? <p role="alert">Member details could not load. Close and reopen to retry.</p>
      : <table className="w-full table-fixed text-left text-sm" aria-label="Online team members">
        <thead><tr className="border-b border-[#d8d6ce]">
          <th scope="col" className="w-3/5 pb-3 pr-4 font-semibold">Name</th>
          <th scope="col" className="pb-3 font-semibold">Role</th>
        </tr></thead>
        <tbody className="divide-y divide-[#d8d6ce]">{userIds.map((id) => {
        const member = members.find((item) => item.userId === id);
        return <tr key={id}>
          <td className="break-words py-3 pr-4 align-top">{member?.fullName || member?.username || 'Member details unavailable'}</td>
          <td className="break-words py-3 align-top">{member ? member.role.toLowerCase().replaceAll('_', ' ') : '—'}</td>
        </tr>;
      })}</tbody></table>}
  </Modal>;
}

export function TeamPresenceIndicator({ presence, onRetry }: { presence: TeamPresenceState | null; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const online = presence?.phase === 'online';
  // Roster access is granted by the server, not inferred from a cached team role.
  const canView = online && presence.userIds !== undefined;
  useEffect(() => { if (!canView) setOpen(false); }, [canView]);
  const label = online ? `${presence.count} online` : presence?.phase === 'connecting' ? 'Connecting…' : 'Offline';
  const title = online ? `${presence.count} team member${presence.count === 1 ? '' : 's'} online, including you`
    : presence?.message || 'Team presence is unavailable; the online count is unknown';
  const content = <><span className="editor-connection-dot" aria-hidden="true" /><span role="status">{label}</span></>;
  return <>
    {canView ? <button type="button" className="editor-connection is-connected" title={title} aria-label="View online team members" aria-haspopup="dialog" onClick={() => setOpen(true)}>{content}</button>
      : presence?.phase === 'offline' ? <button type="button" className="editor-connection is-disconnected" title={`${title} Click to retry.`} aria-label="Retry team presence" onClick={onRetry}>{content}</button>
      : <span className={`editor-connection ${online ? 'is-connected' : 'is-disconnected'}`} title={title}>{content}</span>}
    {open && canView && <OnlineMembers key={presence.teamId} teamId={presence.teamId} userIds={presence.userIds!} onClose={() => setOpen(false)} />}
  </>;
}
