package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import com.conflux.collaborationservice.shared.WebSocketPeer;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.net.URI;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
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
class AttributedRelayIntegrationTests {
    @TempDir static Path data;
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.document-directory", () -> data.toString());
    }
    final UUID team = UUID.randomUUID(), alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final ObjectMapper json = new ObjectMapper();
    @Value("${local.server.port}") int port;
    @MockitoBean DocumentAuthorization authorization;
    @Autowired DocumentJournal journal;

    @BeforeEach void authorize() {
        when(authorization.authorize(any(), any())).thenAnswer(call -> {
            DocumentAuthorization.Credentials credentials = call.getArgument(1);
            return Mono.just(credentials.token().equals("alice") ? alice : bob);
        });
    }

    @Test void realDesktopClientsConvergeAndRecoverOfflineOperationsWithOriginalWriter() throws Exception {
        var document = document();
        Process process = new ProcessBuilder("node", "validator/test/desktop-connection.cjs", endpoint(document).toString(), team.toString())
                .redirectErrorStream(true).start();
        try {
            assertTrue(process.waitFor(45, TimeUnit.SECONDS), "Desktop integration timed out");
            String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(0, process.exitValue(), output);
            var result = json.readTree(output.trim());
            assertTrue(result.get("ok").asBoolean());
            var history = journal.read(document);
            assertEquals("UNKNOWN", history.getFirst().authorshipStatus());
            assertTrue(history.getFirst().attribution().inserted().isEmpty());
            var offline = history.stream().filter(entry -> entry.attribution().operationId().toString()
                    .equals(result.get("pendingOperation").asText())).toList();
            assertEquals(1, offline.size());
            assertEquals(alice, offline.getFirst().actorId());
            assertTrue(history.stream().anyMatch(entry -> entry.actorId().equals(bob) && entry.attribution().changed()));
            assertFalse(history.getLast().attribution().deleted().isEmpty());
        } finally { process.destroyForcibly(); }
    }

    @Test void realLegacyDesktopMigratesAndLaterOfflineRecoveryRemainsLocal() throws Exception {
        var document = document();
        Process process = new ProcessBuilder("node", "validator/test/legacy-migration.cjs", endpoint(document).toString(), team.toString())
                .redirectErrorStream(true).start();
        try {
            assertTrue(process.waitFor(30, TimeUnit.SECONDS));
            String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(0, process.exitValue(), output);
            var history = journal.read(document);
            assertEquals(3, history.size()); assertNull(history.getFirst().attribution());
            assertTrue(history.get(1).attribution().imported());
            assertEquals(java.util.List.of(77L), history.get(1).attribution().importedWriters());
            assertEquals(alice, history.getLast().actorId()); assertEquals(1, history.getLast().attribution().inserted().getFirst().length());
        } finally { process.destroyForcibly(); }
    }

    @Test void activeLegacyRoomDefersMigrationUntilCollaboratorsLeave() throws Exception {
        var document = document();
        journal.append(document, alice, new byte[]{0, 0}, 1);
        try (var old = connect(document, "alice", UUID.randomUUID()); var modern = new WebSocketPeer(endpoint(document))) {
            next(old); old.binary(); old.control("synced");
            modern.socket.sendText(json.writeValueAsString(Map.of("teamId", team, "token", "bob", "protocol", 2,
                    "registrationId", UUID.randomUUID(), "migrateLegacy", true)), true).get(5, TimeUnit.SECONDS);
            assertEquals(1, next(modern).get("version").asInt());
            modern.binary(); modern.control("synced");
            assertFalse(journal.attributed(document)); assertEquals(1, journal.read(document).size());
        }
    }

    @Test void emptySeedIsUnknownAndDuplicateReceiptsAreStableWhileForeignWriterIsDenied() throws Exception {
        var document = document();
        UUID registration = UUID.randomUUID(), operation = UUID.randomUUID();
        long writer;
        JsonNode original;
        try (var a = connect(document, "alice", registration)) {
            assertEquals(2, next(a).get("version").asInt());
            writer = next(a).get("writerId").asLong();
            a.control("initialize");
            send(a, "seed", writer, operation, "AAA=");
            a.control("synced"); original = next(a);
            assertEquals(operation.toString(), original.get("operationId").asText());
            assertEquals("UNKNOWN", journal.read(document).getFirst().authorshipStatus());
            send(a, "seed", writer, operation, "AAA=");
            assertEquals(original, next(a));
            assertEquals(1, journal.read(document).size());
            try (var b = connect(document, "bob", UUID.randomUUID())) {
                next(b); next(b); b.binary(); b.control("synced");
                send(b, "edit", writer, UUID.randomUUID(), "AAA=");
                assertEquals(4403, b.closed.get(5, TimeUnit.SECONDS));
            }
            send(a, "seed", writer, UUID.randomUUID(), "AAA=");
            assertEquals(1008, a.closed.get(5, TimeUnit.SECONDS));
        }
        try (var a = connect(document, "alice", registration)) {
            next(a); assertEquals(writer, next(a).get("writerId").asLong());
            a.binary(); a.control("synced");
            send(a, "seed", writer, operation, "AAA=");
            assertEquals(original, next(a));
        }
    }

    @Test void negotiatesLegacyHistoryWithoutClaimingItAndRejectsDowngradeOfAttributedRooms() throws Exception {
        var legacy = document();
        journal.append(legacy, alice, new byte[]{0, 0}, 1);
        try (var peer = connect(legacy, "alice", UUID.randomUUID())) {
            assertEquals(1, next(peer).get("version").asInt());
            peer.binary(); peer.control("synced");
            assertFalse(journal.attributed(legacy));
        }
        var attributed = document();
        try (var a = connect(attributed, "alice", UUID.randomUUID()); var old = new WebSocketPeer(endpoint(attributed))) {
            next(a); next(a); a.control("initialize");
            old.socket.sendText(json.writeValueAsString(Map.of("teamId", team, "token", "alice")), true).get(5, TimeUnit.SECONDS);
            assertEquals(1008, old.closed.get(5, TimeUnit.SECONDS));
        }
    }

    @Test void revocationRejectsAnAttributedEditBeforePersistence() throws Exception {
        var document = document();
        try (var a = connect(document, "alice", UUID.randomUUID())) {
            next(a); long writer = next(a).get("writerId").asLong(); a.control("initialize");
            send(a, "seed", writer, UUID.randomUUID(), "AAA="); a.control("synced"); next(a);
            doReturn(Mono.error(new DocumentAuthorization.Denied(4403))).when(authorization).authorize(any(), any());
            send(a, "edit", writer, UUID.randomUUID(), "AAA=");
            assertEquals(4403, a.closed.get(5, TimeUnit.SECONDS));
            assertEquals(1, journal.read(document).size());
        }
    }

    private DocumentId document() { return new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "main-ts"); }
    private URI endpoint(DocumentId document) {
        return URI.create("ws://localhost:" + port + "/ws/projects/" + document.projectId() + "/workstreams/"
                + document.workstreamId() + "/documents/" + document.documentId());
    }
    private WebSocketPeer connect(DocumentId document, String token, UUID registration) throws Exception {
        var peer = new WebSocketPeer(endpoint(document));
        peer.socket.sendText(json.writeValueAsString(Map.of("teamId", team, "token", token, "protocol", 2,
                "registrationId", registration, "acknowledgements", true)), true).get(5, TimeUnit.SECONDS);
        return peer;
    }
    private JsonNode next(WebSocketPeer peer) throws Exception {
        return json.readTree(assertInstanceOf(String.class, peer.messages.poll(5, TimeUnit.SECONDS)));
    }
    private void send(WebSocketPeer peer, String kind, long writer, UUID operation, String update) throws Exception {
        peer.socket.sendText(json.writeValueAsString(Map.of("type", kind, "writerId", writer, "operationId", operation, "update", update)), true).get(5, TimeUnit.SECONDS);
    }
}
