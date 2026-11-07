package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
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

    DocumentHistoryController(DocumentAuthorization authorization, DocumentJournal journal,
                              FileTreeStore tree, DocumentUpdateValidator validator) {
        this.authorization = authorization; this.journal = journal; this.tree = tree; this.validator = validator;
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
            var entries = journal.read(document).reversed().stream().filter(entry -> entry.sequence() < before && visible(entry))
                    .limit(limit + 1L).toList();
            var items = entries.stream().limit(limit).map(DocumentHistoryController::version).toList();
            return new HistoryPage(file.path(), file.deleted(), items, entries.size() > limit ? items.getLast().sequence() : null);
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
            var entries = journal.read(document);
            int index = -1;
            for (int i = 0; i < entries.size(); i++) if (entries.get(i).sequence() == sequence) { index = i; break; }
            if (index < 0 || !visible(entries.get(index))) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            // Read one journal snapshot so a concurrent append cannot change either side of this diff.
            String before = snapshot(entries, index - 1), after = snapshot(entries, index);
            return new VersionDiff(file.path(), file.deleted(), version(entries.get(index)),
                    index == 0 ? 0 : entries.get(index - 1).sequence(), before, after);
        });
    }

    private String snapshot(List<DocumentJournal.Entry> entries, int index) {
        if (index < 0) return "AAA=";
        var attribution = entries.get(index).attribution();
        if (attribution != null) return Base64.getEncoder().encodeToString(attribution.snapshot());
        // shortcut: replay bounded legacy prefixes; use a historical snapshot index if demand grows.
        return validator.importHistory(entries.subList(0, index + 1).stream().map(DocumentJournal.Entry::update).toList()).snapshot();
    }

    private FileTreeStore.Document file(DocumentId document) throws Exception {
        return tree.documents(document.projectId(), document.workstreamId()).stream()
                .filter(file -> file.id().equals(document.documentId())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private static boolean visible(DocumentJournal.Entry entry) {
        return entry.attribution() == null || entry.attribution().imported() || entry.attribution().changed();
    }

    private static Version version(DocumentJournal.Entry entry) {
        var attribution = entry.attribution();
        String kind = attribution == null ? "LEGACY_UPDATE" : attribution.importedWriters() != null ? "MIGRATION_BASELINE"
                : attribution.imported() ? "IMPORTED_BASELINE" : "ATTRIBUTED_EDIT";
        return new Version(entry.sequence(), entry.actorId(), entry.timestamp(), kind);
    }

    private <T> Mono<T> authorized(DocumentId document, UUID team, String header, Callable<T> action) {
        if (!document.documentId().matches("[A-Za-z0-9._-]{1,128}"))
            return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        String token = header.startsWith("Bearer ") ? header.substring(7) : "";
        return authorization.authorizeHistory(document, new DocumentAuthorization.Credentials(team, token))
                .flatMap(ignored -> Mono.fromCallable(action).subscribeOn(Schedulers.boundedElastic()))
                .onErrorMap(DocumentAuthorization.Denied.class, denied -> new ResponseStatusException(
                        denied.code == 4401 ? HttpStatus.UNAUTHORIZED : denied.code == 4403 ? HttpStatus.FORBIDDEN : HttpStatus.SERVICE_UNAVAILABLE))
                .onErrorMap(DocumentUpdateValidator.Rejected.class,
                        error -> new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "This historical version cannot be reconstructed"))
                .onErrorMap(error -> !(error instanceof ResponseStatusException), error -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE));
    }

    record Version(int sequence, UUID actorId, Instant timestamp, String kind) { }
    record HistoryPage(String path, boolean deleted, List<Version> items, Integer nextBefore) { }
    record VersionDiff(String path, boolean deleted, Version version, int beforeSequence, String before, String after) { }
}
