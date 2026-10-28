package com.conflux.collaborationservice.filetree;

import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import static com.conflux.collaborationservice.filetree.FileTreeStore.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.nio.file.Path;
import java.util.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class FileTreeStoreTests {
    @TempDir Path directory;
    final ObjectMapper json = new ObjectMapper();
    final UUID actor = UUID.randomUUID();
    final DocumentId key = key(UUID.randomUUID(), UUID.randomUUID());

    static Entry entry(String path, Kind kind) { return new Entry(UUID.randomUUID().toString(), path, kind); }
    static Command initialize(Entry... entries) {
        return new Command(UUID.randomUUID(), 0, Type.INITIALIZE, null, null, null, null, List.of(entries));
    }
    static Command create(int version, Entry entry, String content) {
        return new Command(UUID.randomUUID(), version, Type.CREATE, entry, null, null, content, null);
    }
    static Command rename(int version, String from, String to) {
        return new Command(UUID.randomUUID(), version, Type.RENAME, null, from, to, null, null);
    }
    static Command delete(int version, String path) {
        return new Command(UUID.randomUUID(), version, Type.DELETE, null, path, null, null, null);
    }

    @Test void createRenameAndRecursiveDeleteSurviveRestartAndKeepFileIdentity() throws Exception {
        Entry src = entry("src", Kind.DIRECTORY), main = entry("src/Main.java", Kind.FILE);
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            store.append(state, actor, initialize());
            store.append(state, actor, create(1, src, null));
            store.append(state, actor, create(2, main, "class Main {}\n"));
            store.append(state, actor, rename(3, "src/Main.java", "src/App.java"));
            assertEquals(main.id(), state.entries.get("src/App.java").id());
            store.append(state, actor, rename(4, "src", "source"));
            assertEquals(main.id(), state.entries.get("source/App.java").id());
            var event = store.append(state, actor, delete(5, "source"));
            assertTrue(state.entries.isEmpty());
            assertEquals(actor, event.actorId());
            assertNotNull(event.timestamp());
            assertEquals(6, event.version());
        }
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            assertTrue(state.entries.isEmpty());
            assertEquals(6, state.version());
            assertEquals("class Main {}\n", state.operations.values().stream()
                    .filter(event -> event.version() == 3).findFirst().orElseThrow().command().content());
            // Reusing a deleted ID would reconnect a new file to the old file's document history.
            assertThrows(Conflict.class, () -> store.append(state, actor, create(6, src, null)));
            store.append(state, actor, create(6, entry("src", Kind.DIRECTORY), null));
        }
    }

    @Test void initializationIncludesExistingGitFilesAndCanOnlyHappenOnce() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            assertThrows(Conflict.class, () -> store.append(state, actor, create(0, entry("a", Kind.FILE), "")));
            store.append(state, actor, initialize(entry("src/Main.java", Kind.FILE), entry("src", Kind.DIRECTORY)));
            assertEquals(2, state.entries.size());
            assertThrows(Conflict.class, () -> store.append(state, actor, initialize()));
        }
    }

    @Test void retriesAreIdempotentEvenAfterRestartButCannotReuseAnotherActorsOperation() throws Exception {
        Command command = initialize(entry("README.md", Kind.FILE));
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            var accepted = store.append(state, actor, command);
            assertEquals(accepted, store.append(state, actor, command));
            var reloaded = store.load(key);
            assertEquals(accepted, store.append(reloaded, actor, command));
            assertThrows(Conflict.class, () -> store.append(reloaded, UUID.randomUUID(), command));
            var altered = new Command(command.operationId(), 0, Type.INITIALIZE, null, null, null, null, List.of());
            assertThrows(Conflict.class, () -> store.append(reloaded, actor, altered));
            assertEquals(1, journal.read(key).size());
        }
    }

    @Test void staleOperationsCollisionsAndInvalidMovesCannotChangeTheTree() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            store.append(state, actor, initialize(entry("src", Kind.DIRECTORY), entry("src/Main.java", Kind.FILE), entry("README.md", Kind.FILE)));
            Map<String, Entry> before = Map.copyOf(state.entries);
            for (Command command : List.of(
                    delete(0, "src"), rename(1, "src/Main.java", "README.md"),
                    rename(1, "src/Main.java", "readme.MD"), rename(1, "src", "missing/src"),
                    delete(1, "absent"), create(1, entry("README.md/file", Kind.FILE), ""),
                    create(1, entry("src", Kind.DIRECTORY), null))) {
                assertThrows(Conflict.class, () -> store.append(state, actor, command));
                assertEquals(before, state.entries);
                assertEquals(1, state.version());
            }
            assertThrows(IllegalArgumentException.class, () -> store.append(state, actor, rename(1, "src", "src/nested")));
            store.append(state, actor, rename(1, "src", "SRC"));
            assertTrue(state.entries.containsKey("SRC/Main.java"));
        }
    }

    @Test void rejectsUnsafePathsAndUnboundedOrAmbiguousInput() throws Exception {
        for (String path : List.of("", "/root", "../file", "a/../b", "a//b", "a/", "C:/file", "a\\b",
                ".git/config", "src/.GIT/hooks", ".conflux/data", "a\0b", "a\nb", "NUL.txt", "COM¹", "CON .txt",
                "a.", "a ", "a/./b", "e\u0301", "a".repeat(241), "a/".repeat(33) + "x"))
            assertThrows(IllegalArgumentException.class, () -> path(path), path);
        for (String path : List.of("src/Main.java", "folder with spaces/é.txt", "项目/文件", ".gitignore"))
            assertDoesNotThrow(() -> path(path));
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            Entry one = entry("one", Kind.FILE);
            assertThrows(Conflict.class, () -> store.append(state, actor,
                    initialize(one, new Entry(one.id(), "two", Kind.FILE))));
            assertThrows(Conflict.class, () -> store.append(state, actor, initialize(entry("a/b", Kind.FILE))));
            store.append(state, actor, initialize());
            assertThrows(IllegalArgumentException.class, () -> store.append(state, actor, create(1, one, null)));
            assertThrows(IllegalArgumentException.class, () -> store.append(state, actor, create(1, one, "a".repeat(MAX_CONTENT + 1))));
            assertThrows(IllegalArgumentException.class, () -> store.append(state, actor, create(1, one, "binary\0")));
            assertThrows(IllegalArgumentException.class, () -> store.append(state, actor, create(1, entry("dir", Kind.DIRECTORY), "")));
            assertEquals(1, state.version());
        }
    }

    @Test void failedPersistenceNeverAdvancesStateOrAcknowledgesTheOperation() throws Exception {
        var journal = mock(DocumentJournal.class);
        when(journal.read(key)).thenReturn(List.of());
        when(journal.append(eq(key), eq(actor), any(), eq(1))).thenThrow(new IOException("disk full"));
        var store = new FileTreeStore(journal, json);
        var state = store.load(key);
        assertThrows(IOException.class, () -> store.append(state, actor, initialize(entry("a", Kind.FILE))));
        assertEquals(0, state.version());
        assertTrue(state.entries.isEmpty());
        assertTrue(state.usedIds.isEmpty());
    }

    @Test void fileHistoryHasItsOwnNamespaceAndRejectsCorruptCommands() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            journal.append(new DocumentId(key.projectId(), key.workstreamId(), "file-tree"), actor, new byte[]{1}, 1);
            assertEquals(0, store.load(key).version());
            journal.append(key, actor, "not a command".getBytes(java.nio.charset.StandardCharsets.UTF_8), 1);
            assertThrows(IOException.class, () -> store.load(key));
        }
    }

    @Test void existingDocumentIdsRemainStableAcrossRenamesAndLimitsPreserveAcceptedHistory() throws Exception {
        try (var journal = new DocumentJournal(directory.toString())) {
            var store = new FileTreeStore(journal, json);
            var state = store.load(key);
            Entry existing = new Entry("Main.java-abc123", "Main.java", Kind.FILE);
            store.append(state, actor, initialize(existing));
            store.append(state, actor, rename(1, "Main.java", "App.java"));
            assertEquals(existing.id(), store.load(key).entries.get("App.java").id());
            String content = "x".repeat(MAX_CONTENT);
            for (int i = 0; i < 31; i++) store.append(state, actor, create(state.version(), entry("file" + i, Kind.FILE), content));
            int version = state.version();
            assertThrows(IOException.class, () -> store.append(state, actor, create(version, entry("too-large", Kind.FILE), content)));
            assertEquals(version, store.load(key).version());
            assertFalse(state.entries.containsKey("too-large"));
        }
    }
}
