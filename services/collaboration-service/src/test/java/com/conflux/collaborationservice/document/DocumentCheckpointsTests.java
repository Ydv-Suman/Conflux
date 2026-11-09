package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class DocumentCheckpointsTests {
    @TempDir Path directory;
    final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "close-version");
    final ObjectMapper json = new ObjectMapper();
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", json);
    byte[] bytes(JsonNode fixture, String name) { return Base64.getDecoder().decode(fixture.get(name).asString()); }
    JsonNode fixture(long a, long b) throws Exception {
        var process = new ProcessBuilder("node", "validator/test/journal-fixture.mjs", "" + a, "" + b).start();
        var value = json.readTree(process.getInputStream().readAllBytes());
        assertEquals(0, process.waitFor()); return value;
    }

    @Test void updatesDoNotCreateVersionsAndClosingUnchangedStateDoesNotDuplicateThemAfterRestart() throws Exception {
        var firstRequest = UUID.randomUUID(); var duplicateRequest = UUID.randomUUID();
        DocumentJournal.Checkpoint first, duplicate;
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new AttributedDocumentStore(journal, validator);
            long a = store.register(document, alice, UUID.randomUUID()).writerId(), b = store.register(document, bob, UUID.randomUUID()).writerId();
            var fixture = fixture(a, b);
            store.seed(document, alice, a, UUID.randomUUID(), bytes(fixture, "a"));
            var checkpoints = new DocumentCheckpoints(journal, validator);
            assertFalse(checkpoints.create(document, alice, UUID.randomUUID(), null, null, null).created());
            store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "mixed"));
            assertEquals(0, journal.checkpoints(document).stream().filter(DocumentJournal.Checkpoint::created).count());
            first = checkpoints.create(document, alice, firstRequest, null, null, null);
            assertTrue(first.created()); assertEquals(1, first.number()); assertEquals(1, first.beforeSequence()); assertEquals(2, first.sequence());
            duplicate = checkpoints.create(document, bob, duplicateRequest, null, null, null);
            assertFalse(duplicate.created()); assertEquals(1, duplicate.number());
            store.submit(document, alice, a, UUID.randomUUID(), bytes(fixture, "deletion"));
            assertEquals(2, checkpoints.create(document, alice, UUID.randomUUID(), null, null, null).number());
            assertFalse(checkpoints.create(document, bob, duplicateRequest, null, null, null).created());
        }
        try (var journal = new DocumentJournal(directory.toString())) {
            var checkpoints = new DocumentCheckpoints(journal, validator);
            assertEquals(first, checkpoints.create(document, alice, firstRequest, null, null, null));
            assertEquals(duplicate, checkpoints.create(document, bob, duplicateRequest, null, null, null));
            assertEquals(2, journal.checkpoints(document).stream().filter(DocumentJournal.Checkpoint::created).count());
            assertEquals(3, journal.read(document).size());
        }
    }

    @Test void twoOfflineClosesPreserveTheirOwnBoundariesEvenWhenAllUpdatesHaveAlreadySynchronized() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new AttributedDocumentStore(journal, validator);
            long a = store.register(document, alice, UUID.randomUUID()).writerId(), b = store.register(document, bob, UUID.randomUUID()).writerId();
            var fixture = fixture(a, b);
            store.seed(document, alice, a, UUID.randomUUID(), bytes(fixture, "a"));
            var mixed = store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "mixed"));
            var deletion = store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "deletion"));
            var checkpoints = new DocumentCheckpoints(journal, validator);
            var first = checkpoints.create(document, bob, UUID.randomUUID(), mixed.attribution().operationId(), null, null);
            var second = checkpoints.create(document, bob, UUID.randomUUID(), deletion.attribution().operationId(), null, null);
            assertEquals(2, first.sequence()); assertEquals(1, first.number());
            assertEquals(3, second.sequence()); assertEquals(2, second.beforeSequence()); assertEquals(2, second.number());
            assertFalse(checkpoints.create(document, bob, UUID.randomUUID(), mixed.attribution().operationId(), null, null).created());
            assertThrows(DocumentAuthorization.Denied.class, () -> checkpoints.create(document, alice, UUID.randomUUID(), mixed.attribution().operationId(), null, null));
            assertThrows(IllegalArgumentException.class, () -> checkpoints.create(document, bob, second.requestId(), null, null, null));
            assertEquals(2, journal.checkpoints(document).stream().filter(DocumentJournal.Checkpoint::created).count());
        }
    }

    @Test void aFullyAcknowledgedCloseDoesNotIncludeEditsFromTheNextOpenSession() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new AttributedDocumentStore(journal, validator);
            long a = store.register(document, alice, UUID.randomUUID()).writerId(), b = store.register(document, bob, UUID.randomUUID()).writerId();
            var fixture = fixture(a, b);
            store.seed(document, alice, a, UUID.randomUUID(), bytes(fixture, "a"));
            store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "mixed"));
            store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "deletion"));
            var checkpoints = new DocumentCheckpoints(journal, validator);
            var closed = checkpoints.create(document, bob, UUID.randomUUID(), null, null, 2);
            assertEquals(2, closed.sequence()); assertEquals(1, closed.number());
            var next = checkpoints.create(document, bob, UUID.randomUUID(), null, null, 3);
            assertEquals(2, next.beforeSequence()); assertEquals(3, next.sequence()); assertEquals(2, next.number());
        }
    }

    @Test void simultaneousCollaboratorClosesPublishOnlyOneVersion() throws Exception {
        try (var journal = new DocumentJournal(directory.toString()); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var store = new AttributedDocumentStore(journal, validator);
            long a = store.register(document, alice, UUID.randomUUID()).writerId(), b = store.register(document, bob, UUID.randomUUID()).writerId();
            var fixture = fixture(a, b);
            store.seed(document, alice, a, UUID.randomUUID(), bytes(fixture, "a"));
            store.submit(document, bob, b, UUID.randomUUID(), bytes(fixture, "mixed"));
            var checkpoints = new DocumentCheckpoints(journal, validator);
            List<Future<DocumentJournal.Checkpoint>> results = new ArrayList<>();
            for (var actor : List.of(alice, bob)) results.add(executor.submit(() -> {
                var request = UUID.randomUUID();
                try { return checkpoints.create(document, actor, request, null, null, null); }
                catch (DocumentCheckpoints.ChangedDuringCheckpoint retry) { return checkpoints.create(document, actor, request, null, null, null); }
            }));
            int created = 0;
            for (var result : results) if (result.get(10, TimeUnit.SECONDS).created()) created++;
            assertEquals(1, created);
            assertEquals(1, journal.checkpoints(document).stream().filter(DocumentJournal.Checkpoint::created).count());
        }
    }

    @Test void legacyFilesRemainEditableAfterCheckpointRecordsAndFailedCheckpointWritesHaveNoReceipt() throws Exception {
        var fixture = fixture(10, 20);
        try (var real = new DocumentJournal(directory.toString())) {
            var journal = spy(real);
            journal.append(document, alice, bytes(fixture, "a"), 1);
            journal.append(document, bob, bytes(fixture, "mixed"), 2);
            var checkpoints = new DocumentCheckpoints(journal, validator);
            var request = UUID.randomUUID();
            doThrow(new java.io.IOException("disk failure")).when(journal).appendCheckpoint(eq(document), any());
            assertThrows(java.io.IOException.class, () -> checkpoints.create(document, alice, request, null, null, null));
            assertTrue(journal.checkpoints(document).isEmpty());
            doCallRealMethod().when(journal).appendCheckpoint(eq(document), any());
            assertTrue(checkpoints.create(document, alice, request, null, null, null).created());
            assertFalse(journal.attributed(document));
            journal.append(document, bob, bytes(fixture, "deletion"), 3);
        }
        try (var journal = new DocumentJournal(directory.toString())) {
            assertEquals(3, journal.read(document).size()); assertFalse(journal.attributed(document));
            assertEquals(1, journal.checkpoints(document).size());
            new AttributedDocumentStore(journal, validator).migrateLegacy(document, alice);
            assertTrue(journal.attributed(document));
        }
    }
}
