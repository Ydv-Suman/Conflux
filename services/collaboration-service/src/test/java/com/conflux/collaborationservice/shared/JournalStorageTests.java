package com.conflux.collaborationservice.shared;

import static org.junit.jupiter.api.Assertions.*;
import com.conflux.collaborationservice.document.DocumentUpdateValidator;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class JournalStorageTests {
    @TempDir Path directory;
    final ObjectMapper json = new ObjectMapper();
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "storage");
    final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", json);

    @Test void incrementalCheckpointsReconstructEveryVersionAndKeepRetryEvidenceAfterRestart() throws Exception {
        var snapshots = new ArrayList<byte[]>();
        var operations = new ArrayList<UUID>();
        var updates = new ArrayList<byte[]>();
        long a, b;
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new AttributedDocumentStore(journal, validator);
            a = store.register(document, alice, UUID.randomUUID()).writerId();
            b = store.register(document, bob, UUID.randomUUID()).writerId();
            Process process = new ProcessBuilder("node", "validator/test/storage-fixture.mjs", "105", "128", "" + a, "" + b).start();
            try (var reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    var value = json.readTree(line);
                    byte[] snapshot = Base64.getDecoder().decode(value.get("snapshot").asString());
                    byte[] update = Base64.getDecoder().decode(value.get("update").asString());
                    long writer = value.get("writer").asLong();
                    var operation = UUID.randomUUID();
                    int sequence = snapshots.size() + 1;
                    journal.appendVersioned(document, new DocumentJournal.Record(2,
                            new DocumentJournal.Entry(sequence, writer == a ? alice : bob, Instant.now(), update,
                                    new DocumentJournal.Attribution(operation, writer, snapshot,
                                            sequence == 1 ? List.of() : List.of(new DocumentJournal.EditRange(writer, value.get("clock").asLong(), value.get("length").asInt())), List.of(), sequence == 1)), null));
                    snapshots.add(snapshot); operations.add(operation); updates.add(update);
                }
            } finally { assertEquals(0, process.waitFor()); }
            var entries = journal.read(document);
            assertSame(entries, journal.read(document), "Warm reads reuse the immutable journal view");
            assertEquals(106, entries.size());
            assertNotNull(entries.getFirst().attribution().snapshot());
            assertNull(entries.get(1).attribution().snapshot());
            assertNotNull(entries.get(99).attribution().snapshot());
            assertNull(entries.get(100).attribution().snapshot());
        }
        try (var journal = new DocumentJournal(directory.toString())) {
            var entries = journal.read(document);
            for (int index : List.of(0, 1, 98, 99, 100, 105))
                assertArrayEquals(snapshots.get(index), journal.snapshot(document, entries, index, validator));
            var store = new AttributedDocumentStore(journal, validator);
            var retry = store.submit(document, bob, b, operations.get(105), updates.get(105));
            assertEquals(106, retry.sequence());
            assertEquals(106, journal.read(document).size());
            assertEquals(operations.get(105), retry.attribution().operationId());
        }
    }

    @Test void startupRefusesAnIncompleteRestore() throws Exception {
        Files.writeString(directory.resolve(".restore-in-progress"), "incomplete");
        assertThrows(java.io.IOException.class, () -> new DocumentJournal(directory.toString()));
    }

    @Test void oldSnapshotPerEditJournalsCompactAtomicallyWithoutChangingReceipts() throws Exception {
        UUID lastOperation = null;
        byte[] lastUpdate = null, lastSnapshot = null;
        try (var journal = new DocumentJournal(directory.toString())) {
            var records = new ArrayList<DocumentJournal.Record>();
            records.add(new DocumentJournal.Record(2, null, new DocumentJournal.WriterBinding(alice, UUID.randomUUID(), 10, Instant.now())));
            records.add(new DocumentJournal.Record(2, null, new DocumentJournal.WriterBinding(bob, UUID.randomUUID(), 20, Instant.now())));
            var process = new ProcessBuilder("node", "validator/test/storage-fixture.mjs", "110", "20000").start();
            try (var reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line; int sequence = 0;
                while ((line = reader.readLine()) != null) {
                    var value = json.readTree(line);
                    long writer = value.get("writer").asLong();
                    lastOperation = UUID.randomUUID(); lastUpdate = Base64.getDecoder().decode(value.get("update").asString());
                    lastSnapshot = Base64.getDecoder().decode(value.get("snapshot").asString());
                    records.add(new DocumentJournal.Record(2, new DocumentJournal.Entry(++sequence, writer == 10 ? alice : bob, Instant.now(), lastUpdate,
                            new DocumentJournal.Attribution(lastOperation, writer, lastSnapshot, sequence == 1 ? List.of() :
                                    List.of(new DocumentJournal.EditRange(writer, value.get("clock").asLong(), value.get("length").asInt())), List.of(), sequence == 1)), null));
                }
            } finally { assertEquals(0, process.waitFor()); }
            try (var output = java.nio.channels.FileChannel.open(journal.path(document), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                for (var record : records) {
                    byte[] body = json.writeValueAsBytes(record);
                    var checksum = new java.util.zip.CRC32C(); checksum.update(body, 0, body.length);
                    var frame = java.nio.ByteBuffer.allocate(body.length + 8).putInt(-body.length).put(body).putInt((int) checksum.getValue()).flip();
                    while (frame.hasRemaining()) output.write(frame);
                }
                output.force(true);
            }
            long original = Files.size(journal.path(document));
            byte[] originalBytes = Files.readAllBytes(journal.path(document));
            var faulty = org.mockito.Mockito.spy(journal);
            org.mockito.Mockito.doThrow(new java.io.IOException("simulated rename failure")).when(faulty)
                    .publishCompaction(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
            assertThrows(java.io.IOException.class, () -> new AttributedDocumentStore(faulty, validator).register(document, alice, UUID.randomUUID()));
            assertArrayEquals(originalBytes, Files.readAllBytes(journal.path(document)));
            org.mockito.Mockito.doCallRealMethod().when(faulty).publishCompaction(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
            new AttributedDocumentStore(faulty, validator).register(document, alice, UUID.randomUUID());
            assertTrue(Files.size(journal.path(document)) < original / 3);
            assertEquals(111, journal.read(document).size());
            assertNull(journal.read(document).get(1).attribution().snapshot());
        }
        try (var journal = new DocumentJournal(directory.toString())) {
            var retry = new AttributedDocumentStore(journal, validator).submit(document, alice, 10, lastOperation, lastUpdate);
            assertEquals(111, retry.sequence()); assertEquals(lastOperation, retry.attribution().operationId());
            var entries = journal.read(document);
            assertArrayEquals(lastSnapshot, journal.snapshot(document, entries, entries.size() - 1, validator));
        }
    }
}
