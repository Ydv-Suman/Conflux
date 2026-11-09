package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** A visible version is an explicit checkpoint, independent of CRDT recovery updates. */
@Component
public final class DocumentCheckpoints {
    private final DocumentJournal journal;
    private final DocumentUpdateValidator validator;
    public DocumentCheckpoints(DocumentJournal journal, DocumentUpdateValidator validator) {
        this.journal = journal; this.validator = validator;
    }

    public DocumentJournal.Checkpoint create(DocumentId document, UUID actor, UUID requestId, UUID afterOperationId, String afterHash, Integer afterSequence) throws Exception {
        if (requestId == null || (afterHash != null && !afterHash.matches("[a-f0-9]{64}")) || ((afterHash == null ? 0 : 1) + (afterOperationId == null ? 0 : 1) + (afterSequence == null ? 0 : 1) > 1) || (afterSequence != null && afterSequence < 0))
            throw new IllegalArgumentException("Invalid checkpoint request");
        List<DocumentJournal.Entry> entries;
        List<DocumentJournal.Checkpoint> checkpoints;
        synchronized (journal) {
            checkpoints = journal.checkpoints(document);
            var previous = previous(checkpoints, actor, requestId, afterOperationId, afterHash, afterSequence);
            if (previous != null) return previous;
            entries = journal.read(document);
        }
        var last = checkpoints.stream().filter(DocumentJournal.Checkpoint::created).reduce((a, b) -> b).orElse(null);
        int sequence = entries.size();
        if (afterSequence != null) {
            if (afterSequence > entries.size()) throw new ChangedDuringCheckpoint();
            sequence = afterSequence;
        } else if (afterOperationId != null) {
            var anchor = entries.stream().filter(entry -> entry.attribution() != null && entry.attribution().operationId().equals(afterOperationId))
                    .findFirst().orElseThrow(ChangedDuringCheckpoint::new);
            if (!anchor.actorId().equals(actor)) throw new com.conflux.collaborationservice.shared.DocumentAuthorization.Denied(4403);
            sequence = anchor.sequence();
        } else if (afterHash != null) {
            sequence = 0;
            for (var entry : entries) if (hash(entry.update()).equals(afterHash)) sequence = entry.sequence();
            if (sequence == 0) throw new ChangedDuringCheckpoint();
        }
        // A late offline close cannot insert an older state after an already published version.
        if (last != null && sequence <= last.sequence()) sequence = last.sequence();
        byte[] snapshot = journal.snapshot(document, entries, sequence - 1, validator);
        String content = sequence == 0 ? "" : validator.importHistory(List.of(snapshot)).after();
        String hash = hash(content);
        int baselineSequence = last == null ? 0 : last.sequence();
        String baseline;
        if (last != null) baseline = last.contentHash();
        else if (!entries.isEmpty() && (entries.getFirst().attribution() == null || entries.getFirst().attribution().imported())) {
            baselineSequence = 1;
            baseline = hash(validator.importHistory(List.of(journal.snapshot(document, entries, 0, validator))).after());
        }
        else baseline = hash("");
        boolean changed = !hash.equals(baseline);
        var checkpoint = new DocumentJournal.Checkpoint(requestId, actor, Instant.now(), "CLOSE",
                (last == null ? 0 : last.number()) + (changed ? 1 : 0), baselineSequence, sequence, hash, changed, afterOperationId, afterHash, afterSequence);
        synchronized (journal) {
            var current = journal.checkpoints(document);
            var previous = previous(current, actor, requestId, afterOperationId, afterHash, afterSequence);
            if (previous != null) return previous;
            if (journal.read(document).size() < sequence || current.size() != checkpoints.size())
                throw new ChangedDuringCheckpoint();
            journal.appendCheckpoint(document, checkpoint);
        }
        return checkpoint;
    }

    private DocumentJournal.Checkpoint previous(List<DocumentJournal.Checkpoint> records, UUID actor, UUID id, UUID afterOperationId, String afterHash, Integer afterSequence) throws IOException {
        for (var record : records) if (record.requestId().equals(id)) {
            if (!record.actorId().equals(actor) || !java.util.Objects.equals(record.afterOperationId(), afterOperationId) || !java.util.Objects.equals(record.afterHash(), afterHash) || !java.util.Objects.equals(record.afterSequence(), afterSequence)) throw new IllegalArgumentException("Checkpoint request ID already used");
            return record;
        }
        return null;
    }

    private static String hash(String content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8)));
    }
    private static String hash(byte[] update) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(update)); }
    public static final class ChangedDuringCheckpoint extends IllegalStateException {
        ChangedDuringCheckpoint() { super("The document changed while creating this version. Retry the same request."); }
    }
}
