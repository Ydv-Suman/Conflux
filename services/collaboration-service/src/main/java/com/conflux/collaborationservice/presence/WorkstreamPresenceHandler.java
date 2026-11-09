package com.conflux.collaborationservice.presence;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.socket.*;
import reactor.core.publisher.*;
import tools.jackson.databind.ObjectMapper;

/** Ephemeral active-file/cursor state. Identity is supplied only by authenticated scope authorization. */
@Component
public final class WorkstreamPresenceHandler implements WebSocketHandler {
    private static final Pattern PATH = Pattern.compile("/ws/projects/([0-9a-f-]{36})/workstreams/([0-9a-f-]{36})/presence");
    private final DocumentAuthorization authorization;
    private final ObjectMapper json;
    private final Duration idleTimeout, authorizationInterval;
    // Like the document relay, presence is single-instance; share expiring leases before horizontal scaling.
    private final Map<Scope, Map<UUID, Peer>> rooms = new HashMap<>();

    WorkstreamPresenceHandler(DocumentAuthorization authorization, ObjectMapper json,
            @Value("${app.presence-idle-timeout:35s}") Duration idleTimeout,
            @Value("${app.presence-authorization-interval:5s}") Duration authorizationInterval) {
        this.authorization = authorization; this.json = json;
        this.idleTimeout = idleTimeout; this.authorizationInterval = authorizationInterval;
    }

    @Override public Mono<Void> handle(WebSocketSession session) {
        return Mono.defer(() -> {
            var uri = session.getHandshakeInfo().getUri(); var match = PATH.matcher(uri.getPath());
            if (!match.matches() || uri.getRawQuery() != null) throw new IllegalArgumentException();
            var scope = new Scope(UUID.fromString(match.group(1)), UUID.fromString(match.group(2)));
            return session.receive().map(message -> message.getType() == WebSocketMessage.Type.TEXT && message.getPayload().readableByteCount() <= 10000
                            ? message.getPayloadAsText() : "")
                    .timeout(Mono.delay(Duration.ofSeconds(5)), ignored -> Mono.never())
                    .switchOnFirst((first, incoming) -> {
                        if (first.hasError()) return close(session, first.getThrowable());
                        if (!first.hasValue()) return incoming.then();
                        Hello hello;
                        try { hello = json.readValue(first.get(), Hello.class); if (hello == null) throw new IllegalArgumentException(); }
                        catch (RuntimeException invalid) { return close(session, new DocumentAuthorization.Denied(4401)); }
                        var credentials = new DocumentAuthorization.Credentials(hello.teamId(), hello.token());
                        var document = new DocumentId(scope.projectId(), scope.workstreamId(), "presence");
                        return authorization.authorize(document, credentials).flatMap(actor -> Mono.using(
                                () -> join(scope, hello.teamId(), actor),
                                peer -> {
                                    Mono<Void> receive = incoming.skip(1).concatMap(value -> Mono.defer(() -> {
                                        if (value.length() > 2048) throw new IllegalArgumentException();
                                        try { update(scope, peer, json.readValue(value, Update.class)); }
                                        catch (RuntimeException invalid) { throw new IllegalArgumentException("Invalid presence update", invalid); }
                                        return Mono.<Void>empty();
                                    }).onErrorResume(error -> close(session, error)), 1).then();
                                    Mono<Void> send = session.send(peer.updates.asFlux().map(session::textMessage)).onErrorResume(error -> close(session, error));
                                    Mono<Void> check = Flux.interval(authorizationInterval).concatMap(ignored -> authorization.authorize(document, credentials)
                                            .doOnNext(next -> { if (!peer.userId.equals(next)) throw new DocumentAuthorization.Denied(4403); }), 1)
                                            .then().onErrorResume(error -> close(session, error));
                                    Mono<Void> idle = Flux.interval(Duration.ofSeconds(1)).doOnNext(ignored -> {
                                        if (System.nanoTime() - peer.lastSeen >= idleTimeout.toNanos()) throw new IllegalStateException("Presence expired");
                                    }).then().onErrorResume(error -> close(session, error));
                                    return Mono.firstWithSignal(receive, send, check, idle);
                                }, peer -> leave(scope, peer))).onErrorResume(error -> close(session, error));
                    }).then();
        }).onErrorResume(error -> close(session, error));
    }

    private Mono<Void> close(WebSocketSession session, Throwable error) {
        return Mono.defer(() -> session.close(new CloseStatus(error instanceof DocumentAuthorization.Denied denied ? denied.code
                : error instanceof IllegalArgumentException ? 1008 : 1013, "Workstream presence unavailable"))).cache();
    }

    private synchronized Peer join(Scope scope, UUID team, UUID actor) {
        if (!rooms.containsKey(scope) && rooms.size() >= 128) throw new IllegalStateException("Presence capacity reached");
        var peers = rooms.computeIfAbsent(scope, ignored -> new LinkedHashMap<>());
        if (peers.size() >= 32) throw new IllegalStateException("Workstream presence capacity reached");
        var peer = new Peer(team, actor); peers.put(peer.id, peer); broadcast(scope, peers); return peer;
    }

    private synchronized void update(Scope scope, Peer peer, Update value) {
        if (value == null || !"presence".equals(value.type())
                || (value.documentId() != null && !value.documentId().matches("[A-Za-z0-9._-]{1,128}"))
                || (value.anchor() == null) != (value.head() == null)
                || (value.documentId() == null && value.anchor() != null)
                || !position(value.anchor()) || !position(value.head())) throw new IllegalArgumentException();
        long now = System.nanoTime();
        if (now - peer.windowStart >= Duration.ofSeconds(1).toNanos()) { peer.windowStart = now; peer.messages = 0; }
        if (++peer.messages > 60) throw new IllegalArgumentException("Presence rate exceeded");
        peer.lastSeen = now;
        var peers = rooms.get(scope);
        if (peers == null || peers.get(peer.id) != peer) return;
        if (!value.equals(peer.state)) { peer.state = value; broadcast(scope, peers); }
        else emit(scope, peers, peer);
    }

    private boolean position(String encoded) {
        if (encoded == null) return true;
        if (encoded.isEmpty() || encoded.length() > 256) return false;
        try { return Base64.getEncoder().encodeToString(Base64.getDecoder().decode(encoded)).equals(encoded); }
        catch (IllegalArgumentException invalid) { return false; }
    }

    private synchronized void leave(Scope scope, Peer peer) {
        var peers = rooms.get(scope);
        if (peers == null || !peers.remove(peer.id, peer)) return;
        peer.updates.tryEmitComplete();
        if (peers.isEmpty()) rooms.remove(scope); else broadcast(scope, peers);
    }
    private void broadcast(Scope scope, Map<UUID, Peer> peers) { new ArrayList<>(peers.values()).forEach(peer -> emit(scope, peers, peer)); }
    private void emit(Scope scope, Map<UUID, Peer> peers, Peer recipient) {
        var participants = peers.values().stream().filter(peer -> peer.state.documentId() != null)
                .map(peer -> new Participant(peer.id, peer.userId, peer.state.documentId(), peer.state.anchor(), peer.state.head())).toList();
        recipient.updates.tryEmitNext(json.writeValueAsString(new Snapshot("workstream-presence", scope.projectId(), recipient.teamId,
                scope.workstreamId(), recipient.id, participants)));
    }

    private record Scope(UUID projectId, UUID workstreamId) { }
    record Hello(UUID teamId, String token) { @Override public String toString() { return "Hello[redacted]"; } }
    private record Update(String type, String documentId, String anchor, String head) { }
    private record Participant(UUID sessionId, UUID userId, String documentId, String anchor, String head) { }
    private record Snapshot(String type, UUID projectId, UUID teamId, UUID workstreamId, UUID selfId, List<Participant> participants) { }
    private static final class Peer {
        final UUID id = UUID.randomUUID(), teamId, userId;
        volatile long lastSeen = System.nanoTime();
        long windowStart = lastSeen;
        int messages;
        Update state = new Update("presence", null, null, null);
        final Sinks.Many<String> updates = Sinks.many().replay().latest();
        Peer(UUID team, UUID user) { teamId = team; userId = user; }
    }
}
