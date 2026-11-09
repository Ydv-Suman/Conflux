package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.AttributedDocumentStore;
import java.util.Base64;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.io.IOException;
import java.time.Duration;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
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
public final class DocumentRelayHandler implements WebSocketHandler {
    private final DocumentAuthorization authorization;
    private final DocumentJournal journal;
    private final ObjectMapper json;
    private final AttributedDocumentStore attributedStore;
    private final Map<DocumentId, Room> rooms = new LinkedHashMap<>();

    DocumentRelayHandler(DocumentAuthorization authorization, DocumentJournal journal, AttributedDocumentStore attributedStore, ObjectMapper json) {
        this.authorization = authorization;
        this.journal = journal;
        this.json = json;
        this.attributedStore = attributedStore;
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
                        Handshake handshake;
                        try { handshake = json.readValue(frame.bytes, Handshake.class);
                            if (handshake == null) throw new IllegalArgumentException();
                        }
                        catch (RuntimeException invalid) { return close(session, new DocumentAuthorization.Denied(4401)); }
                        var credentials = new DocumentAuthorization.Credentials(handshake.teamId(), handshake.token());
                        return authorization.authorize(document, credentials)
                                .flatMap(actor -> Mono.fromCallable(() -> join(document, session.getId(), actor, Boolean.TRUE.equals(handshake.acknowledgements()), handshake.protocol(), handshake.registrationId(), Boolean.TRUE.equals(handshake.migrateLegacy()), Boolean.TRUE.equals(handshake.checkpoints())))
                                        .subscribeOn(Schedulers.boundedElastic()))
                                .flatMap(connection -> {
                                    Mono<Void> receive = incoming.skip(1).concatMap(update -> Mono.defer(() -> {
                                        if (connection.room.attributed) {
                                            if (!update.text) return Mono.error(new IllegalArgumentException());
                                            return authorization.authorize(document, credentials).flatMap(actor -> {
                                                if (!actor.equals(connection.actor)) return Mono.error(new DocumentAuthorization.Denied(4403));
                                                return Mono.fromRunnable(() -> connection.room.publishAttributed(connection, update.bytes))
                                                        .subscribeOn(Schedulers.boundedElastic());
                                            });
                                        }
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
                error instanceof LegacyRecoveryRequired ? 4410 : error instanceof DocumentAuthorization.Denied denied ? denied.code
                        : error instanceof IllegalArgumentException ? 1008 : 1013,
                error instanceof LegacyRecoveryRequired ? "Legacy recovery requires review" : error instanceof DocumentAuthorization.Denied ? "Authentication or team access required"
                        : error instanceof IllegalArgumentException ? "Invalid document message"
                        : "Collaboration unavailable; reconnect to recover"))).cache();
    }

    private synchronized Connection join(DocumentId document, String id, UUID actor, boolean acknowledgements, Integer protocol, UUID registrationId, boolean migrateLegacy, boolean checkpoints) throws IOException {
        if (protocol != null && protocol != 1 && protocol != 2) throw new IllegalArgumentException();
        if (Integer.valueOf(2).equals(protocol) && registrationId == null) throw new IllegalArgumentException();
        Room room = rooms.get(document);
        if (room == null) {
            if (rooms.size() >= 32) throw new IOException("Active document limit reached");
            var history = journal.read(document);
            boolean migrationBlocked = false;
            if (!history.isEmpty() && !journal.attributed(document) && migrateLegacy && Integer.valueOf(2).equals(protocol)) {
                try {
                    attributedStore.migrateLegacy(document, actor);
                    history = journal.read(document);
                } catch (DocumentUpdateValidator.Rejected unsupported) { migrationBlocked = true; }
            }
            boolean attributed = journal.attributed(document) || (history.isEmpty() && Integer.valueOf(2).equals(protocol));
            room = new Room(document, history, attributed, migrationBlocked);
            rooms.put(document, room);
        }
        try { return room.join(id, actor, acknowledgements, protocol, registrationId, checkpoints); }
        catch (IOException | RuntimeException failure) {
            if (room.clients.isEmpty()) rooms.remove(document, room);
            throw failure;
        }
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
        private final boolean attributed;
        private final boolean migrationBlocked;
        private String initializer;
        private long initializationStarted;

        Room(DocumentId document, List<DocumentJournal.Entry> history, boolean attributed, boolean migrationBlocked) {
            this.migrationBlocked = migrationBlocked;
            this.attributed = attributed;
            this.document = document;
            this.history = new ArrayList<>(history);
        }

        synchronized Connection join(String id, UUID actor, boolean acknowledgements, Integer protocol, UUID registrationId, boolean checkpoints) throws IOException {
            if (attributed && !Integer.valueOf(2).equals(protocol)) {
                if (history.stream().anyMatch(entry -> entry.attribution() != null && entry.attribution().importedWriters() != null))
                    throw new LegacyRecoveryRequired();
                throw new IllegalArgumentException("Attribution protocol required");
            }
            if (clients.size() >= 32) throw new IOException("Document participant limit reached");
            List<Frame> replay = new ArrayList<>();
            if (Integer.valueOf(2).equals(protocol)) {
                var firstAttributed = history.stream().filter(entry -> entry.attribution() != null).findFirst();
                String initial = !attributed || firstAttributed.isEmpty() ? "" : ",\"initialOperationId\":\"" + firstAttributed.get().attribution().operationId() + "\"";
                replay.add(textFrame("{\"type\":\"protocol\",\"version\":" + (attributed ? 2 : 1) + initial + ",\"migrationBlocked\":" + migrationBlocked + "}"));
            }
            if (attributed) {
                var binding = attributedStore.register(document, actor, registrationId);
                replay.add(textFrame("{\"type\":\"writer\",\"requestId\":\"" + registrationId
                        + "\",\"writerId\":" + binding.writerId() + "}"));
            }
            history.forEach(entry -> replay.add(new Frame(false, entry.update())));
            if (!history.isEmpty()) replay.add(checkpoints ? textFrame("{\"type\":\"synced\",\"sequence\":" + history.size() + "}") : Frame.SYNCED);
            else if (initializer == null) {
                initializer = id;
                initializationStarted = System.nanoTime();
                replay.add(Frame.INITIALIZE);
            }
            Connection connection = new Connection(this, id, actor, replay, acknowledgements || attributed, checkpoints);
            clients.put(id, connection);
            return connection;
        }

        synchronized void publish(Connection sender, byte[] bytes) {
            if (!clients.containsKey(sender.id)) throw new IllegalArgumentException();
            if (history.isEmpty() && !sender.id.equals(initializer)) throw new IllegalArgumentException();
            // Retries of an identical update must not create a second contribution record.
            for (var entry : history) {
                if (Arrays.equals(entry.update(), bytes)) {
                    sender.acknowledge(entry);
                    return;
                }
            }
            boolean initializing = history.isEmpty();
            try { history.add(journal.append(document, sender.actor, bytes, history.size() + 1)); }
            catch (IOException error) {
                clients.values().forEach(client -> client.failure.tryEmitError(error));
                throw new IllegalStateException("Cannot persist document update", error);
            }
            clients.values().forEach(client -> {
                if (!client.id.equals(sender.id)) client.update(bytes, history.getLast().sequence());
                if (initializing) client.synced(history.getLast().sequence());
            });
            initializer = null;
            sender.acknowledge(history.getLast());
        }

        synchronized void publishAttributed(Connection sender, byte[] frame) {
            if (!clients.containsKey(sender.id)) throw new IllegalArgumentException();
            Edit edit = json.readValue(frame, Edit.class);
            if (edit == null || !("edit".equals(edit.type()) || "seed".equals(edit.type()))
                    || edit.operationId() == null || edit.writerId() == null || edit.update() == null
                    || edit.update().length() > 2_796_204) throw new IllegalArgumentException();
            byte[] bytes = Base64.getDecoder().decode(edit.update());
            if (!Base64.getEncoder().encodeToString(bytes).equals(edit.update())) throw new IllegalArgumentException();
            boolean initializing = history.isEmpty();
            if (initializing && (!sender.id.equals(initializer) || !"seed".equals(edit.type()))) throw new IllegalArgumentException();
            DocumentJournal.Entry saved;
            try {
                saved = "seed".equals(edit.type())
                        ? attributedStore.seed(document, sender.actor, edit.writerId(), edit.operationId(), bytes)
                        : attributedStore.submit(document, sender.actor, edit.writerId(), edit.operationId(), bytes);
            } catch (IOException error) {
                clients.values().forEach(client -> client.failure.tryEmitError(error));
                throw new IllegalStateException("Cannot persist attributed update", error);
            }
            if (saved.sequence() > history.size()) {
                if (saved.sequence() != history.size() + 1) throw new IllegalStateException("Stale room history");
                history.add(saved);
                clients.values().forEach(client -> {
                    if (!client.id.equals(sender.id)) client.update(saved.update(), saved.sequence());
                    if (initializing) client.synced(saved.sequence());
                });
                initializer = null;
            }
            sender.acknowledge(saved);
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
        final boolean acknowledgements;
        final boolean checkpoints;
        final List<Frame> replay;
        final AtomicLong queuedBytes = new AtomicLong();
        final Sinks.Empty<Void> failure = Sinks.empty();
        final Sinks.Many<Frame> outbound = Sinks.many().unicast().onBackpressureBuffer(new ArrayBlockingQueue<>(64));
        Connection(Room room, String id, UUID actor, List<Frame> replay, boolean acknowledgements, boolean checkpoints) {
            this.room = room; this.id = id; this.actor = actor; this.replay = replay;
            this.acknowledgements = acknowledgements; this.checkpoints = checkpoints;
        }
        Flux<Frame> updates() {
            return Flux.concat(Flux.fromIterable(replay), outbound.asFlux()
                    .doOnNext(frame -> queuedBytes.addAndGet(-frame.bytes.length)));
        }
        void synced(int sequence) { emit(checkpoints ? textFrame("{\"type\":\"synced\",\"sequence\":" + sequence + "}") : Frame.SYNCED); }
        void update(byte[] update, int sequence) {
            if (checkpoints) emit(textFrame("{\"type\":\"revision\",\"sequence\":" + sequence + "}"));
            emit(new Frame(false, update));
        }
        void acknowledge(DocumentJournal.Entry entry) {
            if (!acknowledgements) return;
            try {
                String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(entry.update()));
                String identity = entry.attribution() == null ? "" : ",\"operationId\":\"" + entry.attribution().operationId()
                        + "\",\"writerId\":" + entry.attribution().writerId();
                emit(textFrame("{\"type\":\"ack\",\"sha256\":\"" + hash
                        + "\",\"sequence\":" + entry.sequence() + identity + "}"));
            } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        }
        void emit(Frame frame) {
            if (queuedBytes.addAndGet(frame.bytes.length) > 4 * 1024 * 1024
                    || outbound.tryEmitNext(frame).isFailure())
                failure.tryEmitError(new IllegalStateException("Slow client"));
        }
    }

    private static final class LegacyRecoveryRequired extends IllegalStateException { }

    private record Edit(String type, UUID operationId, Long writerId, String update) { }

    private static Frame textFrame(String value) { return new Frame(true, value.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }

    private record Handshake(UUID teamId, String token, Boolean acknowledgements, Integer protocol, UUID registrationId, Boolean migrateLegacy, Boolean checkpoints) {
        @Override public String toString() { return "Handshake[redacted]"; }
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
