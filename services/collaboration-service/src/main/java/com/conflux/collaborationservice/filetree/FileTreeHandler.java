package com.conflux.collaborationservice.filetree;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.socket.*;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;
import tools.jackson.databind.ObjectMapper;

@Component
public final class FileTreeHandler implements WebSocketHandler {
    private static final Pattern PATH = Pattern.compile("/ws/projects/([0-9a-f-]{36})/workstreams/([0-9a-f-]{36})/files");
    private final DocumentAuthorization authorization;
    private final FileTreeStore store;
    private final ObjectMapper json;
    private final Map<DocumentId, Room> rooms = new HashMap<>();

    FileTreeHandler(DocumentAuthorization authorization, FileTreeStore store, ObjectMapper json) {
        this.authorization = authorization; this.store = store; this.json = json;
    }

    record Hello(UUID teamId, String token, Integer afterVersion) {
        @Override public String toString() { return "Hello[redacted]"; }
    }
    record Synced(String type, int version, boolean initialized) { }
    record Conflict(String type, UUID operationId, int version, String message) { }
    private record Frame(boolean text, String payload) { }

    @Override public Mono<Void> handle(WebSocketSession session) {
        return Mono.defer(() -> {
            URI uri = session.getHandshakeInfo().getUri();
            var match = PATH.matcher(uri.getPath());
            if (!match.matches() || uri.getRawQuery() != null) throw new IllegalArgumentException();
            DocumentId key = FileTreeStore.key(UUID.fromString(match.group(1)), UUID.fromString(match.group(2)));
            return session.receive().map(message -> new Frame(message.getType() == WebSocketMessage.Type.TEXT,
                    message.getPayloadAsText())).timeout(Mono.delay(Duration.ofSeconds(5)), ignored -> Mono.never())
                    .switchOnFirst((first, incoming) -> {
                        if (!first.hasValue()) return incoming.then();
                        Hello hello;
                        try {
                            if (!first.get().text() || first.get().payload().getBytes(StandardCharsets.UTF_8).length > 10000)
                                throw new IllegalArgumentException();
                            hello = json.readValue(first.get().payload(), Hello.class);
                            if (hello == null) throw new IllegalArgumentException();
                        } catch (RuntimeException error) { return close(session, new DocumentAuthorization.Denied(4401)); }
                        var credentials = new DocumentAuthorization.Credentials(hello.teamId(), hello.token());
                        int after = hello.afterVersion() == null ? 0 : hello.afterVersion();
                        return authorization.authorize(key, credentials)
                                .flatMap(actor -> Mono.fromCallable(() -> join(key, session.getId(), actor, after))
                                        .subscribeOn(Schedulers.boundedElastic()))
                                .flatMap(connection -> {
                                    Mono<Void> receive = incoming.skip(1).concatMap(message -> Mono.defer(() -> {
                                        if (!message.text() || message.payload().getBytes(StandardCharsets.UTF_8).length > DocumentJournal.MAX_UPDATE)
                                            return Mono.error(new IllegalArgumentException());
                                        FileTreeStore.Command command;
                                        try { command = json.readValue(message.payload(), FileTreeStore.Command.class); }
                                        catch (RuntimeException error) { return Mono.error(new IllegalArgumentException()); }
                                        return authorization.authorize(key, credentials).flatMap(actor -> {
                                            if (!actor.equals(connection.actor)) return Mono.error(new DocumentAuthorization.Denied(4403));
                                            return Mono.fromRunnable(() -> connection.room.publish(connection, command))
                                                    .subscribeOn(Schedulers.boundedElastic());
                                        });
                                    }).onErrorResume(error -> close(session, error)), 1).then();
                                    Mono<Void> send = session.send(connection.updates().map(session::textMessage))
                                            .onErrorResume(error -> close(session, error));
                                    Mono<Void> check = Flux.interval(Duration.ofSeconds(5)).concatMap(ignored ->
                                            authorization.authorize(key, credentials).doOnNext(actor -> {
                                                if (!actor.equals(connection.actor)) throw new DocumentAuthorization.Denied(4403);
                                            }), 1).then().onErrorResume(error -> close(session, error));
                                    return Mono.firstWithSignal(receive, send, check,
                                                    connection.failure.asMono().onErrorResume(error -> close(session, error)))
                                            .doFinally(ignored -> release(key, connection));
                                }).doOnDiscard(Connection.class, connection -> release(key, connection))
                                .onErrorResume(error -> close(session, error));
                    }).then();
        }).onErrorResume(error -> close(session, error));
    }

    private Mono<Void> close(WebSocketSession session, Throwable error) {
        boolean oversized = error instanceof io.netty.handler.codec.TooLongFrameException
                || error instanceof org.springframework.core.io.buffer.DataBufferLimitException
                || error instanceof io.netty.handler.codec.http.websocketx.CorruptedWebSocketFrameException frame
                    && frame.closeStatus().code() == 1009;
        return Mono.defer(() -> session.close(new CloseStatus(
                error instanceof DocumentAuthorization.Denied denied ? denied.code
                        : oversized ? 1009 : error instanceof IllegalArgumentException ? 1008 : 1013,
                error instanceof DocumentAuthorization.Denied ? "Authentication or team access required"
                        : error instanceof IllegalArgumentException ? "Invalid file tree message"
                        : "File synchronization unavailable; reconnect to recover"))).cache();
    }

    private synchronized Connection join(DocumentId key, String id, UUID actor, int after) throws IOException {
        Room room = rooms.get(key);
        if (room == null) {
            if (rooms.size() >= 8) throw new IOException("Active workstream limit reached");
            room = new Room(store.load(key));
        }
        Connection connection = room.join(id, actor, after);
        rooms.put(key, room);
        return connection;
    }

    private void release(DocumentId key, Connection connection) {
        Schedulers.boundedElastic().schedule(() -> leave(key, connection));
    }

    private synchronized void leave(DocumentId key, Connection connection) {
        synchronized (connection.room) {
            connection.room.clients.remove(connection.id);
            connection.outbound.tryEmitComplete();
            if (connection.room.clients.isEmpty()) rooms.remove(key, connection.room);
        }
    }

    private final class Room {
        final FileTreeStore.State state;
        final Map<String, Connection> clients = new LinkedHashMap<>();
        boolean failed;
        Room(FileTreeStore.State state) { this.state = state; }

        synchronized Connection join(String id, UUID actor, int after) throws IOException {
            if (failed || clients.size() >= 32) throw new IOException("Workstream unavailable");
            if (after < 0 || after > state.version()) throw new IllegalArgumentException();
            List<String> replay = new ArrayList<>();
            state.operations.values().stream().filter(event -> event.version() > after)
                    .forEach(event -> replay.add(json.writeValueAsString(event)));
            replay.add(json.writeValueAsString(new Synced("synced", state.version(), state.version() > 0)));
            Connection connection = new Connection(this, id, actor, replay);
            clients.put(id, connection);
            return connection;
        }

        synchronized void publish(Connection sender, FileTreeStore.Command command) {
            if (failed || !clients.containsKey(sender.id)) throw new IllegalStateException("Workstream unavailable");
            int previous = state.version();
            try {
                var event = store.append(state, sender.actor, command);
                String message = json.writeValueAsString(event);
                if (event.version() <= previous) sender.emit(message);
                else clients.values().forEach(client -> client.emit(message));
            } catch (FileTreeStore.Conflict conflict) {
                sender.emit(json.writeValueAsString(new Conflict("conflict", command.operationId(), state.version(), conflict.getMessage())));
            } catch (IOException error) {
                failed = true;
                clients.values().forEach(client -> client.failure.tryEmitError(error));
                throw new IllegalStateException("Cannot persist file operation", error);
            }
        }
    }

    private static final class Connection {
        final Room room;
        final String id;
        final UUID actor;
        final List<String> replay;
        final AtomicLong queuedBytes = new AtomicLong();
        final Sinks.Empty<Void> failure = Sinks.empty();
        final Sinks.Many<String> outbound = Sinks.many().unicast().onBackpressureBuffer(new ArrayBlockingQueue<>(64));
        Connection(Room room, String id, UUID actor, List<String> replay) {
            this.room = room; this.id = id; this.actor = actor; this.replay = replay;
        }
        Flux<String> updates() {
            return Flux.concat(Flux.fromIterable(replay), outbound.asFlux()
                    .doOnNext(message -> queuedBytes.addAndGet(-message.getBytes(StandardCharsets.UTF_8).length)));
        }
        void emit(String message) {
            if (queuedBytes.addAndGet(message.getBytes(StandardCharsets.UTF_8).length) > 4 * 1024 * 1024
                    || outbound.tryEmitNext(message).isFailure())
                failure.tryEmitError(new IllegalStateException("Slow client"));
        }
    }
}
