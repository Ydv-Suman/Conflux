package com.conflux.collaborationservice;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import reactor.core.publisher.Mono;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DocumentRelayIntegrationTests {
    static final UUID PROJECT = UUID.randomUUID();
    static final UUID TEAM = UUID.randomUUID();
    static final UUID ALICE = UUID.randomUUID();
    static final UUID BOB = UUID.randomUUID();
    @TempDir static Path data;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.document-directory", () -> data.toString());
    }
    @Value("${local.server.port}") int port;
    @MockitoBean DocumentAuthorization authorization;
    @Autowired DocumentJournal journal;
    private final AtomicBoolean revoked = new AtomicBoolean();

    @BeforeEach void authorize() {
        revoked.set(false);
        when(authorization.authorize(any(), any())).thenAnswer(invocation -> {
            DocumentAuthorization.Credentials credentials = invocation.getArgument(1);
            if (revoked.get() || credentials.token().equals("denied")) return Mono.error(new DocumentAuthorization.Denied(4403));
            if (credentials.token().equals("expired")) return Mono.error(new DocumentAuthorization.Denied(4401));
            return Mono.just(credentials.token().equals("alice") ? ALICE : BOB);
        });
    }

    @Test void authenticatesBeforeReplayingAnyDocumentBytes() throws Exception {
        DocumentId room = room();
        try (Peer owner = connect(room, "alice")) {
            owner.control("initialize"); owner.send(new byte[]{1, 2}); owner.control("synced");
            try (Peer denied = connect(room, "denied"); Peer expired = connect(room, "expired")) {
                assertEquals(4403, denied.closed.get(5, TimeUnit.SECONDS));
                assertEquals(4401, expired.closed.get(5, TimeUnit.SECONDS));
                assertTrue(denied.messages.isEmpty());
                assertTrue(expired.messages.isEmpty());
            }
        }
    }

    @Test void serializesSimultaneousEditsAndRecordsAuthenticatedContributors() throws Exception {
        DocumentId room = room();
        try (Peer alice = initializer(room); Peer bob = connect(room, "bob")) {
            assertNull(bob.messages.poll(150, TimeUnit.MILLISECONDS));
            alice.send(new byte[]{1}); alice.control("synced");
            assertArrayEquals(new byte[]{1}, bob.binary()); bob.control("synced");
            CompletableFuture.allOf(alice.socket.sendBinary(ByteBuffer.wrap(new byte[]{2}), true),
                    bob.socket.sendBinary(ByteBuffer.wrap(new byte[]{3}), true)).get(5, TimeUnit.SECONDS);
            assertArrayEquals(new byte[]{3}, alice.binary());
            assertArrayEquals(new byte[]{2}, bob.binary());
            var history = journal.read(room);
            assertEquals(3, history.size());
            assertEquals(ALICE, history.stream().filter(entry -> entry.update()[0] == 2).findFirst().orElseThrow().actorId());
            assertEquals(BOB, history.stream().filter(entry -> entry.update()[0] == 3).findFirst().orElseThrow().actorId());
        }
    }

    @Test void replaysPersistedHistoryAndDeduplicatesIdenticalRetries() throws Exception {
        DocumentId room = room();
        try (Peer alice = connect(room, "alice")) {
            alice.control("initialize"); alice.send(new byte[]{4}); alice.control("synced");
            alice.send(new byte[]{4});
            alice.send(new byte[]{5});
            try (Peer bob = connect(room, "bob")) {
                assertArrayEquals(new byte[]{4}, bob.binary());
                assertArrayEquals(new byte[]{5}, bob.binary());
                bob.control("synced");
            }
        }
        try (Peer reconnect = connect(room, "alice")) {
            assertArrayEquals(new byte[]{4}, reconnect.binary());
            assertArrayEquals(new byte[]{5}, reconnect.binary());
            reconnect.control("synced");
            assertEquals(2, journal.read(room).size());
        }
    }

    @Test void separatesDocumentsAndWorkstreams() throws Exception {
        DocumentId first = room();
        DocumentId other = new DocumentId(first.projectId(), UUID.randomUUID(), first.documentId());
        try (Peer alice = connect(first, "alice"); Peer bob = connect(other, "bob")) {
            alice.control("initialize"); bob.control("initialize");
            alice.send(new byte[]{6}); alice.control("synced");
            assertNull(bob.messages.poll(150, TimeUnit.MILLISECONDS));
            bob.send(new byte[]{7}); bob.control("synced");
            assertArrayEquals(new byte[]{6}, journal.read(first).getFirst().update());
            assertArrayEquals(new byte[]{7}, journal.read(other).getFirst().update());
        }
    }

    @Test void transfersInitializationWhenTheFirstParticipantDisconnects() throws Exception {
        DocumentId room = room();
        try (Peer alice = initializer(room); Peer bob = connect(room, "bob")) {
            alice.close();
            bob.control("initialize"); bob.send(new byte[]{8}); bob.control("synced");
            assertEquals(BOB, journal.read(room).getFirst().actorId());
        }
    }

    @Test void closesAnExistingSessionWhenMembershipIsRevoked() throws Exception {
        try (Peer alice = connect(room(), "alice")) {
            alice.control("initialize"); alice.send(new byte[]{9}); alice.control("synced");
            revoked.set(true);
            assertEquals(4403, alice.closed.get(9, TimeUnit.SECONDS));
        }
    }

    @Test void doesNotLetASecondParticipantSeedAnUninitializedDocument() throws Exception {
        DocumentId room = room();
        try (Peer alice = initializer(room); Peer bob = connect(room, "bob")) {
            bob.send(new byte[]{42});
            assertEquals(1008, bob.closed.get(5, TimeUnit.SECONDS));
            assertTrue(journal.read(room).isEmpty());
            alice.send(new byte[]{43}); alice.control("synced");
            assertEquals(ALICE, journal.read(room).getFirst().actorId());
        }
    }

    @Test void rejectsOversizedWireMessagesWithoutPersistingThem() throws Exception {
        DocumentId room = room();
        try (Peer alice = initializer(room)) {
            alice.socket.sendBinary(ByteBuffer.wrap(new byte[DocumentJournal.MAX_UPDATE + 1]), true)
                    .exceptionally(error -> null).get(5, TimeUnit.SECONDS);
            assertEquals(1009, alice.closed.get(5, TimeUnit.SECONDS));
            assertTrue(journal.read(room).isEmpty());
        }
    }

    @Test void rejectsBinaryBeforeAuthenticationAndTokensInUrls() throws Exception {
        DocumentId room = room();
        try (Peer peer = new Peer(endpoint(room))) {
            peer.send(new byte[]{10});
            assertEquals(4401, peer.closed.get(5, TimeUnit.SECONDS));
        }
        try (Peer peer = new Peer(URI.create(endpoint(room) + "?token=secret"))) {
            assertEquals(1008, peer.closed.get(5, TimeUnit.SECONDS));
        }
        assertTrue(journal.read(room).isEmpty());
    }

    @Test void activityRequiresAccessAndPaginatesNewestFirstWithoutDocumentContents() throws Exception {
        DocumentId room = room();
        try (Peer alice = connect(room, "alice")) {
            alice.control("initialize"); alice.send(new byte[]{11}); alice.control("synced");
            try (Peer bob = connect(room, "bob")) {
                bob.binary(); bob.control("synced"); alice.send(new byte[]{12}); bob.binary();
            }
            var client = HttpClient.newHttpClient();
            String url = "http://localhost:" + port + "/api/projects/" + PROJECT + "/teams/" + TEAM
                    + "/workstreams/" + room.workstreamId() + "/documents/" + room.documentId() + "/activity?limit=1";
            var request = java.net.http.HttpRequest.newBuilder(URI.create(url)).header("Authorization", "Bearer alice").build();
            var response = client.send(request, java.net.http.HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            assertTrue(response.body().contains("\"nextBefore\":2"));
            assertTrue(response.body().contains(ALICE.toString()));
            assertFalse(response.body().contains("\"update\""));
            revoked.set(true);
            assertEquals(403, client.send(request, java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        }
    }

    private DocumentId room() { return new DocumentId(PROJECT, UUID.randomUUID(), "main-ts"); }
    private Peer initializer(DocumentId room) throws Exception {
        Peer peer = connect(room, "alice");
        peer.control("initialize");
        return peer;
    }
    private URI endpoint(DocumentId document) {
        return URI.create("ws://localhost:" + port + "/ws/projects/" + document.projectId()
                + "/workstreams/" + document.workstreamId() + "/documents/" + document.documentId());
    }
    private Peer connect(DocumentId document, String token) throws Exception {
        Peer peer = new Peer(endpoint(document));
        peer.socket.sendText("{\"teamId\":\"" + TEAM + "\",\"token\":\"" + token + "\"}", true).get(5, TimeUnit.SECONDS);
        return peer;
    }

    static final class Peer implements WebSocket.Listener, AutoCloseable {
        final BlockingQueue<Object> messages = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        final WebSocket socket;
        private final java.io.ByteArrayOutputStream binary = new java.io.ByteArrayOutputStream();
        private final StringBuilder text = new StringBuilder();
        Peer(URI endpoint) throws Exception {
            socket = HttpClient.newHttpClient().newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5))
                    .buildAsync(endpoint, this).get(5, TimeUnit.SECONDS);
        }
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
            byte[] bytes = new byte[data.remaining()]; data.get(bytes); binary.writeBytes(bytes);
            if (last) { messages.add(binary.toByteArray()); binary.reset(); }
            socket.request(1); return null;
        }
        @Override public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            text.append(data); if (last) { messages.add(text.toString()); text.setLength(0); }
            socket.request(1); return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket socket, int status, String reason) {
            closed.complete(status); return null;
        }
        @Override public void onError(WebSocket socket, Throwable error) { closed.completeExceptionally(error); }
        void send(byte[] bytes) throws Exception { socket.sendBinary(ByteBuffer.wrap(bytes), true).get(5, TimeUnit.SECONDS); }
        byte[] binary() throws Exception { return assertInstanceOf(byte[].class, messages.poll(5, TimeUnit.SECONDS)); }
        void control(String type) throws Exception { assertEquals("{\"type\":\"" + type + "\"}", messages.poll(5, TimeUnit.SECONDS)); }
        @Override public void close() {
            if (!socket.isOutputClosed()) socket.sendClose(1000, "").exceptionally(error -> null).join();
        }
    }
}
