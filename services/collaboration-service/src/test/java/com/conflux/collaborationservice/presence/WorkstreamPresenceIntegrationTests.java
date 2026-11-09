package com.conflux.collaborationservice.presence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import com.conflux.collaborationservice.shared.*;
import java.net.URI;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import reactor.core.publisher.Mono;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.presence-idle-timeout=3s", "app.presence-authorization-interval=100ms"
})
class WorkstreamPresenceIntegrationTests {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @MockitoBean DocumentAuthorization authorization;
    @Autowired DocumentJournal journal;
    final UUID project = UUID.randomUUID(), stream = UUID.randomUUID(), team = UUID.randomUUID();
    final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final Set<String> revoked = ConcurrentHashMap.newKeySet();

    @BeforeEach void authorize() {
        when(authorization.authorize(any(), any())).thenAnswer(call -> {
            DocumentId document = call.getArgument(0);
            DocumentAuthorization.Credentials credentials = call.getArgument(1);
            if (!Set.of("alice", "bob").contains(credentials.token())) return Mono.error(new DocumentAuthorization.Denied(4401));
            if (!project.equals(document.projectId()) || !team.equals(credentials.teamId()) || revoked.contains(credentials.token()))
                return Mono.error(new DocumentAuthorization.Denied(4403));
            return Mono.just(credentials.token().equals("alice") ? alice : bob);
        });
    }
    @Test void sharesAuthenticatedActiveFilesAndCursorsWithoutWritingDocumentHistory() throws Exception {
        try (var a = connect(stream, team, "alice"); var b = connect(stream, team, "bob")) {
            snapshot(a, 0); snapshot(b, 0);
            update(a, "file-one", "AA==", "AQ==");
            var first = snapshot(b, 1).path("participants").get(0);
            assertEquals(alice.toString(), first.path("userId").asText());
            assertEquals("AA==", first.path("anchor").asText());
            update(b, "file-two", null, null); snapshot(a, 2); snapshot(b, 2);
            update(a, "stable-id", "AQ==", "Ag==");
            assertEquals("stable-id", snapshot(b, 2).path("participants").get(0).path("documentId").asText());
            update(a, null, null, null);
            assertEquals(bob.toString(), snapshot(b, 1).path("participants").get(0).path("userId").asText());
            assertTrue(journal.read(new DocumentId(project, stream, "file-one")).isEmpty());
            assertTrue(journal.checkpoints(new DocumentId(project, stream, "file-one")).isEmpty());
        }
    }
    @Test void isolatesWorkstreamsAndRemovesClosedOrRevokedSessions() throws Exception {
        try (var a = connect(stream, team, "alice"); var b = connect(stream, team, "bob"); var other = connect(UUID.randomUUID(), team, "alice")) {
            snapshot(a, 0); snapshot(b, 0); snapshot(other, 0);
            update(a, "file", null, null); snapshot(b, 1);
            update(other, "other", null, null);
            assertEquals("other", snapshot(other, 1).path("participants").get(0).path("documentId").asText());
            update(b, "file", null, null); snapshot(a, 2);
            b.close(); snapshot(a, 1);
            revoked.add("alice"); assertEquals(4403, a.closed.get(5, TimeUnit.SECONDS));
        }
    }
    @Test void rejectsInvalidScopesCredentialsAndQueryTokensBeforeSendingState() throws Exception {
        for (var entry : Map.of("expired", 4401, "alice", 4403).entrySet()) {
            try (var rejected = connect(stream, UUID.randomUUID(), entry.getKey())) {
                assertEquals(entry.getValue(), rejected.closed.get(5, TimeUnit.SECONDS)); assertTrue(rejected.messages.isEmpty());
            }
        }
        try (var query = new WebSocketPeer(URI.create(endpoint(stream) + "?token=alice"))) {
            assertEquals(1008, query.closed.get(5, TimeUnit.SECONDS)); assertTrue(query.messages.isEmpty());
        }
    }
    @Test void rejectsMalformedCursorFrames() throws Exception {
        for (String invalid : List.of("not-json", "{\"type\":\"presence\",\"documentId\":\"file\",\"anchor\":\"AA==\"}",
                "{\"type\":\"presence\",\"documentId\":\"../file\"}",
                "{\"type\":\"presence\",\"documentId\":\"file\",\"anchor\":\"bad\",\"head\":\"bad\"}")) {
            try (var a = connect(stream, team, "alice")) {
                snapshot(a, 0); a.socket.sendText(invalid, true).join(); assertEquals(1008, a.closed.get(5, TimeUnit.SECONDS));
            }
        }
    }
    @Test void heartbeatsReturnLatestStateAndSilentClientsExpire() throws Exception {
        try (var a = connect(stream, team, "alice")) {
            snapshot(a, 0); update(a, "file", null, null);
            var first = snapshot(a, 1); update(a, "file", null, null);
            assertEquals(first, snapshot(a, 1));
            assertEquals(1013, a.closed.get(5, TimeUnit.SECONDS));
        }
    }
    private URI endpoint(UUID workstream) { return URI.create("ws://localhost:" + port + "/ws/projects/" + project + "/workstreams/" + workstream + "/presence"); }
    private WebSocketPeer connect(UUID workstream, UUID teamId, String token) throws Exception {
        var peer = new WebSocketPeer(endpoint(workstream));
        peer.socket.sendText(json.writeValueAsString(Map.of("teamId", teamId, "token", token)), true).join(); return peer;
    }
    private void update(WebSocketPeer peer, String document, String anchor, String head) {
        Map<String, Object> value = new HashMap<>(); value.put("type", "presence"); value.put("documentId", document); value.put("anchor", anchor); value.put("head", head);
        peer.socket.sendText(json.writeValueAsString(value), true).join();
    }
    private JsonNode snapshot(WebSocketPeer peer, int count) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        do {
            var message = peer.messages.poll(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            assertNotNull(message, "Expected " + count + " active file participants");
            var node = json.readTree(assertInstanceOf(String.class, message));
            assertEquals("workstream-presence", node.path("type").asText());
            if (node.path("participants").size() == count) return node;
        } while (System.nanoTime() < deadline);
        fail("Presence snapshot missing"); return null;
    }
}
