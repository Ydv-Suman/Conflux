import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelTeamInvitation,
  listMyInvitations,
  listTeamMembers,
  listTeamInvitations,
  respondToInvitation,
  type TeamInvitation,
  type TeamMember,
} from '../teams/api';

const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Unable to load invitations.';
const roleName = (role: string) => role.replaceAll('_', ' ').toLowerCase();
const pending = (items: TeamInvitation[]) => items.filter((item) => item.status === 'PENDING' && Date.parse(item.expiresAt) > Date.now());

// Keep invitation state independent of editor state; polling never reloads an open file.
function useInvitations(teamId?: string) {
  const [items, setItems] = useState<TeamInvitation[]>([]);
  const [visibleCount, setVisibleCount] = useState(10);
  const [loading, setLoading] = useState(true);
  const [acceptedSignature, setAcceptedSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = teamId ? await listTeamInvitations(teamId) : await listMyInvitations();
      if (request === sequence.current) {
        setItems(pending(result)); setError(null);
        setAcceptedSignature(result.filter((item) => item.status === 'ACCEPTED').map((item) => item.invitationId).sort().join(','));
      }
    } catch (failure) {
      if (request === sequence.current) setError(messageFor(failure));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [teamId]);
  useEffect(() => {
    setItems([]); setVisibleCount(10); setAcceptedSignature(null);
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    const onFocus = (): void => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { ++sequence.current; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);
  const remove = (id: string) => {
    ++sequence.current;
    setItems((current) => current.filter((item) => item.invitationId !== id));
    setLoading(false);
  };
  return { items, loading, error, refresh, remove, acceptedSignature, visibleCount, loadMore: () => setVisibleCount((count) => count + 10) };
}

export function useInvitationInbox() {
  const inbox = useInvitations();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const responding = useRef(false);
  const respond = async (invitation: TeamInvitation, accept: boolean) => {
    if (responding.current) return false;
    responding.current = true;
    setPendingId(invitation.invitationId); setFeedback(null);
    try {
      await respondToInvitation(invitation.invitationId, accept);
      inbox.remove(invitation.invitationId);
      setFeedback({ message: accept ? `You joined ${invitation.teamName}.` : `Invitation to ${invitation.teamName} declined.`, error: false });
      void inbox.refresh();
      return true;
    } catch (failure) {
      setFeedback({ message: messageFor(failure), error: true });
      void inbox.refresh();
      return false;
    } finally { responding.current = false; setPendingId(null); }
  };
  return { ...inbox, pendingId, feedback, respond };
}

export function InvitationInbox({ inbox, onAccepted }: {
  inbox: ReturnType<typeof useInvitationInbox>;
  onAccepted: () => Promise<void>;
}) {
  return <div className="invitation-panel p-4">
    <header className="mb-5 flex items-center justify-between gap-3"><h2 className="m-0 text-base font-semibold">Invitations</h2><button className="neutral-button min-h-8 px-3 text-xs" disabled={inbox.loading || !!inbox.pendingId} onClick={() => void inbox.refresh()}>Refresh</button></header>
    {inbox.error && <p className="form-notice is-error invitation-feedback" role="alert">{inbox.error}</p>}
    {inbox.feedback && <p className={`form-notice ${inbox.feedback.error ? 'is-error' : 'is-success'} invitation-feedback`} role={inbox.feedback.error ? 'alert' : 'status'}>{inbox.feedback.message}</p>}
    {inbox.loading && !inbox.items.length ? <p className="invitation-muted text-sm" role="status">Loading invitations…</p> : !inbox.error && !inbox.items.length && <p className="invitation-muted py-6 text-sm">No pending invitations.</p>}
    <ul className="-mx-4 my-0 list-none p-0">{inbox.items.slice(0, inbox.visibleCount).map((item) => <li className="invitation-card" key={item.invitationId}>
      <div className="flex items-start justify-between gap-3"><h3 className="m-0 min-w-0 break-words text-base font-semibold">{item.teamName}</h3><time className="invitation-muted shrink-0 pt-0.5 text-right text-[10px] leading-relaxed" dateTime={item.expiresAt}>Expires {new Date(item.expiresAt).toLocaleDateString()}</time></div>
      <p className="invitation-message invitation-muted mb-0 mt-1 break-words text-xs leading-relaxed">@{item.inviterUsername} invited you as a {roleName(item.proposedRole)}.</p>
      <div className="invitation-actions grid grid-cols-2 gap-2"><button className="neutral-button" disabled={!!inbox.pendingId} aria-label={`Decline invitation to ${item.teamName}`} onClick={() => void inbox.respond(item, false)}>Decline</button><button className="neutral-button-filled" disabled={!!inbox.pendingId} aria-label={`Accept invitation to ${item.teamName}`} onClick={() => void inbox.respond(item, true).then((accepted) => { if (accepted) return onAccepted(); })}>{inbox.pendingId === item.invitationId ? 'Please wait…' : 'Accept'}</button></div>
    </li>)}</ul>
    {inbox.items.length > inbox.visibleCount && <button type="button" className="neutral-button mt-4 w-full" onClick={inbox.loadMore}>Load more</button>}
  </div>;
}

export function PendingTeamInvitations({ teamId, revision, onMembersChanged }: {
  teamId: string; revision: number; onMembersChanged: (members: TeamMember[]) => void;
}) {
  const invitations = useInvitations(teamId);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const cancelLock = useRef(false);
  const { refresh, acceptedSignature } = invitations;
  const previousAccepted = useRef<string | null>(null);
  useEffect(() => {
    if (acceptedSignature === null) return;
    const previous = previousAccepted.current;
    previousAccepted.current = acceptedSignature;
    if (previous === null || previous === acceptedSignature) return;
    let active = true;
    void listTeamMembers(teamId).then((members) => { if (active) onMembersChanged(members); })
      .catch((error) => { if (active) setFeedback(messageFor(error)); });
    return () => { active = false; };
  }, [acceptedSignature, teamId, onMembersChanged]);
  useEffect(() => { if (revision) void refresh(); }, [revision, refresh]);
  const cancel = async (item: TeamInvitation) => {
    if (cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(item.invitationId); setFeedback(null);
    try {
      await cancelTeamInvitation(teamId, item.invitationId);
      invitations.remove(item.invitationId);
      void refresh();
    } catch (error) { setFeedback(messageFor(error)); void refresh(); }
    finally { cancelLock.current = false; setCancelling(null); }
  };
  return <section className="invitation-panel mt-6" aria-label="Pending team invitations">
    <div className="flex items-center justify-between gap-3"><h4 className="m-0 text-sm font-semibold">Pending invitations <span className="invitation-muted">({invitations.items.length})</span></h4><button className="neutral-button min-h-8 px-3 text-xs" disabled={invitations.loading || !!cancelling} onClick={() => void refresh()}>Refresh</button></div>
    {(feedback || invitations.error) && <p className="form-notice is-error invitation-feedback" role="alert">{feedback || invitations.error}</p>}
    {invitations.loading && !invitations.items.length ? <p className="invitation-muted text-xs" role="status">Loading invitations…</p> : !invitations.error && !invitations.items.length && <p className="invitation-muted text-xs">No pending invitations.</p>}
    <ul className="m-0 list-none p-0">{invitations.items.slice(0, invitations.visibleCount).map((item) => <li key={item.invitationId} className="invitation-row flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><strong className="block break-words text-sm">@{item.inviteeUsername}</strong><span className="invitation-muted text-xs">{roleName(item.proposedRole)} · Expires {new Date(item.expiresAt).toLocaleDateString()}</span></div><button className="neutral-button min-h-8 text-xs" disabled={!!cancelling} aria-label={`Cancel invitation for ${item.inviteeUsername}`} onClick={() => void cancel(item)}>{cancelling === item.invitationId ? 'Cancelling…' : 'Cancel invitation'}</button></li>)}</ul>
    {invitations.items.length > invitations.visibleCount && <button type="button" className="neutral-button mt-4" onClick={invitations.loadMore}>Load more</button>}
  </section>;
}
