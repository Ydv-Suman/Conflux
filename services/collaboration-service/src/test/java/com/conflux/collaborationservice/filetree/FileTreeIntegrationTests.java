package com.conflux.collaborationservice.filetree;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import com.conflux.collaborationservice.shared.WebSocketPeer;
import static com.conflux.collaborationservice.filetree.FileTreeStore.*;
import static com.conflux.collaborationservice.filetree.FileTreeStoreTests.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doReturn;

import java.net.URI;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FileTreeIntegrationTests {
    @TempDir static Path data;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.document-directory", () -> data.toString());
    }
    @Value("${local.server.port}") int port;
    @MockitoBean DocumentAuthorization authorization;
    @Autowired FileTreeStore store;
    @Autowired ObjectMapper json;
    final UUID project = UUID.randomUUID(), team = UUID.randomUUID(), alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final AtomicBoolean revoked = new AtomicBoolean();

    @BeforeEach void authorize() {
        revoked.set(false);
        when(authorization.authorize(any(), any())).thenAnswer(call -> {
            DocumentId key = call.getArgument(0);
            DocumentAuthorization.Credentials credentials = call.getArgument(1);
            if (credentials.token() == null || credentials.token().equals("expired")) return Mono.error(new DocumentAuthorization.Denied(4401));
            if (!key.projectId().equals(project) || !team.equals(credentials.teamId()) || revoked.get()
                    || credentials.token().equals("denied")) return Mono.error(new DocumentAuthorization.Denied(4403));
            return Mono.just(credentials.token().equals("alice") ? alice : bob);
        });
    }

    @Test void broadcastsAddsRenamesAndDeletesInOrderAndReplaysMissedChanges() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var a = connect(key, "alice", 0); var b = connect(key, "bob", 0)) {
            synced(a, 0); synced(b, 0);
            Command init = initialize(entry("README.md", Kind.FILE));
            send(a, init); event(a, 1); event(b, 1);
            Entry directory = entry("src", Kind.DIRECTORY), file = entry("src/Main.java", Kind.FILE);
            send(a, create(1, directory, null)); event(a, 2); event(b, 2);
            Command create = create(2, file, "class Main {}\n");
            send(b, create);
            JsonNode received = event(a, 3); event(b, 3);
            assertEquals(bob.toString(), received.path("actorId").asText());
            assertEquals("class Main {}\n", received.path("command").path("content").asText());
            send(b, create); event(b, 3);
            assertNull(a.messages.poll(150, TimeUnit.MILLISECONDS));
            send(a, rename(3, "src/Main.java", "src/App.java")); event(a, 4); event(b, 4);
            send(a, rename(4, "src", "source")); event(a, 5); event(b, 5);
            assertEquals(file.id(), store.load(key).entries.get("source/App.java").id());
            b.close();
            send(a, delete(5, "source")); event(a, 6);
            try (var reconnected = connect(key, "bob", 4)) {
                event(reconnected, 5); event(reconnected, 6); synced(reconnected, 6);
            }
        }
        try (var fresh = connect(key, "alice", 0)) {
            for (int version = 1; version <= 6; version++) event(fresh, version);
            synced(fresh, 6);
        }
        assertEquals(1, store.load(key).entries.size());
    }

    @Test void simultaneousChangesHaveOneWinnerAndExplicitConflictWithoutOverwriting() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var a = connect(key, "alice", 0); var b = connect(key, "bob", 0)) {
            synced(a, 0); synced(b, 0);
            send(a, initialize(entry("a.txt", Kind.FILE))); event(a, 1); event(b, 1);
            CompletableFuture.allOf(
                    a.socket.sendText(json.writeValueAsString(rename(1, "a.txt", "b.txt")), true),
                    b.socket.sendText(json.writeValueAsString(delete(1, "a.txt")), true)).get(5, TimeUnit.SECONDS);
            event(a, 2); event(b, 2);
            Object first = a.messages.poll(200, TimeUnit.MILLISECONDS);
            Object conflict = first == null ? b.messages.poll(5, TimeUnit.SECONDS) : first;
            assertEquals("conflict", json.readTree((String) conflict).path("type").asText());
            assertEquals(2, store.load(key).version());
        }
    }

    @Test void authenticationAndExactScopeAreRequiredBeforeReplayAndBeforeEveryMutation() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var a = connect(key, "alice", 0)) {
            synced(a, 0); send(a, initialize()); event(a, 1);
            for (String token : new String[]{"denied", "expired"}) {
                try (var rejected = connect(key, token, 0)) {
                    assertEquals(token.equals("expired") ? 4401 : 4403, rejected.closed.get(5, TimeUnit.SECONDS));
                    assertTrue(rejected.messages.isEmpty());
                }
            }
            try (var otherProject = connect(key(UUID.randomUUID(), key.workstreamId()), "alice", 0)) {
                assertEquals(4403, otherProject.closed.get(5, TimeUnit.SECONDS));
                assertTrue(otherProject.messages.isEmpty());
            }
            revoked.set(true);
            send(a, create(1, entry("Main.java", Kind.FILE), ""));
            assertEquals(4403, a.closed.get(5, TimeUnit.SECONDS));
            assertEquals(1, store.load(key).version());
        }
    }

    @Test void idleConnectionsLoseAccessAndWorkstreamsDoNotShareEvents() throws Exception {
        DocumentId first = key(project, UUID.randomUUID()), second = key(project, UUID.randomUUID());
        try (var a = connect(first, "alice", 0); var b = connect(second, "bob", 0)) {
            synced(a, 0); synced(b, 0);
            send(a, initialize()); event(a, 1);
            assertNull(b.messages.poll(150, TimeUnit.MILLISECONDS));
            assertEquals(0, store.load(second).version());
            revoked.set(true);
            assertEquals(4403, a.closed.get(9, TimeUnit.SECONDS));
            assertEquals(4403, b.closed.get(9, TimeUnit.SECONDS));
        }
    }

    @Test void invalidPathsCursorsBinaryMessagesAndQueryTokensCannotWriteHistory() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var a = connect(key, "alice", 0)) {
            synced(a, 0); send(a, initialize()); event(a, 1);
            send(a, create(1, entry("../escape", Kind.FILE), ""));
            assertEquals(1008, a.closed.get(5, TimeUnit.SECONDS));
        }
        try (var ahead = connect(key, "alice", 100)) {
            assertEquals(1008, ahead.closed.get(5, TimeUnit.SECONDS));
            assertTrue(ahead.messages.isEmpty());
        }
        try (var binary = connect(key, "alice", 1)) {
            synced(binary, 1); binary.send(new byte[]{1});
            assertEquals(1008, binary.closed.get(5, TimeUnit.SECONDS));
        }
        try (var query = new WebSocketPeer(URI.create(endpoint(key) + "?token=secret"))) {
            assertEquals(1008, query.closed.get(5, TimeUnit.SECONDS));
        }
        assertEquals(1, store.load(key).version());
    }

    @Test void wrongTeamsAndUnavailableAuthorizationNeverReceiveHistory() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var owner = connect(key, "alice", 0)) {
            synced(owner, 0); send(owner, initialize(entry("private.txt", Kind.FILE))); event(owner, 1);
            try (var wrongTeam = new WebSocketPeer(endpoint(key))) {
                wrongTeam.socket.sendText(json.writeValueAsString(new FileTreeHandler.Hello(UUID.randomUUID(), "alice", 0)), true).join();
                assertEquals(4403, wrongTeam.closed.get(5, TimeUnit.SECONDS));
                assertTrue(wrongTeam.messages.isEmpty());
            }
            doReturn(Mono.error(new java.io.IOException("offline"))).when(authorization).authorize(any(), any());
            try (var unavailable = connect(key, "alice", 0)) {
                assertEquals(1013, unavailable.closed.get(5, TimeUnit.SECONDS));
                assertTrue(unavailable.messages.isEmpty());
            }
        }
    }

    @Test void oversizedFramesAndBinaryAuthenticationCannotPersistOperations() throws Exception {
        DocumentId key = key(project, UUID.randomUUID());
        try (var unauthenticated = new WebSocketPeer(endpoint(key))) {
            unauthenticated.send(new byte[]{1});
            assertEquals(4401, unauthenticated.closed.get(5, TimeUnit.SECONDS));
        }
        try (var peer = connect(key, "alice", 0)) {
            synced(peer, 0);
            peer.socket.sendText("x".repeat(DocumentJournal.MAX_UPDATE + 1), true).exceptionally(error -> null).join();
            assertEquals(1009, peer.closed.get(5, TimeUnit.SECONDS));
        }
        assertEquals(0, store.load(key).version());
    }

    private URI endpoint(DocumentId key) {
        return URI.create("ws://localhost:" + port + "/ws/projects/" + key.projectId() + "/workstreams/" + key.workstreamId() + "/files");
    }
    private WebSocketPeer connect(DocumentId key, String token, int after) throws Exception {
        var peer = new WebSocketPeer(endpoint(key));
        peer.socket.sendText(json.writeValueAsString(new FileTreeHandler.Hello(team, token, after)), true).get(5, TimeUnit.SECONDS);
        return peer;
    }
    private void send(WebSocketPeer peer, Command command) throws Exception {
        peer.socket.sendText(json.writeValueAsString(command), true).get(5, TimeUnit.SECONDS);
    }
    private JsonNode message(WebSocketPeer peer) throws Exception {
        return json.readTree(assertInstanceOf(String.class, peer.messages.poll(5, TimeUnit.SECONDS)));
    }
    private JsonNode event(WebSocketPeer peer, int version) throws Exception {
        JsonNode message = message(peer);
        assertEquals("event", message.path("type").asText());
        assertEquals(version, message.path("version").asInt());
        return message;
    }
    private void synced(WebSocketPeer peer, int version) throws Exception {
        JsonNode message = message(peer);
        assertEquals("synced", message.path("type").asText());
        assertEquals(version, message.path("version").asInt());
        assertEquals(version > 0, message.path("initialized").asBoolean());
    }
}
