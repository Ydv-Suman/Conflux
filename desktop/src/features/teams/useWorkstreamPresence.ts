import { useEffect, useMemo, useRef, useState } from 'react';
import { COLLABORATION_WS_URL } from '../../config';
import { getCollaborationToken, getCurrentUser } from '../auth/session';
import { listTeamMembers, type TeamMember } from './api';
import { collaborator, type Collaborator } from './collaborators';
import { connectWorkstreamPresence, noCursor, type CursorState, type WorkstreamScope, type WorkstreamPresenceState } from './workstreamPresence';

export type LiveCollaboration = {
  setDocument: (documentId: string | null) => void;
  cursor: (documentId: string, anchor: string, head: string) => void;
  clear: (documentId: string) => void;
  peers: (documentId: string) => Collaborator[];
  subscribe: (listener: () => void) => () => void;
};
const scopeKey = (scope: WorkstreamScope | null) => scope ? `${scope.projectId}/${scope.teamId}/${scope.workstreamId}` : '';
const assignment = (state: WorkstreamPresenceState | null) => state ? JSON.stringify([scopeKey(state), state.phase, state.selfId,
  state.participants.map(peer => [peer.sessionId, peer.userId, peer.documentId])]) : '';

export function useWorkstreamPresence(scope: WorkstreamScope | null) {
  const key = scopeKey(scope);
  const [badgeState, setBadgeState] = useState<WorkstreamPresenceState | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const names = useRef(members); names.current = members;
  const latest = useRef<WorkstreamPresenceState | null>(null);
  const desired = useRef<{ key: string; state: CursorState }>({ key: '', state: noCursor });
  const connection = useRef<{ key: string; controller: ReturnType<typeof connectWorkstreamPresence> } | null>(null);
  const listeners = useRef(new Set<() => void>());
  const label = (userId: string) => {
    const member = names.current.find(member => member.userId === userId);
    return member?.fullName || member?.username || (getCurrentUser()?.id === userId ? getCurrentUser()?.username : undefined);
  };
  const api = useMemo<LiveCollaboration>(() => {
    const publish = (state: CursorState) => {
      desired.current = { key, state };
      if (connection.current?.key === key) connection.current.controller.update(document.hidden ? noCursor : state);
    };
    return {
      setDocument(documentId) { if (desired.current.key !== key || desired.current.state.documentId !== documentId) publish({ documentId, anchor: null, head: null }); },
      cursor(documentId, anchor, head) { publish({ documentId, anchor, head }); },
      clear(documentId) { if (desired.current.key === key && desired.current.state.documentId === documentId) publish(noCursor); },
      peers(documentId) {
        const state = latest.current;
        return state && scopeKey(state) === key && state.phase === 'online'
          ? state.participants.filter(peer => peer.documentId === documentId && peer.sessionId !== state.selfId).map(peer => collaborator(peer, label(peer.userId))) : [];
      },
      subscribe(listener) { listeners.current.add(listener); listener(); return () => { listeners.current.delete(listener); }; },
    };
  }, [key]);
  useEffect(() => {
    let disposed = false;
    setMembers([]);
    if (scope?.teamId) void listTeamMembers(scope.teamId).then(value => { if (!disposed) setMembers(value); }).catch(() => {});
    return () => { disposed = true; };
  }, [scope?.teamId]);
  useEffect(() => { listeners.current.forEach(listener => listener()); }, [members]);
  useEffect(() => {
    latest.current = null; setBadgeState(null); listeners.current.forEach(listener => listener());
    if (!scope) return;
    const controller = connectWorkstreamPresence({ scope,
      endpoint: `${COLLABORATION_WS_URL}/ws/projects/${scope.projectId}/workstreams/${scope.workstreamId}/presence`,
      getToken: getCollaborationToken,
      onState: state => {
        latest.current = state; listeners.current.forEach(listener => listener());
        // Cursor motion updates Monaco directly; React only redraws file badges when assignments change.
        setBadgeState(previous => assignment(previous) === assignment(state) ? previous : state);
      },
    });
    connection.current = { key, controller };
    const visible = () => controller.update(!document.hidden && desired.current.key === key ? desired.current.state : noCursor);
    visible();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', controller.retry);
    return () => {
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', controller.retry);
      controller.dispose(); if (connection.current?.controller === controller) connection.current = null;
    };
  }, [key]);
  const participants = badgeState && scopeKey(badgeState) === key && badgeState.phase === 'online'
    ? badgeState.participants.map(peer => collaborator(peer, label(peer.userId))) : [];
  return { api, participants };
}
