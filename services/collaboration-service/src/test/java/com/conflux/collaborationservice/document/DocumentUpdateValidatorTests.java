package com.conflux.collaborationservice.document;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class DocumentUpdateValidatorTests {
    @TempDir Path directory;
    private final byte[] empty = {0, 0};
    // Real Yjs 13.6.33 update: writer 10 inserts "hello" into the content text.
    private final byte[] hello = Base64.getDecoder().decode("AQEKAAQBB2NvbnRlbnQFaGVsbG8A");

    @Test void runsRealWorkerAndReplaysWithoutDuplicateCredit() {
        var validator = new DocumentUpdateValidator("node", "validator/worker.mjs", new ObjectMapper());
        var result = validator.validate(empty, hello, 10);
        assertEquals("", result.before());
        assertEquals("hello", result.after());
        assertTrue(result.changed());
        assertEquals(java.util.List.of(new DocumentUpdateValidator.Range(10, 0, 5)), result.inserted());
        assertTrue(result.deleted().isEmpty());
        var replay = validator.validate(Base64.getDecoder().decode(result.snapshot()), hello, 10);
        assertFalse(replay.changed());
        assertEquals(result.snapshot(), replay.snapshot());
        assertTrue(replay.inserted().isEmpty());
    }

    @Test void rejectsForeignWriterAndMalformedPayloadWithoutEchoingContent() {
        var validator = new DocumentUpdateValidator("node", "validator/worker.mjs", new ObjectMapper());
        var foreign = assertThrows(DocumentUpdateValidator.Rejected.class, () -> validator.validate(empty, hello, 20));
        assertEquals("FOREIGN_WRITER", foreign.code);
        assertFalse(foreign.getMessage().contains("hello"));
        assertThrows(DocumentUpdateValidator.Rejected.class, () -> validator.validate(empty, new byte[]{-1}, 10));
        assertThrows(DocumentUpdateValidator.Rejected.class, () -> validator.validate(empty, hello, -1));
    }

    @Test void missingRuntimeAndCrashingWorkerFailClosed() throws Exception {
        var absent = new DocumentUpdateValidator(directory.resolve("missing-node").toString(), "validator/worker.mjs", new ObjectMapper());
        assertThrows(DocumentUpdateValidator.Unavailable.class, () -> absent.validate(empty, hello, 10));
        var crashing = worker("process.exit(2)", Duration.ofSeconds(2));
        assertThrows(DocumentUpdateValidator.Unavailable.class, () -> crashing.validate(empty, hello, 10));
    }

    @Test void workerDeadlineKillsHungProcessAndReleasesCapacity() throws Exception {
        var hanging = worker("setInterval(() => {}, 1000)", Duration.ofMillis(150));
        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
            for (int i = 0; i < 3; i++) assertThrows(DocumentUpdateValidator.Unavailable.class,
                    () -> hanging.validate(empty, hello, 10));
        });
    }

    @Test void oversizedAndInvalidResponsesFailClosed() throws Exception {
        for (String script : java.util.List.of(
                "process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1))",
                "process.stdout.write('not json')",
                "process.stdout.write(JSON.stringify({ok:true}))")) {
            var validator = worker(script, Duration.ofSeconds(2));
            assertThrows(DocumentUpdateValidator.Unavailable.class, () -> validator.validate(empty, hello, 10));
        }
    }

    private DocumentUpdateValidator worker(String code, Duration timeout) throws Exception {
        Path script = Files.createTempFile(directory, "worker-", ".mjs");
        Files.writeString(script, code);
        return new DocumentUpdateValidator("node", script, timeout, new ObjectMapper());
    }
}
