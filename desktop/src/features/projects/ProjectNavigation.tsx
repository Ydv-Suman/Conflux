import { PanelHeader } from '../../components/PanelHeader';
import type { Project, ProjectTeam } from './api';

type Props = {
  projects: Project[]; project: Project | null; projectTeams: ProjectTeam[];
  team: ProjectTeam | null; openShared: boolean; disabled: boolean;
  onSelect: (projectId: string | null, teamId: string | null, openShared?: boolean) => Promise<void>;
  onCreate: () => void; onClose: () => void;
};

export function ProjectNavigation({ projects, project, projectTeams, team, openShared, disabled, onSelect, onCreate, onClose }: Props) {
  return <nav className="team-sidebar sidebar-content" aria-label="Projects">

    <PanelHeader title={openShared ? 'Choose team' : 'Projects'} onClose={onClose}>

      <button className="neutral-button project-create-compact" type="button" onClick={onCreate}>Create</button>

    </PanelHeader>

    {!projects.length && <div className="sidebar-empty">

      <strong>No projects yet</strong>

      <p>Create a project to organize your teams and shared work.</p>

    </div>}

    <div className="grid gap-1">
      {projects.map((item) => <div key={item.projectId}>

        <button className={`team-section-link project-switch ${item.projectId === project?.projectId ? 'is-active' : ''}`}
          type="button" aria-expanded={item.projectId === project?.projectId} disabled={disabled}
          onClick={() => void onSelect(item.projectId === project?.projectId ? null : item.projectId, null)}>

          <span className="truncate">{item.name}</span>

          <svg className="size-3 shrink-0 fill-none stroke-current stroke-2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>

        </button>

        {item.projectId === project?.projectId && <div className="project-team-list">

          <p className="project-nav-heading">Teams
            <span>({projectTeams.length})</span>
          </p>

          {!projectTeams.length && <p className="sidebar-muted px-2 text-xs">No teams assigned yet.</p>}

          {projectTeams.map((itemTeam) => <button key={itemTeam.teamId}
            className={`team-section-link project-team-switch ${itemTeam.teamId === team?.teamId ? 'is-active' : ''}`}
            type="button" disabled={disabled}
            onClick={() => void onSelect(item.projectId, itemTeam.teamId, openShared)}>

            <span className="truncate">{itemTeam.name || 'Unnamed team'}</span>

          </button>)}

        </div>}

      </div>)}
    </div>

  </nav>;
}
