import { useEffect, useState } from 'react';
import { listTeamProjects, type Project } from './api';

export function InvitationProjects({ teamId, desktop, busy, onDownload, onOpen }: {
  teamId: string; desktop: boolean; busy: boolean; onDownload: (project: Project) => void; onOpen: (project: Project) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    void listTeamProjects(teamId).then((items) => { if (!cancelled) setProjects(items); })
      .catch(() => { if (!cancelled) setError('You joined the team, but its projects could not load. Retry to see them.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [teamId, attempt]);
  return <div className="grid gap-4">
    <p className="m-0 text-sm text-[#6d716b]">{desktop ? 'Download a project to work with your team, or open its workspace to use a local copy.' : 'Open Conflux desktop to download these projects and work with your team.'}</p>
    {loading && <p role="status">Loading team projects…</p>}
    {error && <div role="alert"><p>{error}</p><button className="neutral-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && !projects.length && <p>No projects are assigned to this team yet. They will appear in Projects when a manager adds them.</p>}
    {projects.map((project) => <section key={project.projectId} className="grid gap-3 border-t border-[#d8d6ce] pt-4"><strong>{project.name}</strong><div className="flex flex-wrap gap-2">
      {desktop && <button className="neutral-button-filled" type="button" disabled={busy} onClick={() => onDownload(project)}>{busy ? 'Please wait…' : 'Download project'}</button>}
      <button className="neutral-button" type="button" disabled={busy} onClick={() => onOpen(project)}>Open workspace</button>
    </div></section>)}
  </div>;
}
