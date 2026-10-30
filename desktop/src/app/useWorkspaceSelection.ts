import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notice } from '../components/FormControls';
import { getDefaultWorkstream, listProjects, listProjectTeams, listWorkstreams, type Project, type ProjectTeam, type Workstream } from '../features/projects/api';
import { isDesktop, loadLastWorkspace } from '../features/repository/api';
import { getMyTeamCapabilities, getTeam, listTeamMembers, listTeams, type Team, type TeamCapabilities, type TeamMember } from '../features/teams/api';
import { messageFor } from './messages';

export function useWorkspaceSelection(canLeaveWorkspace: () => boolean, onOpenShared: () => void) {
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
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async (projectId?: string | null, teamId?: string | null, openShared = true) => {
    if (!canLeaveWorkspace()) return;
    const version = ++loadVersion.current;
    setLoading(true); setNotice(null); setActiveWorkstream(null);
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
      if (shared && openShared) onOpenShared();
    } catch (error) { if (version === loadVersion.current) setNotice({ message: messageFor(error, 'Unable to load projects.') }); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [canLeaveWorkspace, onOpenShared]);
  useEffect(() => {
    if (!isDesktop()) { void load(); return; }
    void loadLastWorkspace().then((saved) => {
      if (!saved) return load();
      return load(saved.projectId, saved.teamId);
    }).catch(() => load());
  }, [load]);
  return {
    projects, setProjects, teams, setTeams, project, projectTeams, team, identityTeam,
    members, setMembers, capabilities, workstreams, setWorkstreams, activeWorkstream, setActiveWorkstream,
    loading, notice, setNotice, load
  };
}
