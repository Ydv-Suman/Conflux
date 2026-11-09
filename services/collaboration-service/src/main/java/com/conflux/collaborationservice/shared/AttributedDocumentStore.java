package com.conflux.collaborationservice.shared;

import com.conflux.collaborationservice.document.DocumentUpdateValidator;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Internal persistence boundary. Callers must supply the actor verified by DocumentAuthorization. */
@Component
public final class AttributedDocumentStore {
    private final DocumentJournal journal;
    private final DocumentUpdateValidator validator;
    private final SecureRandom random = new SecureRandom();

    public AttributedDocumentStore(DocumentJournal journal, DocumentUpdateValidator validator) {
        this.journal = journal;
        this.validator = validator;
    }

    public DocumentJournal.WriterBinding register(DocumentId document, UUID authenticatedActor, UUID requestId) throws IOException {
        Objects.requireNonNull(authenticatedActor); Objects.requireNonNull(requestId);
        synchronized (journal) {
            State state = state(document);
            for (var binding : state.bindings.values()) {
                if (binding.actorId().equals(authenticatedActor) && binding.requestId().equals(requestId)) return binding;
            }
            long writer;
            do { writer = random.nextLong(1L << 53); } while (state.bindings.containsKey(writer) || state.importedWriters.contains(writer));
            var binding = new DocumentJournal.WriterBinding(authenticatedActor, requestId, writer, now());
            journal.appendVersioned(document, new DocumentJournal.Record(2, null, binding));
            return binding;
        }
    }

    /** Append one durable unknown-author baseline; existing journal bytes and sequence references stay intact. */
    public DocumentJournal.Entry migrateLegacy(DocumentId document, UUID authenticatedActor) throws IOException {
        Objects.requireNonNull(authenticatedActor);
        List<DocumentJournal.Entry> history;
        synchronized (journal) {
            history = journal.read(document);
            var migrated = history.stream().filter(entry -> entry.attribution() != null && entry.attribution().importedWriters() != null).findFirst();
            if (migrated.isPresent()) return migrated.get();
            if (history.isEmpty() || journal.attributed(document)) throw new IllegalArgumentException("Legacy history required");
        }
        var result = validator.importHistory(history.stream().map(DocumentJournal.Entry::update).toList());
        byte[] snapshot = Base64.getDecoder().decode(result.snapshot());
        synchronized (journal) {
            if (journal.attributed(document) || journal.read(document).size() != history.size()) throw new StaleVersion();
            var attribution = new DocumentJournal.Attribution(UUID.randomUUID(), 0, snapshot, List.of(), List.of(), true, result.importedWriters());
            var entry = new DocumentJournal.Entry(history.size() + 1, authenticatedActor, now(), snapshot, attribution);
            journal.appendVersioned(document, new DocumentJournal.Record(2, entry, null));
            return entry;
        }
    }

    public DocumentJournal.Entry submit(DocumentId document, UUID authenticatedActor, long writerId,
                                        UUID operationId, byte[] update) throws IOException {
        return submit(document, authenticatedActor, writerId, operationId, update, false);
    }

    public DocumentJournal.Entry seed(DocumentId document, UUID authenticatedActor, long writerId,
                                      UUID operationId, byte[] update) throws IOException {
        return submit(document, authenticatedActor, writerId, operationId, update, true);
    }

    private DocumentJournal.Entry submit(DocumentId document, UUID authenticatedActor, long writerId,
                                        UUID operationId, byte[] update, boolean imported) throws IOException {
        Objects.requireNonNull(authenticatedActor); Objects.requireNonNull(operationId);
        if (update == null || update.length == 0 || update.length > DocumentJournal.MAX_UPDATE)
            throw new IllegalArgumentException("Invalid update size");
        byte[] captured = update.clone();
        State before;
        synchronized (journal) {
            before = state(document);
            DocumentJournal.Entry previous = previous(before, authenticatedActor, writerId, operationId, captured);
            if (previous != null) {
                if (previous.attribution().imported() != imported) throw new IllegalArgumentException("Operation kind changed");
                return previous;
            }
            if (imported && before.sequence != 0) throw new IllegalArgumentException("Document already initialized");
        }
        // Validation is expensive and must not block journals for unrelated documents.
        if (before.snapshot == null) {
            var entries = journal.read(document);
            before.snapshot = journal.snapshot(document, entries, before.sequence - 1, validator);
        }
        var result = validator.validate(before.snapshot, captured, writerId);
        var attribution = new DocumentJournal.Attribution(operationId, writerId,
                Base64.getDecoder().decode(result.snapshot()), imported ? List.of() : ranges(result.inserted()),
                imported ? List.of() : ranges(result.deleted()), imported);
        synchronized (journal) {
            State current = state(document);
            DocumentJournal.Entry previous = previous(current, authenticatedActor, writerId, operationId, captured);
            if (previous != null) {
                if (previous.attribution().imported() != imported) throw new IllegalArgumentException("Operation kind changed");
                return previous;
            }
            if (current.sequence != before.sequence) throw new StaleVersion();
            var entry = new DocumentJournal.Entry(current.sequence + 1, authenticatedActor, now(), captured, attribution);
            journal.appendVersioned(document, new DocumentJournal.Record(2, entry, null));
            return entry;
        }
    }

    private DocumentJournal.Entry previous(State state, UUID actor, long writer, UUID operation, byte[] bytes) {
        var binding = state.bindings.get(writer);
        if (binding == null || !binding.actorId().equals(actor)) throw new DocumentAuthorization.Denied(4403);
        var entry = state.operations.get(new Operation(actor, operation));
        if (entry != null && (entry.attribution().writerId() != writer || !Arrays.equals(entry.update(), bytes)))
            throw new IllegalArgumentException("Operation ID already used with different content or writer");
        return entry;
    }

    private State state(DocumentId document) throws IOException {
        if (document == null || document.projectId() == null || document.workstreamId() == null
                || document.documentId() == null || !document.documentId().matches("[A-Za-z0-9._-]{1,128}"))
            throw new IllegalArgumentException("Invalid document scope");
        var result = new State();
        for (var record : journal.readRecords(document)) {
            if (record.checkpoint() != null) continue;
            if (record.version() == 1) {
                result.sequence = record.entry().sequence();
                result.legacy = true;
                continue;
            }
            if (record.binding() != null) {
                if (result.legacy && !result.migrated) throw new IOException("Missing legacy import");
                var binding = record.binding();
                if (result.importedWriters.contains(binding.writerId()) || result.bindings.putIfAbsent(binding.writerId(), binding) != null
                        || result.registrations.putIfAbsent(new Operation(binding.actorId(), binding.requestId()), binding) != null)
                    throw new IOException("Conflicting durable writer binding");
            } else {
                var entry = record.entry();
                var provenance = entry.attribution();
                if (provenance.importedWriters() != null) {
                    if (!result.legacy || result.migrated || entry.sequence() != result.sequence + 1)
                        throw new IOException("Invalid legacy import position");
                    result.importedWriters.addAll(provenance.importedWriters());
                    result.migrated = true;
                    result.sequence = entry.sequence();
                    result.snapshot = provenance.snapshot();
                    continue;
                }
                if (result.legacy && !result.migrated) throw new IOException("Missing legacy import");
                var binding = result.bindings.get(provenance.writerId());
                if (binding == null || !binding.actorId().equals(entry.actorId())
                        || provenance.inserted().stream().anyMatch(range -> range.clientId() != provenance.writerId())
                        || result.operations.putIfAbsent(new Operation(entry.actorId(), provenance.operationId()), entry) != null)
                    throw new IOException("Conflicting durable edit provenance");
                result.sequence = entry.sequence();
                result.snapshot = provenance.snapshot();
            }
        }
        if (result.legacy && !result.migrated) throw new LegacyHistory();
        return result;
    }

    private static List<DocumentJournal.EditRange> ranges(List<DocumentUpdateValidator.Range> ranges) {
        return ranges.stream().map(range -> new DocumentJournal.EditRange(range.clientId(), range.clock(), range.length())).toList();
    }
    private static Instant now() { return Instant.ofEpochMilli(System.currentTimeMillis()); }
    private record Operation(UUID actor, UUID id) { }
    private static final class State {
        final Map<Long, DocumentJournal.WriterBinding> bindings = new HashMap<>();
        final Map<Operation, DocumentJournal.WriterBinding> registrations = new HashMap<>();
        final Map<Operation, DocumentJournal.Entry> operations = new HashMap<>();
        final Set<Long> importedWriters = new HashSet<>();
        boolean legacy, migrated;
        int sequence;
        byte[] snapshot = {0, 0};
    }
    public static final class StaleVersion extends IllegalStateException {
        StaleVersion() { super("Document changed during validation; retry the same operation"); }
    }
    public static final class LegacyHistory extends IllegalStateException {
        LegacyHistory() { super("Existing history has unknown authorship; explicit import is required before attribution"); }
    }
}
