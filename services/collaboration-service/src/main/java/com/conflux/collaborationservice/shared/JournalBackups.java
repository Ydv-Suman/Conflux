package com.conflux.collaborationservice.shared;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.zip.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Local, verifiable recovery copies. Replicate completed archives to independent storage operationally. */
@Component
public final class JournalBackups {
    private static final Logger log = LoggerFactory.getLogger(JournalBackups.class);
    private final DocumentJournal journal;
    private final Path destination;
    private final int retentionDays;
    private final long maxBytes;
    private final boolean enabled;
    private final ObjectMapper json;

    public JournalBackups(DocumentJournal journal, ObjectMapper json,
            @Value("${app.backup-directory:}") String destination,
            @Value("${app.backup-retention-days:30}") int retentionDays,
            @Value("${app.backup-max-bytes:2147483648}") long maxBytes,
            @Value("${app.backup-enabled:true}") boolean enabled) {
        this.journal = journal; this.json = json;
        Path data = journal.directory().toAbsolutePath().normalize();
        this.destination = destination.isBlank() ? data.resolveSibling("backups") : Path.of(destination).toAbsolutePath().normalize();
        if (this.destination.startsWith(data) || retentionDays < 1 || maxBytes < 1) throw new IllegalArgumentException("Invalid backup configuration");
        this.retentionDays = retentionDays; this.maxBytes = maxBytes; this.enabled = enabled;
    }

    @Scheduled(cron = "${app.backup-cron:0 0 2 * * *}", zone = "UTC")
    public void scheduled() {
        if (!enabled) return;
        try { log.info("Verified journal backup created: {}", create().getFileName()); }
        catch (Exception failure) { log.error("Journal backup failed; previous backups retained", failure); }
    }

    public synchronized Path create() throws Exception {
        Files.createDirectories(destination);
        privatePermissions(destination, "rwx------");
        try (var sources = capture()) { return create(sources.items); }
    }

    private Sources capture() throws IOException {
        var sources = new Sources();
        // Open descriptors pin the committed inode even if a journal is compacted during the copy.
        try {
            synchronized (journal) {
                try (var files = Files.list(journal.directory())) {
                    for (var path : files.filter(file -> file.getFileName().toString().matches("[a-f0-9]{64}\\.updates")).sorted().toList()) {
                        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Unexpected journal file");
                        var channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
                        try { sources.items.add(new Source(path, channel, channel.size())); }
                        catch (IOException failure) { channel.close(); throw failure; }
                    }
                }
            }
            return sources;
        } catch (IOException failure) { sources.close(); throw failure; }
    }

    private Path create(List<Source> sources) throws Exception {
        if (sources.size() > 10_000 || sources.stream().mapToLong(Source::size).sum() > maxBytes)
            throw new IOException("Backup exceeds configured size/file limit");
        Path temporary = Files.createTempFile(destination, ".conflux-backup-", ".partial");
        privatePermissions(temporary, "rw-------");
        var manifest = new ArrayList<FileInfo>();
        try {
            try (var zip = new ZipOutputStream(Files.newOutputStream(temporary))) {
                for (var source : sources) {
                    if (source.size() > DocumentJournal.MAX_HISTORY) throw new IOException("Journal exceeds supported limit");
                    byte[] bytes = new byte[Math.toIntExact(source.size())];
                    var buffer = ByteBuffer.wrap(bytes);
                    while (buffer.hasRemaining()) if (source.channel().read(buffer) < 0) throw new IOException("Journal changed during backup");
                    source.channel().close();
                    verifyJournal(bytes);
                    String name = source.path().getFileName().toString();
                    manifest.add(new FileInfo(name, bytes.length, hash(bytes)));
                    zip.putNextEntry(new ZipEntry(name)); zip.write(bytes); zip.closeEntry();
                }
                zip.putNextEntry(new ZipEntry("manifest.json"));
                zip.write(json.writeValueAsBytes(new Manifest(1, Instant.now(), List.copyOf(manifest))));
                zip.closeEntry();
            }
            try (var file = FileChannel.open(temporary, StandardOpenOption.WRITE)) { file.force(true); }
            verify(temporary);
            Path completed = destination.resolve("conflux-" + Instant.now().toEpochMilli() + "-" + UUID.randomUUID() + ".zip");
            Files.move(temporary, completed, StandardCopyOption.ATOMIC_MOVE);
            try (var directory = FileChannel.open(destination, StandardOpenOption.READ)) { directory.force(true); }
            prune(completed);
            return completed;
        } finally { Files.deleteIfExists(temporary); }
    }

    public void verify(Path archive) throws Exception {
        try (var zip = new ZipFile(archive.toFile())) {
            var manifest = manifest(zip);
            if (manifest.format() != 1 || manifest.createdAt() == null || manifest.files() == null || manifest.files().size() > 10_000)
                throw new IOException("Invalid backup manifest");
            var names = new HashSet<String>();
            long total = 0;
            for (var file : manifest.files()) {
                if (!file.name().matches("[a-f0-9]{64}\\.updates") || !names.add(file.name()) || file.size() < 0
                        || file.size() > DocumentJournal.MAX_HISTORY || (total += file.size()) > maxBytes)
                    throw new IOException("Invalid backup file");
                var entry = zip.getEntry(file.name());
                if (entry == null || entry.getSize() != file.size()) throw new IOException("Backup file missing or truncated");
                byte[] bytes;
                try (var input = zip.getInputStream(entry)) { bytes = input.readNBytes(Math.toIntExact(file.size()) + 1); }
                if (bytes.length != file.size() || !hash(bytes).equals(file.sha256())) throw new IOException("Backup checksum mismatch");
                verifyJournal(bytes);
            }
            if (zip.size() != names.size() + 1) throw new IOException("Unexpected backup entries");
        }
    }

    private Manifest manifest(ZipFile zip) throws IOException {
        var entry = zip.getEntry("manifest.json");
        if (entry == null || entry.getSize() < 0 || entry.getSize() > 8 * 1024 * 1024) throw new IOException("Missing backup manifest");
        try (var input = zip.getInputStream(entry)) {
            return json.readValue(input.readNBytes(8 * 1024 * 1024 + 1), Manifest.class);
        }
    }

    private void prune(Path latest) throws IOException {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        try (var files = Files.list(destination)) {
            for (var path : files.filter(file -> file.getFileName().toString().matches("conflux-[0-9]+-[a-f0-9-]{36}\\.zip")).toList()) {
                if (path.equals(latest) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) continue;
                try (var zip = new ZipFile(path.toFile())) {
                    var manifest = manifest(zip);
                    if (manifest.format() == 1 && manifest.createdAt().isBefore(cutoff)) Files.delete(path);
                } catch (Exception invalid) { log.warn("Could not rotate backup {}", path.getFileName()); }
            }
        }
    }

    private static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private static void privatePermissions(Path path, String permissions) throws IOException {
        try { Files.setPosixFilePermissions(path, PosixFilePermissions.fromString(permissions)); }
        catch (UnsupportedOperationException ignored) { /* Windows permissions belong to the configured service account. */ }
    }
    private static void verifyJournal(byte[] bytes) throws IOException {
        var input = ByteBuffer.wrap(bytes);
        int count = 0;
        while (input.hasRemaining()) {
            if (input.remaining() < 4) throw new IOException("Incomplete journal tail");
            int marker = input.getInt(); long length = Math.abs((long) marker);
            if (length < (marker < 0 ? 1 : 25) || length > (marker < 0 ? 8 * 1024 * 1024 : DocumentJournal.MAX_UPDATE + 24)
                    || input.remaining() < length + 4 || ++count > DocumentJournal.MAX_RECORDS) throw new IOException("Invalid journal record");
            var checksum = new CRC32C(); checksum.update(bytes, input.position(), (int) length);
            input.position(input.position() + (int) length);
            if (input.getInt() != (int) checksum.getValue()) throw new IOException("Journal checksum mismatch");
        }
    }
    private static final class Sources implements AutoCloseable {
        final List<Source> items = new ArrayList<>();
        @Override public void close() throws IOException {
            IOException failure = null;
            for (var source : items) try { source.channel().close(); } catch (IOException error) { failure = error; }
            if (failure != null) throw failure;
        }
    }
    private record Source(Path path, FileChannel channel, long size) { }
    public record FileInfo(String name, long size, String sha256) { }
    public record Manifest(int format, Instant createdAt, List<FileInfo> files) { }
}
