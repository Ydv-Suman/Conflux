package com.conflux.collaborationservice.shared;

import java.io.IOException;
import com.conflux.collaborationservice.document.DocumentUpdateValidator;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Arrays;
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
    private static final long CACHE_BYTES = 64L * 1024 * 1024;
    private final Map<DocumentId, Cached> cache = new LinkedHashMap<>(16, .75f, true);
    private long cacheBytes;
    private static final class Cached {
        List<Record> records;
        List<Entry> entries;
        List<Checkpoint> checkpoints;
        BasicFileAttributes attributes;
        byte[] latestSnapshot;
        long weight;
        Cached(List<Record> records, BasicFileAttributes attributes, byte[] latestSnapshot) {
            this.records = List.copyOf(records);
            this.entries = records.stream().filter(record -> record.entry() != null).map(Record::entry).toList();
            this.checkpoints = records.stream().filter(record -> record.checkpoint() != null).map(Record::checkpoint).toList();
            this.attributes = attributes;
            this.latestSnapshot = latestSnapshot == null ? null : latestSnapshot.clone();
            this.weight = records.stream().mapToLong(record -> record.entry() == null ? 256 : 256L + record.entry().update.length
                + (record.entry().attribution() == null ? 0 : (record.entry().attribution().snapshot == null ? 0 : record.entry().attribution().snapshot.length)
                + 48L * (record.entry().attribution().inserted().size() + record.entry().attribution().deleted().size()))).sum()
                + (latestSnapshot == null ? 0 : latestSnapshot.length);
        }
    }

    public DocumentJournal(@Value("${app.document-directory}") String directory) throws IOException {
        this.directory = Path.of(directory);
        Files.createDirectories(this.directory);
        if (Files.exists(this.directory.resolve(".restore-in-progress"))) throw new IOException("Incomplete restore; finish recovery before starting the service");
        lockChannel = FileChannel.open(this.directory.resolve(".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        try { lock = lockChannel.tryLock(); }
        catch (IOException | RuntimeException error) { lockChannel.close(); throw error; }
        if (lock == null) { lockChannel.close(); throw new IOException("Document directory is already in use"); }
    }

    // A single writer owns this directory. Caches are disposable; checksummed journals remain authoritative.
    public synchronized List<Entry> read(DocumentId document) throws IOException {
        var records = readRecords(document);
        var saved = cache.get(document);
        return saved != null ? saved.entries : records.stream().filter(record -> record.entry() != null).map(Record::entry).toList();
    }

    public synchronized boolean attributed(DocumentId document) throws IOException {
        return readRecords(document).stream().anyMatch(record -> (record.binding() != null || (record.entry() != null && record.entry().attribution() != null)));
    }

    synchronized List<Record> readRecords(DocumentId document) throws IOException {
        Path path = path(document);
        if (!Files.exists(path)) { forget(document); return List.of(); }
        if (Files.size(path) > MAX_HISTORY) throw new IOException("Document history exceeds limit");
        var attributes = Files.readAttributes(path, BasicFileAttributes.class);
        var cached = cache.get(document);
        if (cached != null && cached.attributes.size() == attributes.size()
                && cached.attributes.lastModifiedTime().equals(attributes.lastModifiedTime())
                && java.util.Objects.equals(cached.attributes.fileKey(), attributes.fileKey())) return cached.records;
        forget(document);
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
                    Record saved;
                    try { saved = json.readValue(java.util.Arrays.copyOf(bytes, size), Record.class); }
                    catch (RuntimeException invalid) { throw new IOException("Invalid versioned journal record", invalid); }
                    if (saved == null || (saved.version() != 2 && saved.version() != 3) || ((saved.entry() == null ? 0 : 1) + (saved.binding() == null ? 0 : 1) + (saved.checkpoint() == null ? 0 : 1) != 1))
                        throw new IOException("Unsupported journal record");
                    if (saved.checkpoint() != null) {
                        var checkpoint = saved.checkpoint();
                        if (saved.version() != 3 || checkpoint.requestId() == null || checkpoint.actorId() == null || checkpoint.timestamp() == null
                                || checkpoint.sequence() < 0 || checkpoint.sequence() > sequence || checkpoint.beforeSequence() < 0
                                || checkpoint.beforeSequence() > checkpoint.sequence() || checkpoint.number() < 0 || checkpoint.number() > MAX_RECORDS
                                || checkpoint.contentHash() == null || !checkpoint.contentHash().matches("[a-f0-9]{64}")
                                || !"CLOSE".equals(checkpoint.reason())
                                || (checkpoint.afterHash() != null && !checkpoint.afterHash().matches("[a-f0-9]{64}"))
                                || (((checkpoint.afterHash() == null ? 0 : 1) + (checkpoint.afterOperationId() == null ? 0 : 1) + (checkpoint.afterSequence() == null ? 0 : 1) > 1)
                                || (checkpoint.afterSequence() != null && (checkpoint.afterSequence() < 0 || checkpoint.afterSequence() > checkpoint.sequence())))) throw new IOException("Invalid version checkpoint");
                    } else if (saved.entry() != null) {
                        versioned = true;
                        Entry entry = saved.entry();
                        if (entry.sequence() != ++sequence || entry.actorId() == null || entry.timestamp() == null
                                || entry.update() == null || entry.update().length == 0 || entry.update().length > MAX_UPDATE
                                || entry.attribution() == null) throw new IOException("Invalid attributed entry");
                        validateAttribution(entry.attribution(), saved.version() == 3);
                    } else if (saved.binding().actorId() == null || saved.binding().requestId() == null
                            || saved.binding().timestamp() == null || !validWriter(saved.binding().writerId()))
                        throw new IOException("Invalid writer binding");
                    if (saved.binding() != null) versioned = true;
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
        var loaded = new Cached(records, Files.readAttributes(path, BasicFileAttributes.class), null);
        remember(document, loaded);
        return loaded.records;
    }

    public synchronized Entry append(DocumentId document, UUID actor, byte[] update, int sequence) throws IOException {
        if (actor == null || update == null || update.length == 0 || update.length > MAX_UPDATE
                || sequence < 1 || sequence > MAX_RECORDS) throw new IOException("Document update limit exceeded");
        var records = readRecords(document);
        if (records.size() >= MAX_RECORDS) throw new IOException("Document record limit exceeded");
        if (records.stream().anyMatch(record -> (record.binding() != null || (record.entry() != null && record.entry().attribution() != null)))) throw new IOException("Attribution protocol required");
        if (sequence != records.stream().filter(record -> record.entry() != null).count() + 1) throw new IOException("Stale document sequence");
        Instant time = Instant.ofEpochMilli(System.currentTimeMillis());
        int size = 24 + update.length;
        ByteBuffer body = ByteBuffer.allocate(size);
        body.putLong(actor.getMostSignificantBits()).putLong(actor.getLeastSignificantBits())
                .putLong(time.toEpochMilli()).put(update);
        var entry = new Entry(sequence, actor, time, update, null);
        appendRecord(document, body.array(), false);
        appended(document, new Record(1, entry, null), null);
        return entry;
    }

    synchronized void appendVersioned(DocumentId document, Record record) throws IOException {
        var records = readRecords(document);
        if (records.size() >= MAX_RECORDS) throw new IOException("Document record limit exceeded");
        if (records.stream().anyMatch(item -> item.version() == 2)) records = compact(document, records);
        var stored = record;
        byte[] latest = null;
        if (record.entry() != null) {
            var entry = record.entry();
            validateAttribution(entry.attribution(), false);
            if (entry.sequence() != records.stream().filter(item -> item.entry() != null).count() + 1) throw new IOException("Stale document sequence");
            latest = entry.attribution().snapshot();
            long tailBytes = entry.update.length;
            for (int i = records.size() - 1; i >= 0; i--) {
                var previous = records.get(i).entry();
                if (previous == null) continue;
                if (previous.attribution() != null && previous.attribution().snapshot != null) break;
                tailBytes += previous.update.length;
            }
            boolean checkpoint = entry.sequence() == 1 || entry.sequence() % 100 == 0
                    || tailBytes >= 1024 * 1024 || entry.attribution().imported();
            var provenance = entry.attribution();
            stored = new Record(3, new Entry(entry.sequence(), entry.actorId(), entry.timestamp(), entry.update(),
                    new Attribution(provenance.operationId(), provenance.writerId(), checkpoint ? latest : null,
                            provenance.inserted(), provenance.deleted(), provenance.imported(), provenance.importedWriters())), null);
        } else stored = new Record(3, null, record.binding(), record.checkpoint());
        byte[] body = json.writeValueAsBytes(stored);
        if (body.length > MAX_VERSIONED_RECORD) throw new IOException("Versioned record too large");
        appendRecord(document, body, true);
        appended(document, stored, latest);
    }

    private List<Record> compact(DocumentId document, List<Record> records) throws IOException {
        Path temporary = Files.createTempFile(directory, ".compact-", ".partial");
        var converted = new ArrayList<Record>();
        long tailBytes = 0;
        try {
            try (var output = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                for (var record : records) {
                    var entry = record.entry();
                    if (record.version() == 2 && entry != null) {
                        var provenance = entry.attribution();
                        tailBytes += entry.update.length;
                        boolean checkpoint = entry.sequence() == 1 || entry.sequence() % 100 == 0
                                || tailBytes >= 1024 * 1024 || provenance.imported();
                        record = new Record(3, new Entry(entry.sequence(), entry.actorId(), entry.timestamp(), entry.update(),
                                new Attribution(provenance.operationId(), provenance.writerId(), checkpoint ? provenance.snapshot() : null,
                                        provenance.inserted(), provenance.deleted(), provenance.imported(), provenance.importedWriters())), null);
                        if (checkpoint) tailBytes = 0;
                    } else if (record.version() == 2) record = new Record(3, null, record.binding());
                    else if (entry != null) tailBytes = entry.attribution() != null && entry.attribution().snapshot != null ? 0 : tailBytes + entry.update.length;
                    byte[] body;
                    if (record.version() == 1) {
                        var legacy = ByteBuffer.allocate(24 + entry.update.length);
                        legacy.putLong(entry.actorId().getMostSignificantBits()).putLong(entry.actorId().getLeastSignificantBits())
                                .putLong(entry.timestamp().toEpochMilli()).put(entry.update);
                        body = legacy.array();
                    } else body = json.writeValueAsBytes(record);
                    var checksum = new CRC32C(); checksum.update(body, 0, body.length);
                    var frame = ByteBuffer.allocate(body.length + 8).putInt(record.version() == 1 ? body.length : -body.length)
                            .put(body).putInt((int) checksum.getValue()).flip();
                    while (frame.hasRemaining()) output.write(frame);
                    converted.add(record);
                }
                output.force(true);
            }
            publishCompaction(temporary, path(document));
            var old = cache.get(document);
            var saved = new Cached(converted, Files.readAttributes(path(document), BasicFileAttributes.class), old == null ? null : old.latestSnapshot);
            remember(document, saved);
            return saved.records;
        } finally { Files.deleteIfExists(temporary); }
    }

    void publishCompaction(Path temporary, Path target) throws IOException {
        Files.move(temporary, target, java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        try (var parent = FileChannel.open(directory, StandardOpenOption.READ)) { parent.force(true); }
    }

    private void appended(DocumentId document, Record record, byte[] latest) {
        // A cache failure after fsync must not turn a durable append into a failed receipt.
        try {
            var previous = cache.get(document);
            if (previous == null) return;
            var records = new ArrayList<>(previous.records);
            records.add(record);
            remember(document, new Cached(records, Files.readAttributes(path(document), BasicFileAttributes.class),
                    latest != null ? latest : previous.latestSnapshot));
        } catch (IOException failure) { forget(document); }
    }

    private void forget(DocumentId document) {
        var previous = cache.remove(document);
        if (previous != null) cacheBytes -= previous.weight;
    }

    private void remember(DocumentId document, Cached value) {
        forget(document);
        if (value.weight > CACHE_BYTES) return;
        cache.put(document, value); cacheBytes += value.weight;
        while (cacheBytes > CACHE_BYTES || cache.size() > 32) forget(cache.keySet().iterator().next());
    }

    public byte[] snapshot(DocumentId document, List<Entry> entries, int index, DocumentUpdateValidator validator) {
        if (index < 0) return new byte[]{0, 0};
        Cached current;
        synchronized (this) {
            current = cache.get(document);
            if (current != null && index == current.entries.size() - 1 && entries.get(index) == current.entries.getLast()
                    && current.latestSnapshot != null) return current.latestSnapshot.clone();
        }
        var checkpoint = entries.get(index).attribution();
        if (checkpoint != null && checkpoint.snapshot != null) return checkpoint.snapshot();
        var updates = new ArrayList<byte[]>();
        int start = index;
        while (start >= 0) {
            var attribution = entries.get(start).attribution();
            if (attribution != null && attribution.snapshot != null) { updates.add(attribution.snapshot()); break; }
            start--;
        }
        for (int i = start + 1; i <= index; i++) updates.add(entries.get(i).update());
        byte[] result = java.util.Base64.getDecoder().decode(validator.importHistory(updates).snapshot());
        synchronized (this) {
            if (current != null && cache.get(document) == current && index == current.entries.size() - 1 && entries.get(index) == current.entries.getLast())
                remember(document, new Cached(current.records, current.attributes, result));
        }
        return result;
    }

    public synchronized List<Checkpoint> checkpoints(DocumentId document) throws IOException {
        var records = readRecords(document);
        var saved = cache.get(document);
        return saved != null ? saved.checkpoints : records.stream().filter(record -> record.checkpoint() != null).map(Record::checkpoint).toList();
    }

    public synchronized void appendCheckpoint(DocumentId document, Checkpoint checkpoint) throws IOException {
        appendVersioned(document, new Record(3, null, null, checkpoint));
    }

    synchronized Path directory() { return directory; }

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

    private static void validateAttribution(Attribution value, boolean incremental) throws IOException {
        if (value.operationId() == null || !validWriter(value.writerId()) || (value.snapshot == null && (!incremental || value.imported()))
                || (value.snapshot != null && (value.snapshot.length == 0 || value.snapshot.length > MAX_UPDATE))
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
    public record Checkpoint(UUID requestId, UUID actorId, Instant timestamp, String reason, int number,
                             int beforeSequence, int sequence, String contentHash, boolean created, UUID afterOperationId, String afterHash, Integer afterSequence) { }
    record Record(int version, Entry entry, WriterBinding binding, Checkpoint checkpoint) {
        Record(int version, Entry entry, WriterBinding binding) { this(version, entry, binding, null); }
    }
    public record Entry(int sequence, UUID actorId, Instant timestamp, byte[] update, Attribution attribution) {
        public Entry { update = update == null ? null : update.clone(); }
        @Override public byte[] update() { return update == null ? null : update.clone(); }
        public String authorshipStatus() { return attribution == null || attribution.imported() ? "UNKNOWN" : "VALIDATED_ACCOUNT_EDIT"; }
    }
}
