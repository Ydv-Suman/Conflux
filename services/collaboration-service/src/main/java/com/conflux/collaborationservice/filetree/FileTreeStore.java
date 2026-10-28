package com.conflux.collaborationservice.filetree;

import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;

import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
final class FileTreeStore {
    static final int MAX_NODES = 5000;
    static final int MAX_CONTENT = 256 * 1024;
    static final int MAX_HISTORY_BYTES = 8 * 1024 * 1024;
    private final DocumentJournal journal;
    private final ObjectMapper json;

    FileTreeStore(DocumentJournal journal, ObjectMapper json) {
        this.journal = journal;
        this.json = json;
    }

    // '$' cannot occur in the public document endpoint: tree records cannot be read or overwritten as Yjs updates.
    static DocumentId key(UUID projectId, UUID workstreamId) {
        return new DocumentId(projectId, workstreamId, "$file-tree");
    }

    enum Kind { FILE, DIRECTORY }
    enum Type { INITIALIZE, CREATE, RENAME, DELETE }
    record Entry(String id, String path, Kind kind) { }
    record Command(UUID operationId, Integer expectedVersion, Type type, Entry entry,
                   String path, String targetPath, String content, List<Entry> entries) { }
    record Event(String type, int version, UUID actorId, Instant timestamp, Command command) { }

    static final class State {
        final DocumentId key;
        Map<String, Entry> entries = new LinkedHashMap<>();
        final Set<String> usedIds = new HashSet<>();
        final Map<UUID, Event> operations = new LinkedHashMap<>();
        int bytes;
        State(DocumentId key) { this.key = key; }
        int version() { return operations.size(); }
    }

    static final class Conflict extends RuntimeException {
        Conflict(String message) { super(message); }
    }

    State load(DocumentId key) throws IOException {
        State state = new State(key);
        for (var saved : journal.read(key)) {
            try {
                Command command = json.readValue(saved.update(), Command.class);
                if (state.operations.containsKey(command.operationId())) throw new IllegalArgumentException();
                Map<String, Entry> next = apply(state, command);
                commit(state, next, new Event("event", saved.sequence(), saved.actorId(), saved.timestamp(), command), saved.update().length);
                if (state.bytes > MAX_HISTORY_BYTES) throw new IOException("File history limit reached");
            } catch (RuntimeException invalid) {
                throw new IOException("Invalid file history", invalid);
            }
        }
        return state;
    }

    // The handler holds the room lock across validation, persistence, and broadcast.
    Event append(State state, UUID actor, Command command) throws IOException {
        if (command == null || command.operationId() == null) throw new IllegalArgumentException();
        Event previous = state.operations.get(command.operationId());
        if (previous != null) {
            if (!previous.actorId().equals(actor) || !previous.command().equals(command))
                throw new Conflict("Operation ID was already used for a different request");
            return previous;
        }
        Map<String, Entry> next = apply(state, command);
        byte[] bytes = json.writeValueAsBytes(command);
        if (bytes.length > DocumentJournal.MAX_UPDATE - 1024 || state.bytes + bytes.length > MAX_HISTORY_BYTES)
            throw new IOException("File history limit reached");
        var saved = journal.append(state.key, actor, bytes, state.version() + 1);
        Event event = new Event("event", saved.sequence(), saved.actorId(), saved.timestamp(), command);
        commit(state, next, event, bytes.length);
        return event;
    }

    private void commit(State state, Map<String, Entry> entries, Event event, int bytes) {
        state.entries = entries;
        entries.values().forEach(entry -> state.usedIds.add(entry.id()));
        state.operations.put(event.command().operationId(), event);
        state.bytes += bytes;
    }

    private Map<String, Entry> apply(State state, Command command) {
        if (command == null || command.operationId() == null || command.type() == null
                || command.expectedVersion() == null || command.expectedVersion() < 0)
            throw new IllegalArgumentException();
        if (command.expectedVersion() != state.version()) throw new Conflict("File tree changed; reconcile before retrying");
        if (state.version() == 0 && command.type() != Type.INITIALIZE)
            throw new Conflict("Initialize the file tree from the shared Git revision first");
        Map<String, Entry> next = new LinkedHashMap<>(state.entries);
        switch (command.type()) {
            case INITIALIZE -> {
                if (state.version() != 0) throw new Conflict("File tree is already initialized");
                if (command.entries() == null || command.entries().size() > MAX_NODES || command.entry() != null
                        || command.path() != null || command.targetPath() != null || command.content() != null)
                    throw new IllegalArgumentException();
                for (Entry entry : command.entries()) add(next, state, entry);
            }
            case CREATE -> {
                if (command.entries() != null || command.path() != null || command.targetPath() != null || command.entry() == null)
                    throw new IllegalArgumentException();
                if (command.entry().kind() == Kind.FILE) {
                    if (command.content() == null || command.content().indexOf('\0') >= 0
                            || command.content().getBytes(StandardCharsets.UTF_8).length > MAX_CONTENT)
                        throw new IllegalArgumentException();
                } else if (command.content() != null) throw new IllegalArgumentException();
                add(next, state, command.entry());
            }
            case RENAME, DELETE -> {
                if (command.entry() != null || command.entries() != null || command.content() != null)
                    throw new IllegalArgumentException();
                path(command.path());
                if (!next.containsKey(command.path())) throw new Conflict("Source path no longer exists");
                if (command.type() == Type.RENAME) {
                    path(command.targetPath());
                    if (command.path().equals(command.targetPath()) || command.targetPath().startsWith(command.path() + "/"))
                        throw new IllegalArgumentException();
                } else if (command.targetPath() != null) throw new IllegalArgumentException();
                var affected = next.values().stream().filter(entry -> entry.path().equals(command.path())
                        || entry.path().startsWith(command.path() + "/")).toList();
                affected.forEach(entry -> next.remove(entry.path()));
                if (command.type() == Type.RENAME) {
                    for (Entry entry : affected) {
                        String destination = command.targetPath() + entry.path().substring(command.path().length());
                        if (next.putIfAbsent(destination, new Entry(entry.id(), destination, entry.kind())) != null)
                            throw new Conflict("Destination path already exists");
                    }
                }
            }
        }
        validateTree(next);
        return next;
    }

    private void add(Map<String, Entry> entries, State state, Entry entry) {
        if (entry == null || entry.id() == null || !entry.id().matches("[A-Za-z0-9._-]{1,128}") || entry.kind() == null)
            throw new IllegalArgumentException();
        path(entry.path());
        if (state.usedIds.contains(entry.id())) throw new Conflict("Entry ID was already used; create with a new ID");
        if (entries.putIfAbsent(entry.path(), entry) != null) throw new Conflict("Destination path already exists");
    }

    private void validateTree(Map<String, Entry> entries) {
        if (entries.size() > MAX_NODES) throw new Conflict("File tree entry limit reached");
        Set<String> ids = new HashSet<>();
        Set<String> paths = new HashSet<>();
        for (Entry entry : entries.values()) {
            path(entry.path());
            if (!ids.add(entry.id()) || !paths.add(entry.path().toLowerCase(Locale.ROOT)))
                throw new Conflict("Entry IDs and paths must be unique, including letter case");
            int slash = entry.path().lastIndexOf('/');
            if (slash >= 0) {
                Entry parent = entries.get(entry.path().substring(0, slash));
                if (parent == null || parent.kind() != Kind.DIRECTORY)
                    throw new Conflict("Parent directory does not exist");
            }
        }
    }

    static void path(String path) {
        if (path == null || path.isEmpty() || path.getBytes(StandardCharsets.UTF_8).length > 1024
                || !Normalizer.isNormalized(path, Normalizer.Form.NFC) || path.split("/", -1).length > 32
                || path.chars().anyMatch(c -> Character.isISOControl(c) || "\\<>:\"|?*".indexOf(c) >= 0))
            throw new IllegalArgumentException("Invalid relative path");
        for (String component : path.split("/", -1)) {
            String stem = component.split("\\.", -1)[0].stripTrailing().toUpperCase(Locale.ROOT);
            if (component.isBlank() || component.equals(".") || component.equals("..")
                    || component.endsWith(".") || component.endsWith(" ")
                    || component.getBytes(StandardCharsets.UTF_8).length > 240
                    || component.equalsIgnoreCase(".git") || component.equalsIgnoreCase(".conflux")
                    || stem.matches("CON|PRN|AUX|NUL|CONIN\\$|CONOUT\\$|COM[1-9¹²³]|LPT[1-9¹²³]"))
                throw new IllegalArgumentException("Invalid relative path");
        }
    }
}
