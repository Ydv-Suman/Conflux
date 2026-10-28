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

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DocumentJournal implements AutoCloseable {
    public static final int MAX_UPDATE = 2 * 1024 * 1024;
    static final long MAX_HISTORY = 32L * 1024 * 1024;
    static final int MAX_RECORDS = 10000;
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
        Path path = path(document);
        if (!Files.exists(path)) return List.of();
        if (Files.size(path) > MAX_HISTORY) throw new IOException("Document history exceeds limit");
        List<Entry> entries = new ArrayList<>();
        try (var file = FileChannel.open(path, StandardOpenOption.READ, StandardOpenOption.WRITE)) {
            long validEnd = 0;
            while (file.position() < file.size()) {
                ByteBuffer length = ByteBuffer.allocate(4);
                if (!readFully(file, length)) { file.truncate(validEnd); file.force(true); break; }
                int size = length.flip().getInt();
                if (size < 25 || size > MAX_UPDATE + 24) throw new IOException("Corrupt document journal");
                ByteBuffer record = ByteBuffer.allocate(size + 4);
                if (!readFully(file, record)) { file.truncate(validEnd); file.force(true); break; }
                byte[] bytes = record.array();
                CRC32C checksum = new CRC32C();
                checksum.update(bytes, 0, size);
                record.flip();
                UUID actor = new UUID(record.getLong(), record.getLong());
                Instant time = Instant.ofEpochMilli(record.getLong());
                byte[] update = new byte[size - 24];
                record.get(update);
                if (record.getInt() != (int) checksum.getValue()) throw new IOException("Corrupt document journal");
                entries.add(new Entry(entries.size() + 1, actor, time, update));
                if (entries.size() > MAX_RECORDS) throw new IOException("Document record limit exceeded");
                validEnd = file.position();
            }
        }
        return entries;
    }

    public synchronized Entry append(DocumentId document, UUID actor, byte[] update, int sequence) throws IOException {
        if (update.length == 0 || update.length > MAX_UPDATE || sequence > MAX_RECORDS)
            throw new IOException("Document update limit exceeded");
        Instant time = Instant.ofEpochMilli(System.currentTimeMillis());
        int size = 24 + update.length;
        ByteBuffer body = ByteBuffer.allocate(size);
        body.putLong(actor.getMostSignificantBits()).putLong(actor.getLeastSignificantBits())
                .putLong(time.toEpochMilli()).put(update);
        CRC32C checksum = new CRC32C();
        checksum.update(body.array());
        ByteBuffer record = ByteBuffer.allocate(size + 8);
        record.putInt(size).put(body.array()).putInt((int) checksum.getValue()).flip();
        try (var file = FileChannel.open(path(document), StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            long start = file.size();
            if (start + record.remaining() > MAX_HISTORY) throw new IOException("Document history limit exceeded");
            file.position(start);
            try {
                while (record.hasRemaining()) file.write(record);
                file.force(true);
            } catch (IOException failure) {
                file.truncate(start);
                file.force(true);
                throw failure;
            }
        }
        return new Entry(sequence, actor, time, update);
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

    public record Entry(int sequence, UUID actorId, Instant timestamp, byte[] update) { }
}
