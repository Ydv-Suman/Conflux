package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

class DocumentHistoryControllerTests {
    final UUID project = UUID.randomUUID(), team = UUID.randomUUID(), stream = UUID.randomUUID(), actor = UUID.randomUUID(), bob = UUID.randomUUID();
    final DocumentId doc = new DocumentId(project, stream, "stable-id");
    final DocumentAuthorization auth = mock(DocumentAuthorization.class);
    final DocumentJournal journal = mock(DocumentJournal.class);
    final FileTreeStore tree = mock(FileTreeStore.class);
    final DocumentCheckpoints checkpoints = mock(DocumentCheckpoints.class);
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", new ObjectMapper());
    final String path = "/api/projects/" + project + "/teams/" + team + "/workstreams/" + stream + "/documents/stable-id/history";
    final byte[] hello = Base64.getDecoder().decode("AQEKAAQBB2NvbnRlbnQFaGVsbG8A");
    final Instant time = Instant.parse("2026-11-07T00:00:00Z");
    WebTestClient client;
    DocumentJournal.Entry entry(int sequence, UUID author, boolean imported) {
        return new DocumentJournal.Entry(sequence, author, time.plusSeconds(sequence), hello,
                new DocumentJournal.Attribution(UUID.randomUUID(), 10, hello,
                        imported ? List.of() : List.of(new DocumentJournal.EditRange(10, 0, 5)), List.of(), imported));
    }
    DocumentJournal.Checkpoint checkpoint(int number, int before, int sequence) {
        return new DocumentJournal.Checkpoint(UUID.randomUUID(), actor, time.plusSeconds(100 + number), "CLOSE", number, before, sequence, "a".repeat(64), true, null, null, null);
    }
    @BeforeEach void setup() throws Exception {
        when(auth.authorizeHistory(any(), any())).thenReturn(Mono.just(actor));
        when(auth.authorize(any(), any())).thenReturn(Mono.just(actor));
        when(tree.documents(project, stream)).thenReturn(List.of(new FileTreeStore.Document("stable-id", "renamed.py", true)));
        when(journal.read(doc)).thenReturn(List.of(entry(1, actor, true), entry(2, actor, false), entry(3, bob, false), entry(4, actor, false), entry(5, bob, false)));
        when(journal.checkpoints(doc)).thenReturn(List.of(checkpoint(1, 1, 3), checkpoint(2, 3, 4), checkpoint(3, 4, 5)));
        var cors = new ReportingWebConfig("http://localhost:5173");
        client = WebTestClient.bindToController(new DocumentHistoryController(auth, journal, tree, validator, checkpoints))
                .corsMappings(cors::addCorsMappings).configureClient().baseUrl("http://localhost").build();
    }
    @Test void onlyExplicitCheckpointsAreVisibleAndPaginationUsesVersionNumbers() {
        client.get().uri(path + "?limit=2").header("Authorization", "Bearer token").exchange().expectStatus().isOk()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody()
                .jsonPath("$.path").isEqualTo("renamed.py").jsonPath("$.deleted").isEqualTo(true)
                .jsonPath("$.items.length()").isEqualTo(2).jsonPath("$.items[0].sequence").isEqualTo(5)
                .jsonPath("$.items[0].versionNumber").isEqualTo(3).jsonPath("$.nextBefore").isEqualTo(2);
        client.get().uri(path + "?before=2").exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.items.length()").isEqualTo(1).jsonPath("$.items[0].sequence").isEqualTo(3)
                .jsonPath("$.items[0].actorIds[0]").isEqualTo(actor.toString())
                .jsonPath("$.items[0].actorIds[1]").isEqualTo(bob.toString()).jsonPath("$.nextBefore").isEmpty();
        verify(auth).authorizeHistory(doc, new DocumentAuthorization.Credentials(team, "token"));
        verify(auth, never()).authorizeContributions(any(), any());
    }
    @Test void moreTypingAndLongPausesNeverCreateOrExtendVisibleVersions() throws Exception {
        when(journal.checkpoints(doc)).thenReturn(List.of());
        client.get().uri(path).exchange().expectStatus().isOk().expectBody().jsonPath("$.items.length()").isEqualTo(0);
        var entries = new ArrayList<>(journal.read(doc)); entries.add(entry(6, bob, false));
        when(journal.read(doc)).thenReturn(entries);
        client.get().uri(path).exchange().expectStatus().isOk().expectBody().jsonPath("$.items.length()").isEqualTo(0);
        when(journal.checkpoints(doc)).thenReturn(List.of(checkpoint(1, 1, 3)));
        client.get().uri(path).exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.items.length()").isEqualTo(1).jsonPath("$.items[0].sequence").isEqualTo(3);
        entries.add(entry(7, actor, false));
        client.get().uri(path).exchange().expectStatus().isOk().expectBody().jsonPath("$.items[0].sequence").isEqualTo(3);
    }
    @Test void diffsUseOnlyPersistedVersionBoundariesAndRawUpdatesAreNotVersions() {
        client.get().uri(path + "/3?from=1").exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.beforeSequence").isEqualTo(1).jsonPath("$.version.versionNumber").isEqualTo(1)
                .jsonPath("$.before").isEqualTo(Base64.getEncoder().encodeToString(hello))
                .jsonPath("$.after").isEqualTo(Base64.getEncoder().encodeToString(hello));
        client.get().uri(path + "/2").exchange().expectStatus().isNotFound();
    }
    @Test void checkpointCreationRequiresEditAccessAndUsesAuthenticatedIdentityAndDurableRequestId() throws Exception {
        var request = UUID.randomUUID(); var anchor = UUID.randomUUID();
        when(checkpoints.create(doc, actor, request, anchor, null, null)).thenReturn(checkpoint(4, 5, 5));
        client.post().uri(path).header("Authorization", "Bearer token").bodyValue(Map.of("requestId", request, "afterOperationId", anchor))
                .exchange().expectStatus().isOk().expectHeader().valueEquals("Cache-Control", "no-store");
        verify(auth).authorize(doc, new DocumentAuthorization.Credentials(team, "token"));
        verify(checkpoints).create(doc, actor, request, anchor, null, null);
    }
    @Test void reauthorizesBeforeStorageReadsAndCheckpointWrites() {
        for (int code : List.of(4401, 4403, 1013)) {
            when(auth.authorizeHistory(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(code)));
            when(auth.authorize(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(code)));
            int status = code == 4401 ? 401 : code == 4403 ? 403 : 503;
            for (String route : List.of(path, path + "/3")) client.get().uri(route).exchange().expectStatus().isEqualTo(status);
            client.post().uri(path).bodyValue(Map.of("requestId", UUID.randomUUID())).exchange().expectStatus().isEqualTo(status);
        }
        verifyNoInteractions(journal, tree, checkpoints);
    }
    @Test void validatesBoundsAndCatalogAndPreservesUnknownAuthorship() throws Exception {
        for (String suffix : List.of("?before=0", "?limit=0", "?limit=101", "/0")) client.get().uri(path + suffix).exchange().expectStatus().isBadRequest();
        when(journal.read(doc)).thenReturn(List.of(new DocumentJournal.Entry(1, actor, time, hello, null), new DocumentJournal.Entry(2, bob, time, hello, null)));
        when(journal.checkpoints(doc)).thenReturn(List.of(checkpoint(1, 1, 2)));
        client.get().uri(path).exchange().expectStatus().isOk().expectBody().jsonPath("$.items[0].kind").isEqualTo("CHECKPOINT_UNKNOWN");
        when(tree.documents(project, stream)).thenReturn(List.of()); clearInvocations(journal);
        client.get().uri(path).exchange().expectStatus().isNotFound(); client.get().uri(path + "/2").exchange().expectStatus().isNotFound();
        verifyNoInteractions(journal);
    }
    @Test void limitsBrowserAccessToConfiguredOrigins() {
        for (String method : List.of("GET", "POST")) {
            client.options().uri(path).header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", method)
                    .header("Access-Control-Request-Headers", "authorization,content-type").exchange().expectStatus().isOk();
            client.options().uri(path).header("Origin", "https://untrusted.example").header("Access-Control-Request-Method", method)
                    .exchange().expectStatus().isForbidden();
        }
    }

    @Test @EnabledIfSystemProperty(named = "journal.load", matches = "true")
    void measuresIndexedClosedVersionsAcrossTenThousandRecoveryUpdates() throws Exception {
        var entries = new ArrayList<DocumentJournal.Entry>(); var versions = new ArrayList<DocumentJournal.Checkpoint>();
        for (int i = 1; i <= 10000; i++) {
            entries.add(entry(i, i % 2 == 0 ? actor : bob, i == 1));
            if (i % 100 == 0) versions.add(checkpoint(i / 100, i - 100, i));
        }
        when(journal.read(doc)).thenReturn(List.copyOf(entries)); when(journal.checkpoints(doc)).thenReturn(List.copyOf(versions));
        long start = System.nanoTime();
        client.get().uri(path).exchange().expectStatus().isOk().expectBody().jsonPath("$.items.length()").isEqualTo(25);
        double cold = (System.nanoTime() - start) / 1_000_000.0;
        var samples = new ArrayList<Double>();
        for (int i = 0; i < 200; i++) {
            start = System.nanoTime(); client.get().uri(path + "?before=50").exchange().expectStatus().isOk();
            samples.add((System.nanoTime() - start) / 1_000_000.0);
        }
        samples.sort(Double::compareTo);
        var report = Map.of("updates", 10000, "closedVersions", 100, "requests", 200, "coldIndexAndRequestMs", cold,
                "warmRequestP50Ms", samples.get(100), "warmRequestP95Ms", samples.get(190));
        new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(java.nio.file.Path.of("target/history-index-load-report.json").toFile(), report);
        System.out.println("Closed-version index workload: " + report);
    }
}
