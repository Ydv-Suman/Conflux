package com.conflux.collaborationservice.shared;

import static org.junit.jupiter.api.Assertions.*;
import com.conflux.collaborationservice.document.DocumentUpdateValidator;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

/** Reproducible storage workload; real validator samples are measured separately from persistence. */
@EnabledIfSystemProperty(named = "journal.load", matches = "true")
class JournalLoadTests {
    @TempDir Path directory;
    final ObjectMapper json = new ObjectMapper();
    final DocumentUpdateValidator validator = new DocumentUpdateValidator("node", "validator/worker.mjs", json);

    @Test void measuresLongTwoWriterSessionsRecoveryAndBackups() throws Exception {
        int edits = Integer.getInteger("journal.load.edits", 1500);
        var document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "load");
        var alice = UUID.randomUUID(); var bob = UUID.randomUUID();
        var append = new ArrayList<Double>(); var validation = new ArrayList<Double>();
        Map<String, Object> report = new LinkedHashMap<>();
        DocumentJournal.Entry last = null;
        long oldBytes = 0, diskBytes;
        byte[] expected = null;
        try (var journal = new DocumentJournal(directory.resolve("data").toString())) {
            var store = new AttributedDocumentStore(journal, validator);
            long a = store.register(document, alice, UUID.randomUUID()).writerId();
            long b = store.register(document, bob, UUID.randomUUID()).writerId();
            Process process = new ProcessBuilder("node", "validator/test/storage-fixture.mjs", "" + edits, "40000", "" + a, "" + b).start();
            try (var reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line; int sequence = 0;
                while ((line = reader.readLine()) != null) {
                    var value = json.readTree(line);
                    long writer = value.get("writer").asLong();
                    byte[] update = Base64.getDecoder().decode(value.get("update").asString());
                    byte[] snapshot = Base64.getDecoder().decode(value.get("snapshot").asString());
                    var entry = new DocumentJournal.Entry(++sequence, writer == a ? alice : bob, Instant.now(), update,
                            new DocumentJournal.Attribution(UUID.randomUUID(), writer, snapshot, sequence == 1 ? List.of() :
                                    List.of(new DocumentJournal.EditRange(writer, value.get("clock").asLong(), value.get("length").asInt())), List.of(), sequence == 1));
                    long start = System.nanoTime();
                    if (sequence % 50 == 0) {
                        last = store.submit(document, entry.actorId(), writer, entry.attribution().operationId(), update);
                        validation.add(ms(start));
                        assertArrayEquals(snapshot, last.attribution().snapshot());
                    } else {
                        journal.appendVersioned(document, new DocumentJournal.Record(2, entry, null));
                        append.add(ms(start)); last = entry;
                    }
                    oldBytes += json.writeValueAsBytes(new DocumentJournal.Record(2, entry, null)).length + 8;
                    expected = snapshot;
                }
            } finally { assertEquals(0, process.waitFor()); }
            assertEquals(edits + 1, journal.read(document).size());
            diskBytes = Files.size(journal.path(document));
            assertTrue(diskBytes < oldBytes / 4, "Periodic snapshots must reduce this write-heavy workload by at least 75%");
            long backupStart = System.nanoTime();
            var backups = new JournalBackups(journal, json, directory.resolve("backups").toString(), 30, 64L * 1024 * 1024, true);
            Path archive = backups.create();
            report.put("backupAndVerifyMs", ms(backupStart));
            long restoreStart = System.nanoTime();
            var restore = new ProcessBuilder("python3", "scripts/journal-recovery.py", "restore", archive.toString(), "--target", directory.resolve("restored").toString()).redirectErrorStream(true).start();
            String output = new String(restore.getInputStream().readAllBytes());
            assertEquals(0, restore.waitFor(), output);
            report.put("restoreAndVerifyMs", ms(restoreStart));
        }
        long start = System.nanoTime();
        try (var journal = new DocumentJournal(directory.resolve("restored").toString())) {
            var entries = journal.read(document);
            report.put("coldJournalReadMs", ms(start));
            start = System.nanoTime();
            assertArrayEquals(expected, journal.snapshot(document, entries, entries.size() - 1, validator));
            report.put("coldSnapshotReconstructionMs", ms(start));
            var retry = new AttributedDocumentStore(journal, validator).submit(document, last.actorId(), last.attribution().writerId(), last.attribution().operationId(), last.update());
            assertEquals(last.sequence(), retry.sequence()); assertEquals(last.timestamp(), retry.timestamp());
            assertEquals(edits + 1, journal.read(document).size());
        }
        report.put("edits", edits); report.put("writers", 2); report.put("initialTextUnits", 40000);
        report.put("snapshotEveryEditBytes", oldBytes); report.put("incrementalJournalBytes", diskBytes);
        report.put("storageReductionPercent", 100.0 * (1.0 - (double) diskBytes / oldBytes));
        report.put("appendP50Ms", percentile(append, .5)); report.put("appendP95Ms", percentile(append, .95));
        report.put("validatedWrites", validation.size()); report.put("validationP50Ms", percentile(validation, .5)); report.put("validationP95Ms", percentile(validation, .95));
        Files.createDirectories(Path.of("target"));
        json.writerWithDefaultPrettyPrinter().writeValue(Path.of("target/journal-load-report.json").toFile(), report);
        System.out.println("Journal workload: " + json.writeValueAsString(report));
    }

    @Test void reachingRecordCapacityPreservesAllReceiptsAndOtherDocumentsRemainWritable() throws Exception {
        var doc = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "limit");
        var actor = UUID.randomUUID();
        try (var journal = new DocumentJournal(directory.toString())) {
            for (int sequence = 1; sequence <= DocumentJournal.MAX_RECORDS; sequence++) journal.append(doc, actor, new byte[]{0, 0}, sequence);
            assertThrows(java.io.IOException.class, () -> journal.append(doc, actor, new byte[]{0, 0}, DocumentJournal.MAX_RECORDS + 1));
            assertEquals(DocumentJournal.MAX_RECORDS, journal.read(doc).size());
            var other = new DocumentId(doc.projectId(), doc.workstreamId(), "other");
            assertEquals(1, journal.append(other, actor, new byte[]{0, 0}, 1).sequence());
        }
        try (var journal = new DocumentJournal(directory.toString())) { assertEquals(DocumentJournal.MAX_RECORDS, journal.read(doc).size()); }
    }

    static double ms(long start) { return (System.nanoTime() - start) / 1_000_000.0; }
    static double percentile(List<Double> values, double percentile) {
        if (values.isEmpty()) return 0;
        var sorted = values.stream().sorted().toList();
        return sorted.get(Math.min(sorted.size() - 1, (int) (sorted.size() * percentile)));
    }
}
