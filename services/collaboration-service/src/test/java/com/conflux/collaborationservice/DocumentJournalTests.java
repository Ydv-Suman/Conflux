package com.conflux.collaborationservice;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DocumentJournalTests {
    @TempDir Path directory;
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "main-ts");
    final UUID actor = UUID.randomUUID();

    @Test void restoresUpdatesAndAttributionAfterRestart() throws Exception {
        try (var journal = open()) { journal.append(document, actor, new byte[]{1, 2, 3}, 1); }
        try (var restarted = open()) {
            var entry = restarted.read(document).getFirst();
            assertEquals(1, entry.sequence());
            assertEquals(actor, entry.actorId());
            assertNotNull(entry.timestamp());
            assertArrayEquals(new byte[]{1, 2, 3}, entry.update());
        }
    }

    @Test void truncatesOnlyAnIncompleteFinalRecordBeforeAppending() throws Exception {
        try (var journal = open()) {
            journal.append(document, actor, new byte[]{1}, 1);
            long validSize = Files.size(journal.path(document));
            Files.write(journal.path(document), ByteBuffer.allocate(7).putInt(30).put(new byte[]{1,2,3}).array(), StandardOpenOption.APPEND);
            assertEquals(1, journal.read(document).size());
            assertEquals(validSize, Files.size(journal.path(document)));
            journal.append(document, actor, new byte[]{2}, 2);
            assertEquals(2, journal.read(document).size());
        }
    }

    @Test void refusesCorruptHistoryRatherThanSilentlyLosingEdits() throws Exception {
        try (var journal = open()) {
            journal.append(document, actor, new byte[]{1, 2}, 1);
            byte[] bytes = Files.readAllBytes(journal.path(document)); bytes[28] ^= 1;
            Files.write(journal.path(document), bytes);
            assertThrows(IOException.class, () -> journal.read(document));
        }
    }

    @Test void rejectsOversizedEmptyAndExcessiveUpdatesWithoutWritingThem() throws Exception {
        try (var journal = open()) {
            assertThrows(IOException.class, () -> journal.append(document, actor, new byte[0], 1));
            assertThrows(IOException.class, () -> journal.append(document, actor, new byte[DocumentJournal.MAX_UPDATE + 1], 1));
            assertThrows(IOException.class, () -> journal.append(document, actor, new byte[]{1}, DocumentJournal.MAX_RECORDS + 1));
            assertFalse(Files.exists(journal.path(document)));
        }
    }

    @Test void refusesTwoWritersForTheSameDirectory() throws Exception {
        try (var journal = open()) {
            assertThrows(java.nio.channels.OverlappingFileLockException.class, this::open);
            assertTrue(journal.read(document).isEmpty());
        }
    }

    private DocumentJournal open() throws IOException { return new DocumentJournal(directory.toString()); }
}
