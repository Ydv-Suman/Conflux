package com.conflux.collaborationservice.shared;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

@Component
public class DocumentAuthorization {
    private final WebClient identity;
    private final WebClient workspace;

    DocumentAuthorization(WebClient.Builder builder,
            @Value("${app.identity-url}") String identityUrl,
            @Value("${app.workspace-url}") String workspaceUrl) {
        identity = builder.clone().baseUrl(identityUrl).build();
        workspace = builder.clone().baseUrl(workspaceUrl).build();
    }

    public Mono<UUID> authorize(DocumentId document, Credentials credentials) {
        if (credentials == null || credentials.teamId() == null || credentials.token() == null
                || credentials.token().isBlank() || credentials.token().length() > 8192) {
            return Mono.error(new Denied(4401));
        }
        var membership = identity.get().uri("/api/teams/{id}/capabilities/me", credentials.teamId())
                .headers(headers -> headers.setBearerAuth(credentials.token()))
                .header("Accept", "application/vnd.conflux+json;v=1.0")
                .retrieve().bodyToMono(Membership.class);
        var stream = workspace.get().uri("/api/projects/{project}/teams/{team}/workstreams/{stream}",
                        document.projectId(), credentials.teamId(), document.workstreamId())
                .headers(headers -> headers.setBearerAuth(credentials.token()))
                .header("Accept", "application/vnd.conflux+json;v=1.0")
                .retrieve().bodyToMono(Workstream.class);
        // Both services validate the bearer token. Actor identity never comes from the socket client.
        return Mono.zip(membership, stream).map(result -> {
            Membership member = result.getT1();
            Workstream workstream = result.getT2();
            if (member.userId() == null || !credentials.teamId().equals(member.teamId())
                    || member.capabilities() == null
                    || !member.capabilities().containsAll(Set.of("JOIN_WORKSTREAM", "EDIT_DOCUMENT"))
                    || !document.projectId().equals(workstream.projectId())
                    || !document.workstreamId().equals(workstream.workstreamId())
                    || !credentials.teamId().equals(workstream.teamId()) || !workstream.repositoryReady()
                    || !Set.of("CREATED", "ACTIVE", "REVIEWING", "READY_TO_MERGE", "BLOCKED", "CONFLICT")
                            .contains(workstream.status() == null ? "" : workstream.status())) {
                throw new Denied(4403);
            }
            return member.userId();
        }).switchIfEmpty(Mono.error(new Denied(4403))).timeout(Duration.ofSeconds(3))
                .onErrorMap(WebClientResponseException.class, error ->
                        new Denied(error.getStatusCode().value() == 401 ? 4401
                                : error.getStatusCode().is4xxClientError() ? 4403 : 1013));
    }

    public record Credentials(UUID teamId, String token) {
        @Override public String toString() { return "Credentials[redacted]"; }
    }
    record Membership(UUID teamId, UUID userId, Set<String> capabilities) { }
    record Workstream(UUID projectId, UUID teamId, UUID workstreamId, boolean repositoryReady, String status) { }
    public static final class Denied extends RuntimeException {
        public final int code;
        public Denied(int code) { super("Document access denied"); this.code = code; }
    }
}
