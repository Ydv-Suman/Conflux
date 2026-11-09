package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Callable;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequestMapping("/api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}/documents/{documentId}/history")
class DocumentHistoryController {
    private final DocumentAuthorization authorization;
    private final DocumentJournal journal;
    private final FileTreeStore tree;
    private final DocumentUpdateValidator validator;
    private final DocumentCheckpoints checkpoints;
    private final Map<DocumentId, HistoryIndex> indexes = new LinkedHashMap<>(16, .75f, true);

    DocumentHistoryController(DocumentAuthorization authorization, DocumentJournal journal,
                              FileTreeStore tree, DocumentUpdateValidator validator, DocumentCheckpoints checkpoints) {
        this.authorization = authorization; this.journal = journal; this.tree = tree; this.validator = validator; this.checkpoints = checkpoints;
    }

    @PostMapping
    Mono<DocumentJournal.Checkpoint> create(@PathVariable UUID projectId, @PathVariable UUID teamId,
            @PathVariable UUID workstreamId, @PathVariable String documentId, @RequestBody CheckpointRequest request,
            @RequestHeader(name = "Authorization", defaultValue = "") String header, ServerHttpResponse response) {
        response.getHeaders().setCacheControl("no-store");
        var document = new DocumentId(projectId, workstreamId, documentId);
        if (!valid(document)) return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        String token = header.startsWith("Bearer ") ? header.substring(7) : "";
        return errors(authorization.authorize(document, new DocumentAuthorization.Credentials(teamId, token))
                .flatMap(actor -> Mono.fromCallable(() -> {
                    file(document);
                    try { return checkpoints.create(document, actor, request.requestId(), request.afterOperationId(), request.afterHash(), request.afterSequence()); }
                    catch (IllegalArgumentException invalid) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, invalid.getMessage()); }
                }).subscribeOn(Schedulers.boundedElastic())));
    }

    @GetMapping
    Mono<HistoryPage> history(@PathVariable UUID projectId, @PathVariable UUID teamId,
            @PathVariable UUID workstreamId, @PathVariable String documentId,
            @RequestHeader(name = "Authorization", defaultValue = "") String header,
            @RequestParam(defaultValue = "2147483647") int before, @RequestParam(defaultValue = "25") int limit,
            ServerHttpResponse response) {
        response.getHeaders().setCacheControl("no-store");
        if (before < 1 || limit < 1 || limit > 100) return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        var document = new DocumentId(projectId, workstreamId, documentId);
        return authorized(document, teamId, header, () -> {
            var file = file(document);
            List<DocumentJournal.Entry> entries;
            List<DocumentJournal.Checkpoint> versions;
            synchronized (journal) { entries = journal.read(document); versions = journal.checkpoints(document); }
            var page = indexedPage(document, entries, versions, before, limit);
            var items = page.stream().limit(limit).toList();
            return new HistoryPage(file.path(), file.deleted(), items, page.size() > limit ? items.getLast().versionNumber() : null);
        });
    }

    @GetMapping("/{sequence}")
    Mono<VersionDiff> diff(@PathVariable UUID projectId, @PathVariable UUID teamId,
            @PathVariable UUID workstreamId, @PathVariable String documentId, @PathVariable int sequence,
            @RequestHeader(name = "Authorization", defaultValue = "") String header, ServerHttpResponse response) {
        response.getHeaders().setCacheControl("no-store");
        if (sequence < 1) return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        var document = new DocumentId(projectId, workstreamId, documentId);
        return authorized(document, teamId, header, () -> {
            var file = file(document);
            List<DocumentJournal.Entry> entries;
            DocumentJournal.Checkpoint checkpoint;
            synchronized (journal) {
                entries = journal.read(document);
                checkpoint = journal.checkpoints(document).stream().filter(item -> item.created() && item.sequence() == sequence)
                        .findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            }
            return new VersionDiff(file.path(), file.deleted(), version(checkpoint, entries), checkpoint.beforeSequence(),
                    snapshot(document, entries, checkpoint.beforeSequence() - 1), snapshot(document, entries, checkpoint.sequence() - 1));
        });
    }

    private String snapshot(DocumentId document, List<DocumentJournal.Entry> entries, int index) {
        if (index < 0) return "AAA=";
        var attribution = entries.get(index).attribution();
        if (attribution != null && attribution.snapshot() != null) return Base64.getEncoder().encodeToString(attribution.snapshot());
        return Base64.getEncoder().encodeToString(journal.snapshot(document, entries, index, validator));
    }

    private FileTreeStore.Document file(DocumentId document) throws Exception {
        return tree.documents(document.projectId(), document.workstreamId()).stream()
                .filter(file -> file.id().equals(document.documentId())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private static Version version(DocumentJournal.Checkpoint checkpoint, List<DocumentJournal.Entry> entries) {
        var actors = new LinkedHashSet<UUID>();
        boolean unknown = false;
        for (int i = checkpoint.beforeSequence(); i < checkpoint.sequence(); i++) {
            var entry = entries.get(i);
            var attribution = entry.attribution();
            if (attribution == null || attribution.imported()) unknown = true;
            else if (attribution.changed()) actors.add(entry.actorId());
        }
        return new Version(checkpoint.sequence(), checkpoint.actorId(), checkpoint.timestamp(), unknown ? "CHECKPOINT_UNKNOWN" : "CHECKPOINT",
                checkpoint.beforeSequence() + 1, checkpoint.timestamp(), List.copyOf(actors), checkpoint.number());
    }

    private synchronized List<Version> indexedPage(DocumentId document, List<DocumentJournal.Entry> entries,
            List<DocumentJournal.Checkpoint> checkpoints, int before, int limit) {
        var index = indexes.computeIfAbsent(document, ignored -> new HistoryIndex());
        index.update(entries, checkpoints);
        while (indexes.size() > 32 || indexes.values().stream().mapToInt(item -> item.consumed).sum() > 100_000)
            indexes.remove(indexes.keySet().iterator().next());
        return index.versions.headMap(before, false).descendingMap().values().stream().limit(limit + 1L).toList();
    }

    private static final class HistoryIndex {
        final TreeMap<Integer, Version> versions = new TreeMap<>();
        int consumed;
        DocumentJournal.Checkpoint last;
        void update(List<DocumentJournal.Entry> entries, List<DocumentJournal.Checkpoint> checkpoints) {
            if (consumed > checkpoints.size() || (consumed > 0 && checkpoints.get(consumed - 1) != last)) {
                versions.clear(); consumed = 0;
            }
            for (int i = consumed; i < checkpoints.size(); i++) {
                var checkpoint = checkpoints.get(i);
                if (checkpoint.created()) versions.put(checkpoint.number(), version(checkpoint, entries));
            }
            consumed = checkpoints.size(); last = checkpoints.isEmpty() ? null : checkpoints.getLast();
        }
    }

    private static boolean valid(DocumentId document) { return document.documentId().matches("[A-Za-z0-9._-]{1,128}"); }
    private <T> Mono<T> authorized(DocumentId document, UUID team, String header, Callable<T> action) {
        if (!valid(document)) return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        String token = header.startsWith("Bearer ") ? header.substring(7) : "";
        return errors(authorization.authorizeHistory(document, new DocumentAuthorization.Credentials(team, token))
                .flatMap(ignored -> Mono.fromCallable(action).subscribeOn(Schedulers.boundedElastic())));
    }
    private <T> Mono<T> errors(Mono<T> source) {
        return source.onErrorMap(DocumentAuthorization.Denied.class, denied -> new ResponseStatusException(
                        denied.code == 4401 ? HttpStatus.UNAUTHORIZED : denied.code == 4403 ? HttpStatus.FORBIDDEN : HttpStatus.SERVICE_UNAVAILABLE))
                .onErrorMap(DocumentCheckpoints.ChangedDuringCheckpoint.class, error -> new ResponseStatusException(HttpStatus.CONFLICT, error.getMessage()))
                .onErrorMap(DocumentUpdateValidator.Rejected.class, error -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "This version cannot be reconstructed"))
                .onErrorMap(error -> !(error instanceof ResponseStatusException), error -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE));
    }

    record CheckpointRequest(UUID requestId, UUID afterOperationId, String afterHash, Integer afterSequence) { }
    record Version(int sequence, UUID actorId, Instant timestamp, String kind,
                   int firstSequence, Instant startedAt, List<UUID> actorIds, int versionNumber) { }
    record HistoryPage(String path, boolean deleted, List<Version> items, Integer nextBefore) { }
    record VersionDiff(String path, boolean deleted, Version version, int beforeSequence, String before, String after) { }
}
