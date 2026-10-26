package com.conflux.collaborationservice;

import static org.junit.jupiter.api.Assertions.*;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class DocumentAuthorizationTests {
    final UUID project = UUID.randomUUID(), team = UUID.randomUUID(), stream = UUID.randomUUID(), actor = UUID.randomUUID();
    final DocumentId document = new DocumentId(project, stream, "main-ts");
    final DocumentAuthorization.Credentials credentials = new DocumentAuthorization.Credentials(team, "verified-by-identity");
    final List<ClientRequest> requests = new ArrayList<>();
    String membership, workstream;
    HttpStatus identityStatus = HttpStatus.OK, workspaceStatus = HttpStatus.OK;
    DocumentAuthorization authorization;

    @BeforeEach void setup() {
        membership = "{\"teamId\":\"" + team + "\",\"userId\":\"" + actor
                + "\",\"capabilities\":[\"JOIN_WORKSTREAM\",\"EDIT_DOCUMENT\"]}";
        workstream = "{\"projectId\":\"" + project + "\",\"teamId\":\"" + team + "\",\"workstreamId\":\""
                + stream + "\",\"repositoryReady\":true,\"status\":\"ACTIVE\"}";
        var builder = WebClient.builder().exchangeFunction(request -> {
            requests.add(request);
            boolean identity = request.url().getHost().equals("identity");
            return Mono.just(ClientResponse.create(identity ? identityStatus : workspaceStatus)
                    .header("Content-Type", "application/json").body(identity ? membership : workstream).build());
        });
        authorization = new DocumentAuthorization(builder, "http://identity", "http://workspace");
    }

    @Test void derivesActorFromIdentityAndVerifiesTheExactWorkspaceWithTheSameToken() {
        assertEquals(actor, authorization.authorize(document, credentials).block());
        assertEquals(2, requests.size());
        for (ClientRequest request : requests) {
            assertEquals("Bearer verified-by-identity", request.headers().getFirst("Authorization"));
            assertEquals("application/vnd.conflux+json;v=1.0", request.headers().getFirst("Accept"));
            assertNull(request.url().getQuery());
        }
        assertEquals("/api/projects/" + project + "/teams/" + team + "/workstreams/" + stream,
                requests.get(1).url().getPath());
        assertFalse(credentials.toString().contains(credentials.token()));
    }

    @Test void deniesViewersAndNonMembers() {
        membership = membership.replace("\"JOIN_WORKSTREAM\",\"EDIT_DOCUMENT\"", "\"VIEW_PROJECT\"");
        denied(4403);
        identityStatus = HttpStatus.FORBIDDEN;
        denied(4403);
    }

    @Test void deniesWrongTeamProjectWorkstreamAndUninitializedOrArchivedWorkspaces() {
        String valid = workstream;
        for (UUID id : List.of(project, team, stream)) {
            workstream = valid.replace(id.toString(), UUID.randomUUID().toString()); denied(4403);
        }
        workstream = valid.replace("true", "false"); denied(4403);
        workstream = valid.replace("ACTIVE", "ARCHIVED"); denied(4403);
        workstream = valid.replace("ACTIVE", "MERGED"); denied(4403);
        workstream = valid; membership = membership.replace(team.toString(), UUID.randomUUID().toString()); denied(4403);
    }

    @Test void treatsInvalidTokensAsAuthenticationFailureAndServiceOutagesAsUnavailable() {
        identityStatus = HttpStatus.UNAUTHORIZED; denied(4401);
        identityStatus = HttpStatus.OK; workspaceStatus = HttpStatus.NOT_FOUND; denied(4403);
        workspaceStatus = HttpStatus.SERVICE_UNAVAILABLE; denied(1013);
    }

    @Test void rejectsMissingCredentialsWithoutContactingServices() {
        assertThrows(DocumentAuthorization.Denied.class, () -> authorization.authorize(document,
                new DocumentAuthorization.Credentials(team, "")).block());
        assertThrows(DocumentAuthorization.Denied.class, () -> authorization.authorize(document,
                new DocumentAuthorization.Credentials(null, "token")).block());
        assertTrue(requests.isEmpty());
    }

    private void denied(int code) {
        assertEquals(code, assertThrows(DocumentAuthorization.Denied.class,
                () -> authorization.authorize(document, credentials).block()).code);
    }
}
