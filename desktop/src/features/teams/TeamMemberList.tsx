import { useState } from 'react';
import type { TeamMember, TeamCapabilities, UserRole } from './api';
import { roles, roleRank } from './roles';

export function TeamMemberList({ members, capabilities, busy, onRoleChange, onRemove }: { members: TeamMember[]; capabilities: TeamCapabilities; busy: boolean; onRoleChange: (member: TeamMember, role: UserRole) => Promise<void>; onRemove: (member: TeamMember) => void }) {
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>('VIEWER');
  const actorRole = capabilities.role;
  const canManage = (member: TeamMember) => capabilities.capabilities.includes('MANAGE_ROLES') && (actorRole === 'ADMIN' || roleRank[actorRole] < roleRank[member.role]);
  const allowedRoles = roles.filter((role) => actorRole === 'ADMIN' || roleRank[actorRole] < roleRank[role]);

  return <div className="divide-y divide-[#d8d6ce]">{members.map((member) => {
    const manageable = canManage(member);
    return <article className="relative py-4" key={member.userId}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm font-semibold">{member.fullName || member.username}</strong>
            <span className="shrink-0 text-xs text-[#59616c]">{member.role.replaceAll('_', ' ')}</span>
            {manageable && <button className="member-role-edit" type="button" aria-label={`Edit ${member.username}'s role`} title="Edit role" aria-expanded={editing?.userId === member.userId} onClick={() => { setEditing(editing?.userId === member.userId ? null : member); setSelectedRole(member.role); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 16-.75 4.75L8 20l11-11-4-4L4 16Z" />
                <path d="m13.5 6.5 4 4" />
              </svg>
            </button>}
          </div>
          <span className="mt-1 block truncate text-xs text-[#6d716b]">@{member.username} · Joined {new Date(member.joinedAt).toLocaleDateString()}</span>
        </div>
        {manageable && capabilities.capabilities.includes('MANAGE_MEMBERS') && <button className="danger-button danger-button-compact shrink-0" type="button" onClick={() => onRemove(member)}>Remove</button>}
      </div>

      {editing?.userId === member.userId && <><button className="member-role-backdrop" type="button" aria-label="Close role editor" onClick={() => setEditing(null)} /><div className="member-role-popover" role="dialog" aria-modal="true" aria-label={`Change ${member.username}'s role`}>
        <label className="field-label">Role
          <select className="field-input" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as UserRole)}>{allowedRoles.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="neutral-button min-h-9" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          <button className="neutral-button-filled min-h-9" type="button" disabled={busy || selectedRole === member.role} onClick={() => void onRoleChange(member, selectedRole).then(() => setEditing(null))}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div></>}

    </article>;
  })}</div>;
}

