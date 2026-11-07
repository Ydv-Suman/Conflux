package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

class DocumentHistoryControllerTests {
    final UUID project = UUID.randomUUID(), team = UUID.randomUUID(), stream = UUID.randomUUID(), actor = UUID.randomUUID();
    final DocumentId doc = new DocumentId(project, stream, "stable-id");
    final DocumentAuthorization auth = mock(DocumentAuthorization.class);
    final DocumentJournal journal = mock(DocumentJournal.class);
    final FileTreeStore tree = mock(FileTreeStore.class);
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", new ObjectMapper());
    final String path = "/api/projects/" + project + "/teams/" + team + "/workstreams/" + stream + "/documents/stable-id/history";
    final byte[] hello = Base64.getDecoder().decode("AQEKAAQBB2NvbnRlbnQFaGVsbG8A");
    WebTestClient client;
    DocumentJournal.Entry entry(int sequence, DocumentJournal.Attribution attribution) {
        return new DocumentJournal.Entry(sequence, actor, Instant.parse("2026-11-07T00:00:00Z"), hello, attribution);
    }
    DocumentJournal.Attribution attribution(boolean imported, boolean changed) {
        return new DocumentJournal.Attribution(UUID.randomUUID(), 10, hello,
                changed ? List.of(new DocumentJournal.EditRange(10, 0, 5)) : List.of(), List.of(), imported);
    }
    @BeforeEach void setup() throws Exception {
        when(auth.authorizeHistory(any(), any())).thenReturn(Mono.just(actor));
        when(tree.documents(project, stream)).thenReturn(List.of(new FileTreeStore.Document("stable-id", "renamed.py", true)));
        when(journal.read(doc)).thenReturn(List.of(entry(1, null), entry(2, attribution(true, false)),
                entry(3, attribution(false, true)), entry(4, attribution(false, false))));
        var cors = new ReportingWebConfig("http://localhost:5173");
        client = WebTestClient.bindToController(new DocumentHistoryController(auth, journal, tree, validator))
                .corsMappings(cors::addCorsMappings).configureClient().baseUrl("http://localhost").build();
    }
    @Test void pagesByStableSequenceAndSeparatesUnknownAuthorshipWithoutAnalytics() {
        client.get().uri(path + "?limit=2").header("Authorization", "Bearer token").exchange().expectStatus().isOk()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody()
                .jsonPath("$.path").isEqualTo("renamed.py").jsonPath("$.deleted").isEqualTo(true)
                .jsonPath("$.items.length()").isEqualTo(2).jsonPath("$.items[0].sequence").isEqualTo(3)
                .jsonPath("$.items[0].kind").isEqualTo("ATTRIBUTED_EDIT").jsonPath("$.items[1].kind").isEqualTo("IMPORTED_BASELINE")
                .jsonPath("$.nextBefore").isEqualTo(2).jsonPath("$.members").doesNotExist();
        client.get().uri(path + "?before=2&limit=2").exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.items.length()").isEqualTo(1).jsonPath("$.items[0].kind").isEqualTo("LEGACY_UPDATE")
                .jsonPath("$.nextBefore").isEmpty();
        verify(auth).authorizeHistory(doc, new DocumentAuthorization.Credentials(team, "token"));
        verify(auth, never()).authorizeContributions(any(), any());
    }
    @Test void reconstructsLegacyAndAttributedDiffsFromTheImmediatePrecedingVersion() {
        client.get().uri(path + "/1").exchange().expectStatus().isOk()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody()
                .jsonPath("$.beforeSequence").isEqualTo(0).jsonPath("$.before").isEqualTo("AAA=")
                .jsonPath("$.after").isEqualTo(Base64.getEncoder().encodeToString(hello));
        for (int sequence : List.of(2, 3)) client.get().uri(path + "/" + sequence).exchange().expectStatus().isOk().expectBody()
                .jsonPath("$.beforeSequence").isEqualTo(sequence - 1)
                .jsonPath("$.before").isEqualTo(Base64.getEncoder().encodeToString(hello))
                .jsonPath("$.after").isEqualTo(Base64.getEncoder().encodeToString(hello));
    }
    @Test void comparesActualLegacyInsertAndDeleteUpdates() throws Exception {
        var process = new ProcessBuilder("node", "validator/test/journal-fixture.mjs", "10", "20").start();
        var fixture = new ObjectMapper().readTree(process.getInputStream().readAllBytes());
        assertEquals(0, process.waitFor());
        List<DocumentJournal.Entry> entries = new ArrayList<>();
        for (String name : List.of("a", "b", "deletion")) entries.add(new DocumentJournal.Entry(entries.size() + 1,
                actor, Instant.now(), Base64.getDecoder().decode(fixture.get(name).asString()), null));
        when(journal.read(doc)).thenReturn(entries);
        var response = client.get().uri(path + "/3").exchange().expectStatus().isOk()
                .expectBody(DocumentHistoryController.VersionDiff.class).returnResult().getResponseBody();
        assertNotNull(response);
        assertEquals("Alice Bob", validator.importHistory(List.of(Base64.getDecoder().decode(response.before()))).after());
        assertEquals("lice Bob", validator.importHistory(List.of(Base64.getDecoder().decode(response.after()))).after());
    }
    @Test void reauthorizesBeforeAnyStorageReadAndFailsClosed() {
        for (int code : List.of(4401, 4403, 1013)) {
            when(auth.authorizeHistory(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(code)));
            for (String route : List.of(path, path + "/1")) client.get().uri(route).exchange()
                    .expectStatus().isEqualTo(code == 4401 ? 401 : code == 4403 ? 403 : 503);
        }
        verifyNoInteractions(journal, tree);
    }
    @Test void validatesBoundsAndCatalogAndHandlesUnsupportedLegacyContent() throws Exception {
        for (String suffix : List.of("?before=0", "?limit=0", "?limit=101", "/0"))
            client.get().uri(path + suffix).exchange().expectStatus().isBadRequest();
        for (int seq : List.of(4, 999)) client.get().uri(path + "/" + seq).exchange().expectStatus().isNotFound();
        when(tree.documents(project, stream)).thenReturn(List.of());
        clearInvocations(journal);
        client.get().uri(path).exchange().expectStatus().isNotFound();
        client.get().uri(path + "/1").exchange().expectStatus().isNotFound();
        verifyNoInteractions(journal);
        when(tree.documents(project, stream)).thenReturn(List.of(new FileTreeStore.Document("stable-id", "file", false)));
        when(journal.read(doc)).thenReturn(List.of(new DocumentJournal.Entry(1, actor, Instant.now(), new byte[]{-1}, null)));
        client.get().uri(path).exchange().expectStatus().isOk();
        client.get().uri(path + "/1").exchange().expectStatus().isEqualTo(422);
    }
    @Test void limitsBrowserAccessToConfiguredOrigins() {
        for (String route : List.of(path, path + "/1")) {
            client.options().uri(route).header("Origin", "http://localhost:5173")
                    .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "authorization")
                    .exchange().expectStatus().isOk().expectHeader().valueEquals("Access-Control-Allow-Origin", "http://localhost:5173");
            client.options().uri(route).header("Origin", "https://untrusted.example")
                    .header("Access-Control-Request-Method", "GET").exchange().expectStatus().isForbidden();
        }
    }
}
