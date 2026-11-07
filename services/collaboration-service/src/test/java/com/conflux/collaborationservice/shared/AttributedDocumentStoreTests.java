package com.conflux.collaborationservice.shared;

import com.conflux.collaborationservice.document.DocumentUpdateValidator;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class AttributedDocumentStoreTests {
    @TempDir Path directory;
    final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "main-ts");
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", new ObjectMapper());

    @Test void bindingsEditsAndOriginalReceiptsSurviveRestartWithoutTransferringAuthorship() throws Exception {
        UUID aliceRequest = UUID.randomUUID(), bobRequest = UUID.randomUUID(), operation = UUID.randomUUID();
        DocumentJournal.WriterBinding a, b;
        DocumentJournal.Entry original;
        JsonNode fixture;
        try (var journal = open()) {
            var store = store(journal);
            a = store.register(document, alice, aliceRequest);
            b = store.register(document, bob, bobRequest);
            assertNotEquals(a.writerId(), b.writerId());
            fixture = fixture(a.writerId(), b.writerId());
            original = store.submit(document, alice, a.writerId(), operation, bytes(fixture, "a"));
            assertEquals("VALIDATED_ACCOUNT_EDIT", original.authorshipStatus());
        }
        try (var journal = open()) {
            var store = store(journal);
            assertEquals(a, store.register(document, alice, aliceRequest));
            assertEquals(b, store.register(document, bob, bobRequest));
            var retry = store.submit(document, alice, a.writerId(), operation, bytes(fixture, "a"));
            assertEquals(original.timestamp(), retry.timestamp());
            assertEquals(original.sequence(), retry.sequence());
            assertArrayEquals(original.update(), retry.update());
            var mixed = store.submit(document, bob, b.writerId(), UUID.randomUUID(), bytes(fixture, "mixed"));
            assertEquals(2, mixed.sequence());
            assertEquals(bob, mixed.actorId());
            assertEquals(java.util.List.of(new DocumentJournal.EditRange(b.writerId(), 0, 4)), mixed.attribution().inserted());
            assertEquals(alice, journal.read(document).getFirst().actorId());
            var replay = store.submit(document, bob, b.writerId(), UUID.randomUUID(), bytes(fixture, "mixed"));
            assertFalse(replay.attribution().changed());
            var deletion = store.submit(document, bob, b.writerId(), UUID.randomUUID(), bytes(fixture, "deletion"));
            assertEquals(bob, deletion.actorId());
            assertEquals(a.writerId(), deletion.attribution().deleted().getFirst().clientId());
            assertFalse(store.submit(document, bob, b.writerId(), UUID.randomUUID(), bytes(fixture, "deletion")).attribution().changed());
        }
        try (var journal = open()) {
            assertEquals(5, journal.read(document).size());
            assertEquals(alice, journal.read(document).getFirst().actorId());
        }
    }

    @Test void refusesSpoofedForeignAndCrossDocumentWritersAndConflictingOperationRetries() throws Exception {
        try (var journal = open()) {
            var store = store(journal);
            var a = store.register(document, alice, UUID.randomUUID());
            var b = store.register(document, bob, UUID.randomUUID());
            var fixture = fixture(a.writerId(), b.writerId());
            var operation = UUID.randomUUID();
            assertThrows(DocumentAuthorization.Denied.class, () -> store.submit(document, bob, a.writerId(), operation, bytes(fixture, "a")));
            assertThrows(DocumentUpdateValidator.Rejected.class, () -> store.submit(document, bob, b.writerId(), operation, bytes(fixture, "a")));
            var other = new DocumentId(document.projectId(), UUID.randomUUID(), document.documentId());
            assertThrows(DocumentAuthorization.Denied.class, () -> store.submit(other, alice, a.writerId(), operation, bytes(fixture, "a")));
            assertTrue(journal.read(document).isEmpty());
            store.submit(document, alice, a.writerId(), operation, bytes(fixture, "a"));
            assertThrows(IllegalArgumentException.class, () -> store.submit(document, alice, a.writerId(), operation, bytes(fixture, "mixed")));
            var another = store.register(document, alice, UUID.randomUUID());
            assertThrows(IllegalArgumentException.class, () -> store.submit(document, alice, another.writerId(), operation, bytes(fixture, "a")));
            assertEquals(1, journal.read(document).size());
        }
    }

    @Test void legacyHistoryRemainsReadableAndUnknownButCannotBeSilentlyUpgraded() throws Exception {
        try (var journal = open()) {
            var legacy = journal.append(document, alice, new byte[]{1, 2, 3}, 1);
            assertEquals("UNKNOWN", legacy.authorshipStatus());
            byte[] original = Files.readAllBytes(journal.path(document));
            assertThrows(AttributedDocumentStore.LegacyHistory.class, () -> store(journal).register(document, alice, UUID.randomUUID()));
            assertArrayEquals(original, Files.readAllBytes(journal.path(document)));
        }
        try (var journal = open()) { assertEquals("UNKNOWN", journal.read(document).getFirst().authorshipStatus()); }
    }

    @Test void versionedDocumentsRejectLegacyWritesAndRecoverOnlyAnIncompleteTail() throws Exception {
        UUID request = UUID.randomUUID();
        DocumentJournal.WriterBinding binding;
        try (var journal = open()) {
            binding = store(journal).register(document, alice, request);
            assertThrows(IOException.class, () -> journal.append(document, alice, new byte[]{1}, 1));
            long committed = Files.size(journal.path(document));
            Files.write(journal.path(document), ByteBuffer.allocate(7).putInt(-100).put(new byte[]{1,2,3}).array(), StandardOpenOption.APPEND);
            assertEquals(binding, store(journal).register(document, alice, request));
            assertEquals(committed, Files.size(journal.path(document)));
        }
        try (var journal = open()) { assertEquals(binding, store(journal).register(document, alice, request)); }
    }

    @Test void corruptionFailsClosedWithoutTruncatingAcceptedVersionedRecords() throws Exception {
        try (var journal = open()) {
            store(journal).register(document, alice, UUID.randomUUID());
            byte[] bytes = Files.readAllBytes(journal.path(document));
            bytes[8] ^= 1;
            Files.write(journal.path(document), bytes);
            assertThrows(IOException.class, () -> store(journal).register(document, alice, UUID.randomUUID()));
            assertArrayEquals(bytes, Files.readAllBytes(journal.path(document)));
        }
    }

    @Test void bindingCannotClaimReservedFileTreeNamespaceAndReturnedBytesCannotChangeDurableState() throws Exception {
        try (var journal = open()) {
            var store = store(journal);
            var reserved = new DocumentId(document.projectId(), document.workstreamId(), "$file-tree");
            assertThrows(IllegalArgumentException.class, () -> store.register(reserved, alice, UUID.randomUUID()));
            var binding = store.register(document, alice, UUID.randomUUID());
            var fixture = fixture(binding.writerId(), binding.writerId() + 1);
            var operation = UUID.randomUUID();
            var entry = store.submit(document, alice, binding.writerId(), operation, bytes(fixture, "a"));
            entry.update()[0] = 99;
            entry.attribution().snapshot()[0] = 99;
            assertArrayEquals(bytes(fixture, "a"), store.submit(document, alice, binding.writerId(), operation, bytes(fixture, "a")).update());
            assertArrayEquals(entry.attribution().snapshot(), journal.read(document).getFirst().attribution().snapshot());
        }
    }

    @Test void failedPersistenceReturnsNoReceiptAndRetryDoesNotAdvanceTwice() throws Exception {
        try (var real = open()) {
            var journal = spy(real);
            var store = store(journal);
            var binding = store.register(document, alice, UUID.randomUUID());
            var fixture = fixture(binding.writerId(), binding.writerId() + 1);
            var operation = UUID.randomUUID();
            doThrow(new IOException("simulated disk failure")).when(journal).appendVersioned(eq(document), any());
            assertThrows(IOException.class, () -> store.submit(document, alice, binding.writerId(), operation, bytes(fixture, "a")));
            assertTrue(journal.read(document).isEmpty());
            doCallRealMethod().when(journal).appendVersioned(eq(document), any());
            assertEquals(1, store.submit(document, alice, binding.writerId(), operation, bytes(fixture, "a")).sequence());
            assertEquals(1, store.submit(document, alice, binding.writerId(), operation, bytes(fixture, "a")).sequence());
        }
    }

    @Test void concurrentValidationCannotCommitAgainstAStaleSnapshot() throws Exception {
        try (var journal = open(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = store(journal).register(document, alice, UUID.randomUUID());
            var b = store(journal).register(document, bob, UUID.randomUUID());
            var fixture = fixture(a.writerId(), b.writerId());
            var slow = mock(DocumentUpdateValidator.class);
            var entered = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            when(slow.validate(any(), any(), anyLong())).thenAnswer(call -> {
                entered.countDown();
                assertTrue(release.await(5, TimeUnit.SECONDS));
                return validator.validate(call.getArgument(0), call.getArgument(1), call.getArgument(2));
            });
            var operation = UUID.randomUUID();
            var pending = executor.submit(() -> new AttributedDocumentStore(journal, slow)
                    .submit(document, alice, a.writerId(), operation, bytes(fixture, "a")));
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                store(journal).submit(document, alice, a.writerId(), UUID.randomUUID(), bytes(fixture, "a"));
            } finally { release.countDown(); }
            var failure = assertThrows(java.util.concurrent.ExecutionException.class, () -> pending.get(5, TimeUnit.SECONDS));
            assertInstanceOf(AttributedDocumentStore.StaleVersion.class, failure.getCause());
            assertEquals(1, journal.read(document).size());
            assertFalse(store(journal).submit(document, alice, a.writerId(), operation, bytes(fixture, "a")).attribution().changed());
        }
    }

    @Test void migrationPreservesLegacyBytesAndCreditsOnlyNewBoundEditsAcrossRestart() throws Exception {
        var fixture = fixture(10, 20);
        byte[] original;
        DocumentJournal.Entry baseline;
        try (var journal = open()) {
            journal.append(document, alice, bytes(fixture, "a"), 1);
            journal.append(document, bob, bytes(fixture, "mixed"), 2);
            original = Files.readAllBytes(journal.path(document));
            baseline = store(journal).migrateLegacy(document, alice);
            assertEquals(3, baseline.sequence()); assertEquals("UNKNOWN", baseline.authorshipStatus());
            assertFalse(baseline.attribution().changed());
            assertEquals(java.util.Set.of(10L, 20L), new java.util.HashSet<>(baseline.attribution().importedWriters()));
            assertArrayEquals(original, java.util.Arrays.copyOf(Files.readAllBytes(journal.path(document)), original.length));
            assertThrows(IOException.class, () -> journal.append(document, bob, bytes(fixture, "deletion"), 4));
        }
        try (var journal = open()) {
            assertEquals(baseline.attribution().operationId(), store(journal).migrateLegacy(document, bob).attribution().operationId());
            var writer = store(journal).register(document, bob, UUID.randomUUID());
            assertFalse(baseline.attribution().importedWriters().contains(writer.writerId()));
            var deleted = store(journal).submit(document, bob, writer.writerId(), UUID.randomUUID(), bytes(fixture, "deletion"));
            assertEquals(4, deleted.sequence()); assertEquals("VALIDATED_ACCOUNT_EDIT", deleted.authorshipStatus());
            assertEquals(bob, deleted.actorId()); assertEquals(1, deleted.attribution().deleted().getFirst().length());
            assertEquals(4, journal.read(document).size());
            assertNull(journal.read(document).getFirst().attribution());
        }
    }

    @Test void invalidLegacyImportLeavesOriginalJournalEditableAndUnchanged() throws Exception {
        try (var journal = open()) {
            journal.append(document, alice, new byte[]{(byte)255}, 1);
            byte[] original = Files.readAllBytes(journal.path(document));
            assertThrows(DocumentUpdateValidator.Rejected.class, () -> store(journal).migrateLegacy(document, alice));
            assertArrayEquals(original, Files.readAllBytes(journal.path(document)));
            assertFalse(journal.attributed(document));
            journal.append(document, alice, new byte[]{0, 0}, 2);
        }
    }

    private DocumentJournal open() throws IOException { return new DocumentJournal(directory.toString()); }
    private AttributedDocumentStore store(DocumentJournal journal) { return new AttributedDocumentStore(journal, validator); }
    private static byte[] bytes(JsonNode fixture, String name) { return Base64.getDecoder().decode(fixture.get(name).asText()); }
    private static JsonNode fixture(long aliceWriter, long bobWriter) throws Exception {
        Process process = new ProcessBuilder("node", "validator/test/journal-fixture.mjs", Long.toString(aliceWriter), Long.toString(bobWriter)).start();
        try {
            assertTrue(process.waitFor(5, TimeUnit.SECONDS));
            assertEquals(0, process.exitValue());
            return new ObjectMapper().readTree(process.getInputStream().readAllBytes());
        } finally { process.destroyForcibly(); }
    }
}
