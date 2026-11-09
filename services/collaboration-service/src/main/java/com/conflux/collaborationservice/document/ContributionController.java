package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.filetree.FileTreeStore;
import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.Callable;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequestMapping("/api/projects/{projectId}/teams/{teamId}/workstreams/{workstreamId}/contributions")
class ContributionController {
    private final DocumentAuthorization authorization;
    private final DocumentJournal journal;
    private final FileTreeStore tree;
    private final DocumentUpdateValidator validator;

    ContributionController(DocumentAuthorization authorization, DocumentJournal journal, FileTreeStore tree, DocumentUpdateValidator validator) {
        this.authorization = authorization;
        this.journal = journal;
        this.tree = tree;
        this.validator = validator;
    }

    @GetMapping
    Mono<Report> report(@PathVariable UUID projectId, @PathVariable UUID teamId, @PathVariable UUID workstreamId,
            @RequestHeader(name = "Authorization", defaultValue = "") String header,
            @RequestParam(required = false) Instant from, @RequestParam(required = false) Instant until,
            @RequestParam(defaultValue = "false") boolean allTime,
            @RequestParam(required = false) UUID actorId, @RequestParam(required = false) String documentId,
            @RequestParam(defaultValue = "0") int offset,
            ServerHttpResponse response) {
        response.getHeaders().setCacheControl("no-store");
        if (offset < 0 || offset > 100_000 || (!allTime && (from == null || until == null || !from.isBefore(until) || Duration.between(from, until).compareTo(Duration.ofDays(366)) > 0)))
            return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a window of at most 366 days"));
        return authorized(projectId, teamId, workstreamId, header,
                () -> summarize(projectId, workstreamId, allTime ? Instant.EPOCH : from, allTime ? Instant.now() : until, actorId, documentId, offset));
    }

    Report summarize(UUID projectId, UUID workstreamId, Instant from, Instant until, UUID actorId, String documentId, int offset) throws Exception {
        var documents = tree.documents(projectId, workstreamId);
        if (documentId != null && documents.stream().noneMatch(file -> file.id().equals(documentId)))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Map<UUID, Totals> totals = new TreeMap<>();
        Map<UUID, Long> unverified = new TreeMap<>();
        List<Change> recent = new ArrayList<>();
        Map<DayKey, Daily> days = new HashMap<>();
        int noHistory = 0, legacyFiles = 0, importedFiles = 0, unknownRecords = 0, scanned = 0, matching = 0;
        for (var file : documents) {
            if (documentId != null && !file.id().equals(documentId)) continue;
            var entries = journal.read(new DocumentId(projectId, workstreamId, file.id()));
            // shortcut: bounded journal scan; replace with a reporting index before larger workstreams need it.
            scanned += entries.size();
            if (scanned > 100_000) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Report exceeds scan limit; select a file");
            if (entries.isEmpty()) noHistory++;
            if (entries.stream().anyMatch(entry -> entry.attribution() == null)) legacyFiles++;
            if (entries.stream().anyMatch(entry -> entry.attribution() != null && entry.attribution().imported())) importedFiles++;
            for (var entry : entries) {
                if (entry.timestamp().isBefore(from) || !entry.timestamp().isBefore(until)) continue;
                var attribution = entry.attribution();
                if (attribution == null || attribution.imported()) {
                    unknownRecords++;
                    if (actorId == null || actorId.equals(entry.actorId())) unverified.merge(entry.actorId(), 1L, Long::sum);
                    continue;
                }
                if (!attribution.changed() || (actorId != null && !actorId.equals(entry.actorId()))) continue;
                long inserted = units(attribution.inserted()), deleted = units(attribution.deleted());
                Totals total = totals.computeIfAbsent(entry.actorId(), ignored -> new Totals());
                total.edits++; total.inserted += inserted; total.deleted += deleted; total.files.add(file.id());
                var day = entry.timestamp().atZone(ZoneOffset.UTC).toLocalDate().toString();
                var key = new DayKey(file.id(), entry.actorId(), day);
                Daily daily = days.computeIfAbsent(key, ignored -> new Daily(file, entry.actorId(), day));
                daily.edits++; daily.inserted += inserted; daily.deleted += deleted;
                matching++;
                recent.add(new Change(file.id(), file.path(), file.deleted(), entry.sequence(), entry.actorId(),
                        entry.timestamp(), attribution.operationId(), inserted, deleted));
                if (recent.size() > offset + 200) trim(recent, offset + 100);
            }
        }
        trim(recent, offset + 100);
        var page = recent.stream().skip(offset).toList();
        var members = totals.entrySet().stream().map(item -> new Member(item.getKey(), item.getValue().edits,
                item.getValue().inserted, item.getValue().deleted, item.getValue().files.size())).toList();
        var dailyPage = days.values().stream().sorted(Comparator.comparing((Daily item) -> item.day).reversed()
                .thenComparing(item -> item.file.id()).thenComparing(item -> item.actorId))
                .skip(offset).limit(100).map(item -> new DailyChange(item.file.id(), item.file.path(), item.file.deleted(),
                        item.actorId, item.day, item.edits, item.inserted, item.deleted)).toList();
        return new Report(Instant.now(), from, until, documents, members, page, matching, offset, dailyPage, days.size(),
                unverified.entrySet().stream().map(item -> new UnverifiedMember(item.getKey(), item.getValue())).toList(),
                noHistory, legacyFiles, importedFiles, unknownRecords);
    }

    private static long units(List<DocumentJournal.EditRange> ranges) {
        return ranges.stream().mapToLong(DocumentJournal.EditRange::length).sum();
    }

    private static void trim(List<Change> changes, int limit) {
        changes.sort(Comparator.comparing(Change::timestamp).reversed().thenComparing(Change::documentId)
                .thenComparing(Comparator.comparingInt(Change::sequence).reversed()));
        if (changes.size() > limit) changes.subList(limit, changes.size()).clear();
    }

    @GetMapping("/documents/{documentId}/changes/{sequence}")
    Mono<Evidence> evidence(@PathVariable UUID projectId, @PathVariable UUID teamId, @PathVariable UUID workstreamId,
            @PathVariable String documentId, @PathVariable int sequence,
            @RequestHeader(name = "Authorization", defaultValue = "") String header, ServerHttpResponse response) {
        response.getHeaders().setCacheControl("no-store");
        return authorized(projectId, teamId, workstreamId, header, () -> {
            if (sequence < 1 || tree.documents(projectId, workstreamId).stream().noneMatch(file -> file.id().equals(documentId)))
                throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            var document = new DocumentId(projectId, workstreamId, documentId);
            var entries = journal.read(document);
            var entry = entries.stream().filter(item -> item.sequence() == sequence).findFirst()
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
            if (entry.attribution() == null || entry.attribution().imported() || !entry.attribution().changed())
                throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            int index = entries.indexOf(entry);
            byte[] before = snapshot(document, entries, index - 1);
            byte[] after = snapshot(document, entries, index);
            return new Evidence(entry.sequence(), entry.actorId(), entry.timestamp(), entry.attribution().operationId(),
                    Base64.getEncoder().encodeToString(before), Base64.getEncoder().encodeToString(after));
        });
    }

    private byte[] snapshot(DocumentId document, List<DocumentJournal.Entry> entries, int index) {
        if (index < 0) return new byte[]{0, 0};
        var attribution = entries.get(index).attribution();
        return attribution != null && attribution.snapshot() != null ? attribution.snapshot() : journal.snapshot(document, entries, index, validator);
    }

    private <T> Mono<T> authorized(UUID project, UUID team, UUID stream, String header, Callable<T> read) {
        String token = header.startsWith("Bearer ") ? header.substring(7) : "";
        return authorization.authorizeContributions(new DocumentId(project, stream, "contributions"),
                        new DocumentAuthorization.Credentials(team, token))
                .flatMap(ignored -> Mono.fromCallable(read).subscribeOn(Schedulers.boundedElastic()))
                .onErrorMap(DocumentAuthorization.Denied.class, denied -> new ResponseStatusException(
                        denied.code == 4401 ? HttpStatus.UNAUTHORIZED : denied.code == 4403 ? HttpStatus.FORBIDDEN : HttpStatus.SERVICE_UNAVAILABLE))
                .onErrorMap(error -> !(error instanceof ResponseStatusException),
                        error -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE));
    }

    private record DayKey(String documentId, UUID actorId, String day) { }
    private static class Daily {
        final FileTreeStore.Document file; final UUID actorId; final String day;
        long edits, inserted, deleted;
        Daily(FileTreeStore.Document file, UUID actorId, String day) { this.file = file; this.actorId = actorId; this.day = day; }
    }
    record DailyChange(String documentId, String path, boolean deletedFile, UUID actorId, String day,
                       long edits, long inserted, long deleted) { }
    private static class Totals { long edits, inserted, deleted; Set<String> files = new HashSet<>(); }
    record UnverifiedMember(UUID actorId, long records) { }
    record Member(UUID actorId, long edits, long inserted, long deleted, int files) { }
    record Change(String documentId, String path, boolean deletedFile, int sequence, UUID actorId,
                  Instant timestamp, UUID operationId, long inserted, long deleted) { }
    record Report(Instant generatedAt, Instant from, Instant until, List<FileTreeStore.Document> documents,
                  List<Member> members, List<Change> changes, int matchingChanges, int offset, List<DailyChange> dailyChanges, int matchingDays, List<UnverifiedMember> unverifiedMembers,
                  int filesWithoutHistory, int legacyFiles, int importedFiles, int unknownRecords) { }
    record Evidence(int sequence, UUID actorId, Instant timestamp, UUID operationId, String before, String after) { }
}
