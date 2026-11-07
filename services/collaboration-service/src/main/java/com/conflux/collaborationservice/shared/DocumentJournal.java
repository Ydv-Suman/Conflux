package com.conflux.collaborationservice.shared;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.zip.CRC32C;
import tools.jackson.databind.ObjectMapper;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DocumentJournal implements AutoCloseable {
    public static final int MAX_UPDATE = 2 * 1024 * 1024;
    static final long MAX_HISTORY = 32L * 1024 * 1024;
    static final int MAX_RECORDS = 10000;
    private static final int MAX_VERSIONED_RECORD = 8 * 1024 * 1024;
    private final ObjectMapper json = new ObjectMapper();
    private final Path directory;
    private final FileChannel lockChannel;
    private final FileLock lock;

    public DocumentJournal(@Value("${app.document-directory}") String directory) throws IOException {
        this.directory = Path.of(directory);
        Files.createDirectories(this.directory);
        lockChannel = FileChannel.open(this.directory.resolve(".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        try { lock = lockChannel.tryLock(); }
        catch (IOException | RuntimeException error) { lockChannel.close(); throw error; }
        if (lock == null) { lockChannel.close(); throw new IOException("Document directory is already in use"); }
    }

    // shortcut: single-instance append journal; add CRDT compaction/shared storage before horizontal scaling.
    public synchronized List<Entry> read(DocumentId document) throws IOException {
        return readRecords(document).stream().filter(record -> record.entry() != null).map(Record::entry).toList();
    }

    public synchronized boolean attributed(DocumentId document) throws IOException {
        return readRecords(document).stream().anyMatch(record -> record.version() == 2);
    }

    synchronized List<Record> readRecords(DocumentId document) throws IOException {
        Path path = path(document);
        if (!Files.exists(path)) return List.of();
        if (Files.size(path) > MAX_HISTORY) throw new IOException("Document history exceeds limit");
        List<Record> records = new ArrayList<>();
        int sequence = 0;
        boolean versioned = false;
        try (var file = FileChannel.open(path, StandardOpenOption.READ, StandardOpenOption.WRITE)) {
            long validEnd = 0;
            while (file.position() < file.size()) {
                ByteBuffer length = ByteBuffer.allocate(4);
                if (!readFully(file, length)) { file.truncate(validEnd); file.force(true); break; }
                int marker = length.flip().getInt();
                boolean v2 = marker < 0;
                long sizeLong = v2 ? -(long) marker : marker;
                if (sizeLong < (v2 ? 1 : 25) || sizeLong > (v2 ? MAX_VERSIONED_RECORD : MAX_UPDATE + 24))
                    throw new IOException("Corrupt document journal");
                int size = (int) sizeLong;
                ByteBuffer record = ByteBuffer.allocate(size + 4);
                if (!readFully(file, record)) { file.truncate(validEnd); file.force(true); break; }
                byte[] bytes = record.array();
                CRC32C checksum = new CRC32C();
                checksum.update(bytes, 0, size);
                if (ByteBuffer.wrap(bytes, size, 4).getInt() != (int) checksum.getValue())
                    throw new IOException("Corrupt document journal");
                if (v2) {
                    versioned = true;
                    Record saved;
                    try { saved = json.readValue(java.util.Arrays.copyOf(bytes, size), Record.class); }
                    catch (RuntimeException invalid) { throw new IOException("Invalid versioned journal record", invalid); }
                    if (saved == null || saved.version() != 2 || (saved.entry() == null) == (saved.binding() == null))
                        throw new IOException("Unsupported journal record");
                    if (saved.entry() != null) {
                        Entry entry = saved.entry();
                        if (entry.sequence() != ++sequence || entry.actorId() == null || entry.timestamp() == null
                                || entry.update() == null || entry.update().length == 0 || entry.update().length > MAX_UPDATE
                                || entry.attribution() == null) throw new IOException("Invalid attributed entry");
                        validateAttribution(entry.attribution());
                    } else if (saved.binding().actorId() == null || saved.binding().requestId() == null
                            || saved.binding().timestamp() == null || !validWriter(saved.binding().writerId()))
                        throw new IOException("Invalid writer binding");
                    records.add(saved);
                } else {
                    if (versioned) throw new IOException("Legacy update after versioned journal record");
                    record.flip();
                    UUID actor = new UUID(record.getLong(), record.getLong());
                    Instant time = Instant.ofEpochMilli(record.getLong());
                    byte[] update = new byte[size - 24];
                    record.get(update);
                    records.add(new Record(1, new Entry(++sequence, actor, time, update, null), null));
                }
                if (records.size() > MAX_RECORDS) throw new IOException("Document record limit exceeded");
                validEnd = file.position();
            }
        }
        return List.copyOf(records);
    }

    public synchronized Entry append(DocumentId document, UUID actor, byte[] update, int sequence) throws IOException {
        if (actor == null || update == null || update.length == 0 || update.length > MAX_UPDATE
                || sequence < 1 || sequence > MAX_RECORDS) throw new IOException("Document update limit exceeded");
        var records = readRecords(document);
        if (records.stream().anyMatch(record -> record.version() == 2)) throw new IOException("Attribution protocol required");
        if (sequence != records.size() + 1) throw new IOException("Stale document sequence");
        Instant time = Instant.ofEpochMilli(System.currentTimeMillis());
        int size = 24 + update.length;
        ByteBuffer body = ByteBuffer.allocate(size);
        body.putLong(actor.getMostSignificantBits()).putLong(actor.getLeastSignificantBits())
                .putLong(time.toEpochMilli()).put(update);
        appendRecord(document, body.array(), false);
        return new Entry(sequence, actor, time, update, null);
    }

    synchronized void appendVersioned(DocumentId document, Record record) throws IOException {
        if (readRecords(document).size() >= MAX_RECORDS) throw new IOException("Document record limit exceeded");
        byte[] body = json.writeValueAsBytes(record);
        if (body.length > MAX_VERSIONED_RECORD) throw new IOException("Versioned record too large");
        appendRecord(document, body, true);
    }

    private void appendRecord(DocumentId document, byte[] body, boolean versioned) throws IOException {
        CRC32C checksum = new CRC32C();
        checksum.update(body, 0, body.length);
        ByteBuffer record = ByteBuffer.allocate(body.length + 8);
        record.putInt(versioned ? -body.length : body.length).put(body).putInt((int) checksum.getValue()).flip();
        Path path = path(document);
        try (var file = FileChannel.open(path, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            long start = file.size();
            if (start + record.remaining() > MAX_HISTORY) throw new IOException("Document history limit exceeded");
            file.position(start);
            try {
                while (record.hasRemaining()) file.write(record);
                file.force(true);
                // Persist the directory entry too before returning a first-write receipt.
                if (start == 0) try (var parent = FileChannel.open(directory, StandardOpenOption.READ)) { parent.force(true); }
            } catch (IOException failure) {
                file.truncate(start);
                file.force(true);
                throw failure;
            }
        }
    }

    static boolean validWriter(long value) { return value >= 0 && value <= 9_007_199_254_740_991L; }

    private static void validateAttribution(Attribution value) throws IOException {
        if (value.operationId() == null || !validWriter(value.writerId()) || value.snapshot() == null
                || value.snapshot().length == 0 || value.snapshot().length > MAX_UPDATE
                || value.inserted() == null || value.deleted() == null) throw new IOException("Invalid provenance");
        if (value.importedWriters() != null && (!value.imported() || value.changed() || value.writerId() != 0
                || value.importedWriters().size() > 10000 || value.importedWriters().stream().anyMatch(writer -> writer == null || !validWriter(writer))))
            throw new IOException("Invalid legacy import");
        for (var ranges : List.of(value.inserted(), value.deleted())) {
            if (ranges.size() > 100_000) throw new IOException("Provenance range limit");
            for (var range : ranges) if (range == null || !validWriter(range.clientId()) || range.clock() < 0
                    || range.length() <= 0 || range.length() > 100_000
                    || range.clock() > 9_007_199_254_740_991L - range.length()) throw new IOException("Invalid provenance range");
        }
    }

    Path path(DocumentId document) {
        try {
            return directory.resolve(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(document.key().getBytes(java.nio.charset.StandardCharsets.UTF_8))) + ".updates");
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private boolean readFully(FileChannel file, ByteBuffer target) throws IOException {
        while (target.hasRemaining()) if (file.read(target) < 0) return false;
        return true;
    }

    @PreDestroy @Override public void close() throws IOException { lock.release(); lockChannel.close(); }

    public record EditRange(long clientId, long clock, int length) { }
    public record Attribution(UUID operationId, long writerId, byte[] snapshot,
                              List<EditRange> inserted, List<EditRange> deleted, boolean imported, List<Long> importedWriters) {
        public Attribution(UUID operationId, long writerId, byte[] snapshot, List<EditRange> inserted, List<EditRange> deleted, boolean imported) {
            this(operationId, writerId, snapshot, inserted, deleted, imported, null);
        }
        public Attribution(UUID operationId, long writerId, byte[] snapshot, List<EditRange> inserted, List<EditRange> deleted) {
            this(operationId, writerId, snapshot, inserted, deleted, false);
        }
        public Attribution {
            importedWriters = importedWriters == null ? null : List.copyOf(importedWriters);
            snapshot = snapshot == null ? null : snapshot.clone();
            inserted = inserted == null ? null : List.copyOf(inserted);
            deleted = deleted == null ? null : List.copyOf(deleted);
        }
        @Override public byte[] snapshot() { return snapshot == null ? null : snapshot.clone(); }
        public boolean changed() { return !inserted.isEmpty() || !deleted.isEmpty(); }
    }
    public record WriterBinding(UUID actorId, UUID requestId, long writerId, Instant timestamp) { }
    record Record(int version, Entry entry, WriterBinding binding) { }
    public record Entry(int sequence, UUID actorId, Instant timestamp, byte[] update, Attribution attribution) {
        public Entry { update = update == null ? null : update.clone(); }
        @Override public byte[] update() { return update == null ? null : update.clone(); }
        public String authorshipStatus() { return attribution == null || attribution.imported() ? "UNKNOWN" : "VALIDATED_ACCOUNT_EDIT"; }
    }
}
