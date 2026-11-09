package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

class ContributionControllerTests {
    final UUID project = UUID.randomUUID(), team = UUID.randomUUID(), stream = UUID.randomUUID();
    final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final Instant start = Instant.parse("2026-11-01T00:00:00Z"), end = start.plusSeconds(86400);
    final DocumentAuthorization auth = mock(DocumentAuthorization.class);
    final DocumentJournal journal = mock(DocumentJournal.class);
    final FileTreeStore tree = mock(FileTreeStore.class);
    final ContributionController controller = new ContributionController(auth, journal, tree, new DocumentUpdateValidator("node", "validator/worker.mjs", new tools.jackson.databind.ObjectMapper()));
    final String path = "/api/projects/" + project + "/teams/" + team + "/workstreams/" + stream + "/contributions";
    WebTestClient client;
    String query() { return "?from=" + start + "&until=" + end; }
    DocumentId doc(String id) { return new DocumentId(project, stream, id); }
    DocumentJournal.Entry entry(int seq, UUID actor, Instant time, int inserted, int deleted, boolean imported) {
        return new DocumentJournal.Entry(seq, actor, time, new byte[]{0, 0},
                new DocumentJournal.Attribution(UUID.randomUUID(), 12, new byte[]{0, 0},
                        inserted == 0 ? List.of() : List.of(new DocumentJournal.EditRange(12, seq * 100, inserted)),
                        deleted == 0 ? List.of() : List.of(new DocumentJournal.EditRange(13, seq * 100, deleted)), imported));
    }
    @BeforeEach void setup() throws Exception {
        when(auth.authorizeContributions(any(), any())).thenReturn(Mono.just(alice));
        when(tree.documents(project, stream)).thenReturn(List.of(new FileTreeStore.Document("a", "renamed.txt", true),
                new FileTreeStore.Document("legacy", "old.txt", false), new FileTreeStore.Document("empty", "empty.txt", false)));
        when(journal.read(doc("a"))).thenReturn(List.of(
                entry(1, alice, start, 100, 0, true),
                entry(2, alice, start, 5, 0, false),
                entry(3, bob, start.plusSeconds(1), 0, 2, false),
                entry(4, bob, start.plusSeconds(2), 0, 0, false),
                entry(5, bob, end, 50, 0, false)));
        when(journal.read(doc("legacy"))).thenReturn(List.of(new DocumentJournal.Entry(1, bob, start, new byte[]{1}, null)));
        when(journal.read(doc("empty"))).thenReturn(List.of());
        var cors = new ReportingWebConfig("http://localhost:5173");
        client = WebTestClient.bindToController(controller).corsMappings(cors::addCorsMappings).configureClient().baseUrl("http://localhost").build();
    }

    @Test void countsEffectiveEffectsAndKeepsImportedLegacyAndMissingEvidenceSeparate() throws Exception {
        var report = controller.summarize(project, stream, start, end, null, null, 0);
        assertEquals(2, report.matchingChanges());
        assertEquals(1, report.filesWithoutHistory()); assertEquals(1, report.legacyFiles()); assertEquals(1, report.importedFiles());
        assertEquals(2, report.unknownRecords());
        assertEquals(new ContributionController.Member(alice, 1, 5, 0, 1), report.members().stream().filter(m -> m.actorId().equals(alice)).findFirst().orElseThrow());
        assertEquals(new ContributionController.Member(bob, 1, 0, 2, 1), report.members().stream().filter(m -> m.actorId().equals(bob)).findFirst().orElseThrow());
        assertTrue(report.changes().getFirst().deletedFile());
        assertEquals("renamed.txt", report.changes().getFirst().path());
        var filtered = controller.summarize(project, stream, start, end, bob, "a", 0);
        assertEquals(1, filtered.matchingChanges()); assertEquals(1, filtered.members().size());
        assertEquals(0, filtered.legacyFiles()); assertEquals(0, filtered.filesWithoutHistory());
        assertEquals(0, controller.summarize(project, stream, start, end, UUID.randomUUID(), null, 0).matchingChanges());
    }

    @Test void returnsTotalsForAllMatchesButBoundsEvidenceList() throws Exception {
        List<DocumentJournal.Entry> entries = new ArrayList<>();
        for (int i = 1; i <= 230; i++) entries.add(entry(i, alice, start.plusSeconds(i), 1, 0, false));
        when(journal.read(doc("a"))).thenReturn(entries);
        var report = controller.summarize(project, stream, start, end, null, "a", 0);
        assertEquals(230, report.matchingChanges()); assertEquals(230, report.members().getFirst().edits());
        assertEquals(1, report.matchingDays());
        assertEquals(230, report.dailyChanges().getFirst().inserted());
        assertEquals(230, report.dailyChanges().getFirst().edits());
        assertEquals(100, report.changes().size()); assertEquals(230, report.changes().getFirst().sequence());
        assertEquals(131, report.changes().getLast().sequence());
        var page = controller.summarize(project, stream, start, end, null, "a", 200);
        assertEquals(230, page.matchingChanges()); assertEquals(30, page.changes().size());
        assertEquals(30, page.changes().getFirst().sequence()); assertEquals(1, page.changes().getLast().sequence());
    }

    @Test void httpReportAndEvidenceAreUncachedAndReauthorizeEveryRequest() {
        client.get().uri(path + query()).header("Authorization", "Bearer token").exchange().expectStatus().isOk()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().jsonPath("$.matchingChanges").isEqualTo(2);
        client.get().uri(path + "/documents/a/changes/2").header("Authorization", "Bearer token").exchange().expectStatus().isOk()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().jsonPath("$.before").isEqualTo("AAA=")
                .jsonPath("$.actorId").isEqualTo(alice.toString());
        verify(auth, times(2)).authorizeContributions(doc("contributions"), new DocumentAuthorization.Credentials(team, "token"));
        clearInvocations(journal, tree);
        when(auth.authorizeContributions(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(4403)));
        for (String route : List.of(path + query(), path + "/documents/a/changes/2"))
            client.get().uri(route).exchange().expectStatus().isForbidden();
        verifyNoInteractions(journal, tree);
        when(auth.authorizeContributions(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(4401)));
        client.get().uri(path + query()).exchange().expectStatus().isUnauthorized();
        when(auth.authorizeContributions(any(), any())).thenReturn(Mono.error(new IllegalStateException("offline")));
        client.get().uri(path + query()).exchange().expectStatus().isEqualTo(503);
    }

    @Test void allTimeIncludesOlderEditsAndSeparatesAccountsAndUtcDays() throws Exception {
        var entries = new ArrayList<>(journal.read(doc("a")));
        entries.add(entry(6, alice, Instant.parse("2020-01-01T00:00:00Z"), 3, 0, false));
        entries.add(entry(7, bob, end.plusSeconds(1), 4, 0, false));
        when(journal.read(doc("a"))).thenReturn(entries);
        client.get().uri(path + "?allTime=true").exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.matchingChanges").isEqualTo(5).jsonPath("$.matchingDays").isEqualTo(4);
        var report = controller.summarize(project, stream, Instant.EPOCH, end.plusSeconds(2), bob, "a", 0);
        assertEquals(2, report.matchingDays());
        assertEquals(54, report.dailyChanges().getFirst().inserted());
        assertEquals("2026-11-02", report.dailyChanges().getFirst().day());
        assertTrue(report.dailyChanges().stream().allMatch(day -> day.actorId().equals(bob)));
        var unknown = controller.summarize(project, stream, start, end, bob, null, 0).unverifiedMembers();
        assertEquals(List.of(new ContributionController.UnverifiedMember(bob, 1)), unknown);
        client.get().uri(path).exchange().expectStatus().isBadRequest();
        client.get().uri(path + "?allTime=true&offset=-1").exchange().expectStatus().isBadRequest();
        when(auth.authorizeContributions(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(4403)));
        client.get().uri(path + "?allTime=true").exchange().expectStatus().isForbidden();
    }

    @Test void validatesFiltersAndRefusesUnknownOrImportedEvidence() {
        client.get().uri(path + "?from=" + end + "&until=" + start).exchange().expectStatus().isBadRequest();
        client.get().uri(path + "?from=" + start + "&until=" + start.plusSeconds(367L * 86400)).exchange().expectStatus().isBadRequest();
        client.get().uri(path + query() + "&documentId=foreign").exchange().expectStatus().isNotFound();
        for (String suffix : List.of("a/changes/1", "a/changes/4", "a/changes/999", "legacy/changes/1", "foreign/changes/2"))
            client.get().uri(path + "/documents/" + suffix).exchange().expectStatus().isNotFound();
    }

    @Test void permitsOnlyConfiguredBrowserOriginsForReportAndEvidence() {
        for (String route : List.of(path, path + "/documents/a/changes/2")) {
            client.options().uri(route).header("Origin", "http://localhost:5173")
                    .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "authorization,content-type")
                    .exchange().expectStatus().isOk().expectHeader().valueEquals("Access-Control-Allow-Origin", "http://localhost:5173");
            client.options().uri(route).header("Origin", "https://untrusted.example")
                    .header("Access-Control-Request-Method", "GET").exchange().expectStatus().isForbidden();
        }
        assertThrows(IllegalArgumentException.class, () -> new ReportingWebConfig("*"));
    }
}
