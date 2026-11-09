package com.conflux.collaborationservice.shared;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.zip.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class JournalBackupsTests {
    @TempDir Path directory;
    final ObjectMapper json = new ObjectMapper();
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "main");
    final UUID actor = UUID.randomUUID();

    @Test void verifiesBackupsRestoresOnlyIntoANewDirectoryAndRetainsOriginalData() throws Exception {
        Path data = directory.resolve("data"), archives = directory.resolve("backups"), restored = directory.resolve("restored");
        Path archive;
        byte[] original;
        try (var journal = new DocumentJournal(data.toString())) {
            journal.append(document, actor, new byte[]{0, 0}, 1);
            original = Files.readAllBytes(journal.path(document));
            var backups = new JournalBackups(journal, json, archives.toString(), 30, 1024 * 1024, true);
            archive = backups.create(); backups.verify(archive);
            assertEquals(1, journal.read(document).size());
            var busy = new ProcessBuilder("python3", "scripts/journal-recovery.py", "backup", data.toString(), "--target", archives.toString()).redirectErrorStream(true).start();
            busy.getInputStream().readAllBytes();
            assertNotEquals(0, busy.waitFor(), "Offline backup must refuse a data directory locked by the service");
        }
        var offline = new ProcessBuilder("python3", "scripts/journal-recovery.py", "backup", data.toString(), "--target", archives.toString()).redirectErrorStream(true).start();
        String offlineOutput = new String(offline.getInputStream().readAllBytes());
        assertEquals(0, offline.waitFor(), offlineOutput);
        var process = new ProcessBuilder("python3", "scripts/journal-recovery.py", "restore", archive.toString(), "--target", restored.toString()).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes());
        assertEquals(0, process.waitFor(), output);
        try (var journal = new DocumentJournal(restored.toString())) {
            assertArrayEquals(original, Files.readAllBytes(journal.path(document)));
            assertEquals(1, journal.read(document).size());
        }
        var overwrite = new ProcessBuilder("python3", "scripts/journal-recovery.py", "restore", archive.toString(), "--target", data.toString()).redirectErrorStream(true).start();
        overwrite.getInputStream().readAllBytes();
        assertNotEquals(0, overwrite.waitFor());
    }

    @Test void corruptHistoryCannotPublishABackupAndRotationNeverDeletesLiveJournals() throws Exception {
        Path data = directory.resolve("data"), archives = directory.resolve("backups");
        try (var journal = new DocumentJournal(data.toString())) {
            journal.append(document, actor, new byte[]{0, 0}, 1);
            var backups = new JournalBackups(journal, json, archives.toString(), 30, 1024 * 1024, true);
            Path old = archives.resolve("conflux-1-" + UUID.randomUUID() + ".zip");
            backups.create();
            try (var zip = new ZipOutputStream(Files.newOutputStream(old))) {
                zip.putNextEntry(new ZipEntry("manifest.json"));
                zip.write(json.writeValueAsBytes(new JournalBackups.Manifest(1, Instant.now().minusSeconds(40L * 86400), List.of())));
                zip.closeEntry();
            }
            Path current = backups.create();
            assertFalse(Files.exists(old)); assertTrue(Files.exists(current));
            assertEquals(1, journal.read(document).size());
            byte[] bytes = Files.readAllBytes(journal.path(document)); bytes[5] ^= 1;
            Files.write(journal.path(document), bytes);
            assertThrows(Exception.class, backups::create);
            backups.verify(current);
            try (var paths = Files.list(archives)) { assertTrue(paths.noneMatch(path -> path.toString().endsWith(".partial"))); }
        }
    }

    @Test void restoreRejectsZipTraversalAndChecksumChangesBeforeCreatingTheDestination() throws Exception {
        Path archive = directory.resolve("malicious.zip"), restored = directory.resolve("restored");
        try (var zip = new ZipOutputStream(Files.newOutputStream(archive))) {
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(json.writeValueAsBytes(new JournalBackups.Manifest(1, Instant.now(), List.of(new JournalBackups.FileInfo("../escape", 0, "0".repeat(64))))));
            zip.closeEntry(); zip.putNextEntry(new ZipEntry("../escape")); zip.closeEntry();
        }
        var process = new ProcessBuilder("python3", "scripts/journal-recovery.py", "restore", archive.toString(), "--target", restored.toString()).redirectErrorStream(true).start();
        process.getInputStream().readAllBytes(); assertNotEquals(0, process.waitFor());
        assertFalse(Files.exists(restored)); assertFalse(Files.exists(directory.resolve("escape")));
    }
}
