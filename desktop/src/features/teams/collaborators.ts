import type { FileParticipant } from './workstreamPresence';

export const collaboratorColors = [
  { key: 'blue', color: '#2563eb' }, { key: 'green', color: '#047857' },
  { key: 'violet', color: '#7c3aed' }, { key: 'rose', color: '#be185d' },
  { key: 'amber', color: '#b45309' }, { key: 'teal', color: '#0f766e' },
  { key: 'red', color: '#b91c1c' }, { key: 'slate', color: '#475569' },
];
export type Collaborator = FileParticipant & { name: string; initial: string; color: string; colorKey: string };
export function collaborator(peer: FileParticipant, name?: string): Collaborator {
  let hash = 2166136261;
  for (const character of peer.userId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const color = collaboratorColors[(hash >>> 0) % collaboratorColors.length];
  const label = name?.trim() || 'Team member';
  return { ...peer, name: label, initial: name?.trim() ? Array.from(Array.from(label)[0].toLocaleUpperCase())[0] : '?', color: color.color, colorKey: color.key };
}
