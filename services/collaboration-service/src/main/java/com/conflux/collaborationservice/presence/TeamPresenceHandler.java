package com.conflux.collaborationservice.presence;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentAuthorization.PresenceMember;
import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.socket.*;
import reactor.core.publisher.*;
import tools.jackson.databind.ObjectMapper;

@Component
public final class TeamPresenceHandler implements WebSocketHandler {
    private static final Pattern PATH = Pattern.compile("/ws/teams/([0-9a-f-]{36})/presence");
    private final DocumentAuthorization authorization;
    private final ObjectMapper json;
    private final Duration idleTimeout, authorizationInterval;
    // shortcut: one relay instance owns presence; share leases before scaling to multiple instances.
    private final Map<UUID, Map<String, Peer>> teams = new HashMap<>();

    TeamPresenceHandler(DocumentAuthorization authorization, ObjectMapper json,
            @Value("${app.presence-idle-timeout:35s}") Duration idleTimeout,
            @Value("${app.presence-authorization-interval:5s}") Duration authorizationInterval) {
        this.authorization = authorization; this.json = json;
        this.idleTimeout = idleTimeout; this.authorizationInterval = authorizationInterval;
    }

    record Hello(String token) {
        @Override public String toString() { return "Hello[redacted]"; }
    }
    private record Frame(String payload) { }

    @Override public Mono<Void> handle(WebSocketSession session) {
        return Mono.defer(() -> {
            var uri = session.getHandshakeInfo().getUri();
            var match = PATH.matcher(uri.getPath());
            if (!match.matches() || uri.getRawQuery() != null) throw new IllegalArgumentException();
            UUID team = UUID.fromString(match.group(1));
            return session.receive().map(message -> new Frame(
                    message.getType() == WebSocketMessage.Type.TEXT && message.getPayload().readableByteCount() <= 10000
                            ? message.getPayloadAsText() : null))
                    .timeout(Mono.delay(Duration.ofSeconds(5)), ignored -> Mono.never())
                    .switchOnFirst((first, incoming) -> {
                        if (first.hasError()) return close(session, first.getThrowable());
                        if (!first.hasValue()) return incoming.then();
                        if (first.get().payload() == null) return close(session, new IllegalArgumentException());
                        Hello hello;
                        try { hello = json.readValue(first.get().payload(), Hello.class); }
                        catch (RuntimeException error) { return close(session, new DocumentAuthorization.Denied(4401)); }
                        var credentials = new DocumentAuthorization.Credentials(team, hello == null ? null : hello.token());
                        return authorization.authorizePresence(credentials).flatMap(member -> Mono.using(
                                () -> join(team, session.getId(), member),
                                peer -> {
                                    Mono<Void> receive = incoming.skip(1).concatMap(message -> Mono.defer(() -> {
                                        if (!"ping".equals(message.payload())) return close(session, new IllegalArgumentException());
                                        peer.lastSeen = System.nanoTime();
                                        refresh(team, peer);
                                        return Mono.<Void>empty();
                                    }).onErrorResume(error -> close(session, error)), 1).then();
                                    Mono<Void> send = session.send(peer.updates.asFlux().map(session::textMessage))
                                            .onErrorResume(error -> close(session, error));
                                    Mono<Void> check = Flux.interval(authorizationInterval).concatMap(ignored ->
                                            authorization.authorizePresence(credentials).doOnNext(next -> update(team, peer, next)), 1)
                                            .then().onErrorResume(error -> close(session, error));
                                    Mono<Void> idle = Flux.interval(Duration.ofSeconds(1)).doOnNext(ignored -> {
                                        if (System.nanoTime() - peer.lastSeen >= idleTimeout.toNanos())
                                            throw new IllegalStateException("Presence heartbeat expired");
                                    }).then().onErrorResume(error -> close(session, error));
                                    return Mono.firstWithSignal(receive, send, check, idle);
                                }, peer -> leave(team, peer))).onErrorResume(error -> close(session, error));
                    }).then();
        }).onErrorResume(error -> close(session, error));
    }

    private Mono<Void> close(WebSocketSession session, Throwable error) {
        return Mono.defer(() -> session.close(new CloseStatus(
                error instanceof DocumentAuthorization.Denied denied ? denied.code
                        : error instanceof IllegalArgumentException ? 1008 : 1013,
                "Team presence unavailable"))).cache();
    }

    private synchronized Peer join(UUID team, String id, PresenceMember member) {
        if (!teams.containsKey(team) && teams.size() >= 128) throw new IllegalStateException("Presence capacity reached");
        var peers = teams.computeIfAbsent(team, ignored -> new LinkedHashMap<>());
        if (peers.size() >= 128) throw new IllegalStateException("Team connection limit reached");
        var peer = new Peer(id, member);
        peers.put(id, peer);
        broadcast(team, peers);
        return peer;
    }

    private synchronized void leave(UUID team, Peer peer) {
        var peers = teams.get(team);
        if (peers == null || !peers.remove(peer.id, peer)) return;
        peer.updates.tryEmitComplete();
        if (peers.isEmpty()) teams.remove(team);
        else broadcast(team, peers);
    }

    private synchronized void refresh(UUID team, Peer peer) {
        var peers = teams.get(team);
        if (peers != null && peers.get(peer.id) == peer) emit(team, peers, peer);
    }

    private synchronized void update(UUID team, Peer peer, PresenceMember member) {
        if (!peer.member.userId().equals(member.userId())) throw new DocumentAuthorization.Denied(4403);
        if (peer.member.canViewRoster() != member.canViewRoster()) {
            peer.member = member;
            refresh(team, peer);
        }
    }

    private void broadcast(UUID team, Map<String, Peer> peers) {
        new ArrayList<>(peers.values()).forEach(peer -> emit(team, peers, peer));
    }

    private void emit(UUID team, Map<String, Peer> peers, Peer recipient) {
        var users = peers.values().stream().map(peer -> peer.member.userId()).distinct().sorted().toList();
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", "presence"); message.put("teamId", team); message.put("count", users.size());
        if (recipient.member.canViewRoster()) message.put("userIds", users);
        // Presence is a current snapshot: a slow subscriber only needs the latest value.
        recipient.updates.tryEmitNext(json.writeValueAsString(message));
    }

    private static final class Peer {
        final String id;
        PresenceMember member;
        volatile long lastSeen = System.nanoTime();
        final Sinks.Many<String> updates = Sinks.many().replay().latest();
        Peer(String id, PresenceMember member) { this.id = id; this.member = member; }
    }
}
