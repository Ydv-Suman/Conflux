package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentJournal;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Internal validator used by attributed document sessions; legacy sessions bypass it. */
@Component
public final class DocumentUpdateValidator {
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;
    private final String node;
    private final Path worker;
    private final Duration timeout;
    private final ObjectMapper json;
    private final Semaphore capacity = new Semaphore(2);

    @Autowired
    public DocumentUpdateValidator(
            @Value("${app.validator-node:node}") String node,
            @Value("${app.validator-worker:validator/worker.mjs}") String worker,
            ObjectMapper json) {
        this(node, Path.of(worker), Duration.ofSeconds(5), json);
    }

    DocumentUpdateValidator(String node, Path worker, Duration timeout, ObjectMapper json) {
        this.node = node;
        this.worker = worker.toAbsolutePath();
        this.timeout = timeout;
        this.json = json;
    }

    /**
     * Caller must authorize the actor and resolve their durable, document-scoped writer binding.
     * baseline must represent the current committed document version. The returned result is
     * tentative: persist it with provenance before broadcasting or acknowledging it.
     * Run off the WebFlux event loop. No authentication tokens cross into the worker.
     */
    public Validation validate(byte[] baseline, byte[] update, long writerId) {
        if (baseline == null || update == null || baseline.length == 0 || update.length == 0
                || baseline.length > DocumentJournal.MAX_UPDATE || update.length > DocumentJournal.MAX_UPDATE
                || writerId < 0 || writerId > 9_007_199_254_740_991L) throw new Rejected("INVALID_REQUEST");
        return execute(new Request(Base64.getEncoder().encodeToString(baseline), Base64.getEncoder().encodeToString(update), writerId));
    }

    public Validation importHistory(List<byte[]> history) {
        if (history == null || history.isEmpty() || history.size() > 10000
                || history.stream().anyMatch(update -> update == null || update.length == 0 || update.length > DocumentJournal.MAX_UPDATE)
                || history.stream().mapToLong(update -> update.length).sum() > 32L * 1024 * 1024) throw new Rejected("INVALID_REQUEST");
        var value = execute(new ImportRequest(history.stream().map(update -> Base64.getEncoder().encodeToString(update)).toList()));
        if (value.importedWriters() == null || value.importedWriters().stream().anyMatch(writer -> writer == null || writer < 0 || writer > 9_007_199_254_740_991L))
            throw new Unavailable();
        return value;
    }

    private Validation execute(Object payload) {
        if (!capacity.tryAcquire()) throw new Unavailable();
        Process process = null;
        try {
            // No shell, network listener, or inherited NODE_OPTIONS/preload hooks.
            var builder = new ProcessBuilder(node, "--max-old-space-size=256", worker.toString());
            builder.environment().remove("NODE_OPTIONS");
            builder.environment().remove("NODE_PATH");
            builder.redirectError(ProcessBuilder.Redirect.DISCARD);
            process = builder.start();
            final Process running = process;
            byte[] request = json.writeValueAsBytes(payload);
            // shortcut: one process per validation; measure latency before enabling on the typing path.
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var response = executor.submit(() -> {
                    try (var output = running.getOutputStream()) { output.write(request); }
                    byte[] bytes;
                    try (var input = running.getInputStream()) { bytes = input.readNBytes(MAX_RESPONSE + 1); }
                    if (bytes.length > MAX_RESPONSE) throw new IOException("Validator response limit");
                    if (running.waitFor() != 0) throw new IOException("Validator process failed");
                    return json.readValue(bytes, Response.class);
                });
                try {
                    Response result = response.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
                    if (result == null) throw new Unavailable();
                    if (!result.ok()) {
                        if (result.code() == null || !result.code().matches("[A-Z_]{1,40}")) throw new Unavailable();
                        throw new Rejected(result.code());
                    }
                    Validation value = result.result();
                    if (value == null || value.snapshot() == null || value.before() == null || value.after() == null
                            || value.inserted() == null || value.deleted() == null) throw new Unavailable();
                    return value;
                } finally {
                    running.destroyForcibly();
                    response.cancel(true);
                }
            }
        } catch (Rejected | Unavailable error) {
            throw error;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new Unavailable();
        } catch (Exception failure) {
            throw new Unavailable();
        } finally {
            if (process != null) process.destroyForcibly();
            capacity.release();
        }
    }

    private record ImportRequest(List<String> history) { }
    private record Request(String baseline, String update, long writerId) { }
    private record Response(boolean ok, Validation result, String code) { }
    public record Range(long clientId, long clock, int length) { }
    public record Validation(String snapshot, String before, String after,
                             List<Range> inserted, List<Range> deleted, boolean changed, List<Long> importedWriters) { }
    public static final class Rejected extends IllegalArgumentException {
        public final String code;
        Rejected(String code) { super("Document update rejected: " + code); this.code = code; }
    }
    public static final class Unavailable extends IllegalStateException {
        Unavailable() { super("Document validation unavailable"); }
    }
}
