package com.conflux.collaborationservice.presence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentAuthorization.PresenceMember;
import com.conflux.collaborationservice.shared.WebSocketPeer;
import java.net.URI;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
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
class TeamPresenceIntegrationTests {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @MockitoBean DocumentAuthorization authorization;
    final UUID team = UUID.randomUUID(), otherTeam = UUID.randomUUID();
    final Map<String, UUID> users = Map.of("admin", UUID.randomUUID(), "lead", UUID.randomUUID(),
            "alice", UUID.randomUUID(), "bob", UUID.randomUUID());
    final Set<String> revoked = ConcurrentHashMap.newKeySet();
    final AtomicBoolean demoted = new AtomicBoolean();

    @BeforeEach void authorize() {
        when(authorization.authorizePresence(any())).thenAnswer(call -> {
            DocumentAuthorization.Credentials credentials = call.getArgument(0);
            if (credentials.token() == null || !users.containsKey(credentials.token())) return Mono.error(new DocumentAuthorization.Denied(4401));
            if ((!credentials.teamId().equals(team) && !credentials.teamId().equals(otherTeam)) || revoked.contains(credentials.token()))
                return Mono.error(new DocumentAuthorization.Denied(4403));
            return Mono.just(new PresenceMember(users.get(credentials.token()),
                    !demoted.get() && Set.of("admin", "lead").contains(credentials.token())));
        });
    }

    @Test void countsUniquePeopleAndKeepsThemPresentUntilTheirLastWindowCloses() throws Exception {
        try (var admin = connect(team, "admin"); var alice = connect(team, "alice")) {
            var roster = snapshot(admin, 2);
            assertEquals(Set.of(users.get("admin").toString(), users.get("alice").toString()), ids(roster));
            assertFalse(snapshot(alice, 2).has("userIds"));
            try (var anotherWindow = connect(team, "alice"); var bob = connect(team, "bob")) {
                snapshot(anotherWindow, 3); snapshot(admin, 3); snapshot(bob, 3);
                alice.close(); snapshot(admin, 3);
                anotherWindow.close();
                assertEquals(Set.of(users.get("admin").toString(), users.get("bob").toString()), ids(snapshot(admin, 2)));
            }
            snapshot(admin, 1);
        }
    }

    @Test void samePersonCanBePresentInTwoTeamsWithoutMixingCountsOrRosters() throws Exception {
        try (var first = connect(team, "admin"); var second = connect(otherTeam, "admin"); var alice = connect(team, "alice")) {
            assertEquals(team.toString(), snapshot(first, 2).path("teamId").asText());
            var alone = snapshot(second, 1);
            assertEquals(otherTeam.toString(), alone.path("teamId").asText());
            assertEquals(Set.of(users.get("admin").toString()), ids(alone));
            snapshot(alice, 2);
            first.close(); snapshot(alice, 1);
            second.socket.sendText("ping", true).join();
            assertEquals(Set.of(users.get("admin").toString()), ids(snapshot(second, 1)));
        }
    }

    @Test void leadsReceiveRostersAndDemotionRemovesRosterAccessWithoutRemovingThePerson() throws Exception {
        try (var lead = connect(team, "lead"); var alice = connect(team, "alice")) {
            assertEquals(2, ids(snapshot(lead, 2)).size());
            assertFalse(snapshot(alice, 2).has("userIds"));
            demoted.set(true);
            JsonNode updated;
            do { updated = snapshot(lead, 2); } while (updated.has("userIds"));
            lead.socket.sendText("ping", true).join();
            assertFalse(snapshot(lead, 2).has("userIds"));
        }
    }

    @Test void removalAndTokenExpiryCloseTheSessionAndRemoveItsCount() throws Exception {
        try (var admin = connect(team, "admin"); var alice = connect(team, "alice")) {
            snapshot(admin, 2); snapshot(alice, 2);
            revoked.add("alice");
            assertEquals(4403, alice.closed.get(5, TimeUnit.SECONDS));
            snapshot(admin, 1);
            doReturn(Mono.error(new DocumentAuthorization.Denied(4401))).when(authorization).authorizePresence(any());
            assertEquals(4401, admin.closed.get(5, TimeUnit.SECONDS));
        }
    }

    @Test void rejectedClientsNeverReceiveTeamCountsAndIdentityOutagesFailClosed() throws Exception {
        for (var entry : Map.of("expired", 4401, "alice", 4403).entrySet()) {
            try (var rejected = connect(UUID.randomUUID(), entry.getKey())) {
                assertEquals(entry.getValue(), rejected.closed.get(5, TimeUnit.SECONDS));
                assertTrue(rejected.messages.isEmpty());
            }
        }
        doReturn(Mono.error(new IllegalStateException("Identity unavailable"))).when(authorization).authorizePresence(any());
        try (var unavailable = connect(team, "admin")) {
            assertEquals(1013, unavailable.closed.get(5, TimeUnit.SECONDS));
            assertTrue(unavailable.messages.isEmpty());
        }
    }

    @Test void silentConnectionsExpireAndHeartbeatReturnsTheCurrentSnapshot() throws Exception {
        try (var idle = connect(team, "alice")) {
            snapshot(idle, 1);
            assertEquals(1013, idle.closed.get(5, TimeUnit.SECONDS));
        }
        try (var admin = connect(team, "admin")) {
            snapshot(admin, 1);
            admin.socket.sendText("ping", true).join();
            assertEquals(Set.of(users.get("admin").toString()), ids(snapshot(admin, 1)));
        }
    }

    @Test void malformedMessagesCannotSupplyPresenceIdentityAndQueryTokensAreRejected() throws Exception {
        try (var query = new WebSocketPeer(URI.create(endpoint(team) + "?token=admin"))) {
            assertEquals(1008, query.closed.get(5, TimeUnit.SECONDS));
            assertTrue(query.messages.isEmpty());
        }
        try (var bad = new WebSocketPeer(endpoint(team))) {
            bad.socket.sendText("not-json", true).join();
            assertEquals(4401, bad.closed.get(5, TimeUnit.SECONDS));
            assertTrue(bad.messages.isEmpty());
        }
        try (var alice = connect(team, "alice")) {
            assertFalse(snapshot(alice, 1).has("userIds"));
            alice.socket.sendText("{\"userId\":\"" + users.get("admin") + "\",\"role\":\"ADMIN\"}", true).join();
            assertEquals(1008, alice.closed.get(5, TimeUnit.SECONDS));
        }
        try (var binary = new WebSocketPeer(endpoint(team))) {
            binary.send(new byte[]{1});
            assertEquals(1008, binary.closed.get(5, TimeUnit.SECONDS));
            assertTrue(binary.messages.isEmpty());
        }
    }

    private URI endpoint(UUID teamId) { return URI.create("ws://localhost:" + port + "/ws/teams/" + teamId + "/presence"); }
    private WebSocketPeer connect(UUID teamId, String token) throws Exception {
        var peer = new WebSocketPeer(endpoint(teamId));
        peer.socket.sendText(json.writeValueAsString(new TeamPresenceHandler.Hello(token)), true).join();
        return peer;
    }
    private JsonNode snapshot(WebSocketPeer peer, int count) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        do {
            Object message = peer.messages.poll(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
            assertNotNull(message, "Expected presence count " + count);
            var node = json.readTree(assertInstanceOf(String.class, message));
            assertEquals("presence", node.path("type").asText());
            if (node.path("count").asInt() == count) return node;
        } while (System.nanoTime() < deadline);
        fail("Expected presence count " + count); return null;
    }
    private Set<String> ids(JsonNode node) {
        assertTrue(node.has("userIds"));
        Set<String> result = new HashSet<>();
        node.path("userIds").forEach(id -> result.add(id.asText()));
        assertEquals(node.path("count").asInt(), result.size());
        return result;
    }
}
