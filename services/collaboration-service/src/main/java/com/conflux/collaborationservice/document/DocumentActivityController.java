package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
class DocumentActivityController {
    private final DocumentAuthorization authorization;
    private final DocumentJournal journal;

    DocumentActivityController(DocumentAuthorization authorization, DocumentJournal journal) {
        this.authorization = authorization;
        this.journal = journal;
    }

    @GetMapping("/api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}/documents/{documentId}/activity")
    Mono<ActivityPage> activity(@PathVariable UUID projectId, @PathVariable UUID teamId,
            @PathVariable UUID workstreamId, @PathVariable String documentId,
            @RequestHeader(name = "Authorization", defaultValue = "") String authorizationHeader,
            @RequestParam(defaultValue = "2147483647") int before,
            @RequestParam(defaultValue = "10") int limit) {
        if (limit < 1 || limit > 100 || before < 1 || !documentId.matches("[A-Za-z0-9._-]{1,128}"))
            return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
        String token = authorizationHeader.startsWith("Bearer ") ? authorizationHeader.substring(7) : "";
        DocumentId document = new DocumentId(projectId, workstreamId, documentId);
        return authorization.authorize(document, new DocumentAuthorization.Credentials(teamId, token))
                .flatMap(ignored -> Mono.fromCallable(() -> {
                    var entries = journal.read(document).reversed().stream().filter(entry -> entry.sequence() < before)
                            .limit(limit + 1L).toList();
                    List<Activity> items = entries.stream().limit(limit)
                            .map(entry -> new Activity(entry.sequence(), entry.actorId(), entry.timestamp())).toList();
                    return new ActivityPage(items, entries.size() > limit ? items.getLast().sequence() : null);
                }).subscribeOn(Schedulers.boundedElastic()))
                .onErrorMap(DocumentAuthorization.Denied.class, denied -> new ResponseStatusException(
                        denied.code == 4401 ? HttpStatus.UNAUTHORIZED
                                : denied.code == 4403 ? HttpStatus.FORBIDDEN : HttpStatus.SERVICE_UNAVAILABLE))
                .onErrorMap(error -> !(error instanceof ResponseStatusException),
                        error -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE));
    }

    record Activity(int sequence, UUID actorId, Instant timestamp) { }
    record ActivityPage(List<Activity> items, Integer nextBefore) { }
}
