import type { Collaborator } from './collaborators';

export function CollaboratorBadges({ participants = [], documentId }: { participants?: Collaborator[]; documentId?: string }) {
  const people = [...new Map(participants.filter(person => person.documentId === documentId).map(person => [person.userId, person])).values()];
  if (!people.length) return null;
  return <span className="collaborator-badges" aria-label="Viewing this file">{people.slice(0, 3).map(person => <span
    key={person.userId} className="collaborator-initial" style={{ backgroundColor: person.color }}
    title={`${person.name} is viewing this file`} aria-label={`${person.name} is viewing this file`}>{person.initial}</span>)}{people.length > 3 && <span className="collaborator-initial collaborator-overflow"
      title={people.slice(3).map(person => person.name).join(', ')} aria-label={`${people.length - 3} more people viewing this file`}>+{people.length - 3}</span>}</span>;
}
