package com.conflux.collaborationservice;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.socket.CloseStatus;
import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.WebSocketMessage;
import org.springframework.web.reactive.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.core.scheduler.Schedulers;

@Component
final class DocumentRelayHandler implements WebSocketHandler {
    private final DocumentAuthorization authorization;
    private final DocumentJournal journal;
    private final ObjectMapper json;
    private final Map<DocumentId, Room> rooms = new LinkedHashMap<>();

    DocumentRelayHandler(DocumentAuthorization authorization, DocumentJournal journal, ObjectMapper json) {
        this.authorization = authorization;
        this.journal = journal;
        this.json = json;
    }

    @Override public Mono<Void> handle(WebSocketSession session) {
        return Mono.defer(() -> {
            DocumentId document = DocumentId.from(session.getHandshakeInfo().getUri());
            return session.receive().map(Frame::copy)
                    .timeout(Mono.delay(Duration.ofSeconds(5)), ignored -> Mono.never())
                    .switchOnFirst((first, incoming) -> {
                        if (!first.hasValue()) return incoming.then();
                        Frame frame = first.get();
                        if (!frame.text || frame.bytes.length > 10000) return close(session, new DocumentAuthorization.Denied(4401));
                        DocumentAuthorization.Credentials credentials;
                        try { credentials = json.readValue(frame.bytes, DocumentAuthorization.Credentials.class); }
                        catch (RuntimeException invalid) { return close(session, new DocumentAuthorization.Denied(4401)); }
                        return authorization.authorize(document, credentials)
                                .flatMap(actor -> Mono.fromCallable(() -> join(document, session.getId(), actor))
                                        .subscribeOn(Schedulers.boundedElastic()))
                                .flatMap(connection -> {
                                    Mono<Void> receive = incoming.skip(1).concatMap(update -> Mono.defer(() -> {
                                        if (update.text || update.bytes.length == 0) return Mono.error(new IllegalArgumentException());
                                        return Mono.fromRunnable(() -> connection.room.publish(connection, update.bytes))
                                                .subscribeOn(Schedulers.boundedElastic());
                                    }).onErrorResume(error -> close(session, error)), 1).then();
                                    Mono<Void> send = session.send(connection.updates().map(update -> update.text
                                            ? session.textMessage(new String(update.bytes, java.nio.charset.StandardCharsets.UTF_8))
                                            : session.binaryMessage(factory -> factory.wrap(update.bytes))))
                                            .onErrorResume(error -> close(session, error));
                                    Mono<Void> check = Flux.interval(Duration.ofSeconds(5)).concatMap(ignored ->
                                            authorization.authorize(document, credentials)
                                                    .publishOn(Schedulers.boundedElastic()).doOnNext(actor -> {
                                                if (!actor.equals(connection.actor)) throw new DocumentAuthorization.Denied(4403);
                                                connection.room.checkInitializer(connection);
                                            }), 1).then().onErrorResume(error -> close(session, error));
                                    Mono<Void> failure = connection.failure.asMono()
                                            .onErrorResume(error -> close(session, error));
                                    return Mono.firstWithSignal(receive, send, check, failure)
                                            .doFinally(ignored -> release(document, connection));
                                }).doOnDiscard(Connection.class, connection -> release(document, connection))
                                .onErrorResume(error -> close(session, error));
                    }).then();
        }).onErrorResume(error -> close(session, error));
    }

    private Mono<Void> close(WebSocketSession session, Throwable error) {
        // Netty ends receive before flushing close; cancellation must not release that in-flight frame.
        return Mono.defer(() -> session.close(new CloseStatus(
                error instanceof DocumentAuthorization.Denied denied ? denied.code
                        : error instanceof IllegalArgumentException ? 1008 : 1013,
                error instanceof DocumentAuthorization.Denied ? "Authentication or team access required"
                        : error instanceof IllegalArgumentException ? "Invalid document message"
                        : "Collaboration unavailable; reconnect to recover"))).cache();
    }

    private synchronized Connection join(DocumentId document, String id, UUID actor) throws IOException {
        Room room = rooms.get(document);
        if (room == null) {
            if (rooms.size() >= 32) throw new IOException("Active document limit reached");
            room = new Room(document, journal.read(document));
            rooms.put(document, room);
        }
        return room.join(id, actor);
    }

    private synchronized void leave(DocumentId document, Connection connection) {
        connection.room.leave(connection);
        if (connection.room.clients.isEmpty()) rooms.remove(document, connection.room);
    }

    private void release(DocumentId document, Connection connection) {
        // Never acquire the room registry lock from inside a room's emit callback.
        Schedulers.boundedElastic().schedule(() -> leave(document, connection));
    }

    private final class Room {
        private final DocumentId document;
        private final List<DocumentJournal.Entry> history;
        private final Map<String, Connection> clients = new LinkedHashMap<>();
        private String initializer;
        private long initializationStarted;

        Room(DocumentId document, List<DocumentJournal.Entry> history) {
            this.document = document;
            this.history = new ArrayList<>(history);
        }

        synchronized Connection join(String id, UUID actor) throws IOException {
            if (clients.size() >= 32) throw new IOException("Document participant limit reached");
            List<Frame> replay = new ArrayList<>();
            history.forEach(entry -> replay.add(new Frame(false, entry.update())));
            if (!history.isEmpty()) replay.add(Frame.SYNCED);
            else if (initializer == null) {
                initializer = id;
                initializationStarted = System.nanoTime();
                replay.add(Frame.INITIALIZE);
            }
            Connection connection = new Connection(this, id, actor, replay);
            clients.put(id, connection);
            return connection;
        }

        synchronized void publish(Connection sender, byte[] bytes) {
            if (!clients.containsKey(sender.id)) throw new IllegalArgumentException();
            if (history.isEmpty() && !sender.id.equals(initializer)) throw new IllegalArgumentException();
            // Retries of an identical update must not create a second contribution record.
            if (history.stream().anyMatch(entry -> Arrays.equals(entry.update(), bytes))) return;
            boolean initializing = history.isEmpty();
            try { history.add(journal.append(document, sender.actor, bytes, history.size() + 1)); }
            catch (IOException error) {
                clients.values().forEach(client -> client.failure.tryEmitError(error));
                throw new IllegalStateException("Cannot persist document update", error);
            }
            clients.values().forEach(client -> {
                if (!client.id.equals(sender.id)) client.emit(new Frame(false, bytes));
                if (initializing) client.emit(Frame.SYNCED);
            });
            initializer = null;
        }

        synchronized void checkInitializer(Connection connection) {
            if (connection.id.equals(initializer)
                    && System.nanoTime() - initializationStarted > Duration.ofSeconds(10).toNanos())
                throw new IllegalArgumentException("Initialization timed out");
        }

        synchronized void leave(Connection connection) {
            clients.remove(connection.id);
            connection.outbound.tryEmitComplete();
            if (connection.id.equals(initializer)) {
                initializer = null;
                if (!clients.isEmpty()) {
                    Connection next = clients.values().iterator().next();
                    initializer = next.id;
                    initializationStarted = System.nanoTime();
                    next.emit(Frame.INITIALIZE);
                }
            }
        }
    }

    private static final class Connection {
        final Room room;
        final String id;
        final UUID actor;
        final List<Frame> replay;
        final AtomicLong queuedBytes = new AtomicLong();
        final Sinks.Empty<Void> failure = Sinks.empty();
        final Sinks.Many<Frame> outbound = Sinks.many().unicast().onBackpressureBuffer(new ArrayBlockingQueue<>(64));
        Connection(Room room, String id, UUID actor, List<Frame> replay) {
            this.room = room; this.id = id; this.actor = actor; this.replay = replay;
        }
        Flux<Frame> updates() {
            return Flux.concat(Flux.fromIterable(replay), outbound.asFlux()
                    .doOnNext(frame -> queuedBytes.addAndGet(-frame.bytes.length)));
        }
        void emit(Frame frame) {
            if (queuedBytes.addAndGet(frame.bytes.length) > 4 * 1024 * 1024
                    || outbound.tryEmitNext(frame).isFailure())
                failure.tryEmitError(new IllegalStateException("Slow client"));
        }
    }

    private record Frame(boolean text, byte[] bytes) {
        static final Frame INITIALIZE = control("initialize");
        static final Frame SYNCED = control("synced");
        static Frame control(String type) {
            return new Frame(true, ("{\"type\":\"" + type + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        static Frame copy(WebSocketMessage message) {
            if (message.getPayload().readableByteCount() > DocumentJournal.MAX_UPDATE)
                throw new IllegalArgumentException("Message too large");
            if (message.getType() != WebSocketMessage.Type.TEXT && message.getType() != WebSocketMessage.Type.BINARY)
                throw new IllegalArgumentException("Unsupported message");
            byte[] bytes = new byte[message.getPayload().readableByteCount()];
            message.getPayload().read(bytes);
            return new Frame(message.getType() == WebSocketMessage.Type.TEXT, bytes);
        }
    }
}
