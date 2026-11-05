import { useCallback, useEffect, useRef, useState } from 'react';
import { COLLABORATION_WS_URL } from '../../config';
import { getCollaborationToken } from '../auth/session';
import { connectTeamPresence, type TeamPresenceState } from './presenceConnection';

export function useTeamPresence(teamId?: string) {
  const [presence, setPresence] = useState<TeamPresenceState | null>(null);
  const connectionRef = useRef<ReturnType<typeof connectTeamPresence> | null>(null);
  const retry = useCallback(() => connectionRef.current?.retry(), []);
  useEffect(() => {
    if (!teamId) { setPresence(null); return; }
    const connection = connectTeamPresence({
      endpoint: `${COLLABORATION_WS_URL}/ws/teams/${encodeURIComponent(teamId)}/presence`,
      teamId, getToken: getCollaborationToken, onState: setPresence,
    });
    connectionRef.current = connection;
    return () => { connectionRef.current = null; connection.dispose(); };
  }, [teamId]);
  // Hide the previous team's count before the team-change effect runs.
  return { presence: presence?.teamId === teamId ? presence : null, retry };
}
