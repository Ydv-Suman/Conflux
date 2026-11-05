# Team presence

Open `ws://localhost:8090/ws/teams/{teamId}/presence` (WSS in production).
`teamId` is a UUID. Query strings are rejected so credentials cannot enter URLs.

## Authentication and updates

Within five seconds, send one text frame:

```json
{"token":"identity-access-token"}
```

Identity's versioned `GET /api/teams/{teamId}/capabilities/me` verifies the token
and membership and supplies the user ID and team role. Client-supplied user IDs,
roles, or counts never establish presence. All current member roles, including
viewers, may connect; invitation recipients who are not yet members may not.
This does not grant document editing privileges.

After authorization, the server sends a snapshot on join, leave, and heartbeat:

```json
{"type":"presence","teamId":"team-uuid","count":3}
```

For **ADMIN** and **TEAM_LEAD** recipients, it also includes the unique online
member IDs in stable sorted order:

```json
{"type":"presence","teamId":"team-uuid","count":3,"userIds":["member-uuid-1","member-uuid-2","member-uuid-3"]}
```

Other roles receive no `userIds` field, even if they claim a different role in
their request. Authorized clients can resolve IDs to names using Identity's
existing `GET /api/teams/{teamId}/members` API. The presence socket does not expose
emails, tokens, document names, or activity history.

## Counting rules

- Count unique authenticated **user IDs per team**, including the viewer of the count.
- Multiple connections, windows, or devices in one team count as one person.
  That person leaves the count only when their final team connection closes or expires.
- The same person connected to two teams counts once in each. Each team receives
  only its own count and roster, regardless of project or workstream.
- Team membership alone does not imply online presence. "Online" means a live
  team presence session, not keyboard activity or a guarantee of availability.

The desktop should open one socket for the selected team, independently of file
tabs, and close it on team change, logout, or app shutdown. Switching teams moves
that window's presence to the new team; another window may keep the old team online.
This is an integration contract; frontend changes are not included here.

## Liveness and permission changes

Send the plain text frame `ping` every 10 seconds after authentication. The server
responds with the current snapshot, including any roster access changes.
Connections with no incoming frame for 35 seconds expire on the next one-second
liveness check and leave the count.
A clean disconnect removes presence immediately when the server observes it.

Membership, token validity, and role are rechecked every five seconds; Identity
requests time out after three seconds. Removal, token expiry, and dependency
failure close the socket. Promotion enables the roster; demotion removes the
`userIds` field on the next authorization check. Revocation can take up to about
eight seconds under normal request timing. Clients must discard cached rosters
when the field disappears and discard the entire snapshot on disconnect.

For the planned indicator, show a green dot and `3 online` only with a current
snapshot. While disconnected, the count is unknown, not zero. The presence state
does not confirm document synchronization or local file persistence.

| Close code | Meaning | Client action |
| --- | --- | --- |
| `4401` | Missing, invalid, or expired authentication | Refresh once, then require sign-in if rejected again |
| `4403` | Membership denied or actor changed | Clear the roster and stop automatic retries |
| `1008` | Invalid URL/frame or unexpected message | Correct the request; stop automatic retries |
| `1013` | Idle timeout, dependency failure, or capacity reached | Clear the snapshot and reconnect with backoff |

Transport-level oversized frames may also close with `1009`. Only text frames
are accepted; the presence handler rejects messages above 10,000 bytes. After the
authentication frame, only `ping` is valid.

## Storage and bounds

Presence is ephemeral and held in memory: no database migration, document journal,
or Git change is involved. It resets when the service restarts. Limits are 128
active teams and 128 connections per team; the connection limit includes duplicate
windows. Empty teams are removed. Outbound buffering retains only the latest snapshot.

This implementation requires **one Collaboration Service instance**. Multiple
instances need shared, expiring presence leases before their counts can be combined.
The Spring properties `app.presence-idle-timeout` (default `35s`) and
`app.presence-authorization-interval` (default `5s`) control the server intervals.

Run `./mvnw test` for existing collaboration checks plus presence authorization,
duplicate-user counting, cross-team isolation, roster restrictions, role changes,
revocation, idle expiration, heartbeats, and malformed-client coverage.
