package com.conflux.workspaceservice.security;

import com.conflux.workspaceservice.project.controller.ProjectController;
import com.conflux.workspaceservice.project.service.ProjectService;
import com.conflux.workspaceservice.shared.config.WebConfig;
import com.conflux.workspaceservice.workstream.controller.WorkstreamController;
import com.conflux.workspaceservice.workstream.service.WorkstreamService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({ProjectController.class, WorkstreamController.class})
@Import({ServiceSecurityConfig.class, WebConfig.class, ServiceSecurityConfigTests.StubConfig.class})
class ServiceSecurityConfigTests {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ProjectService projects;

    @Test
    void projectRoutesRequireAuthentication() throws Exception {
        mvc.perform(get("/api/projects"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/projects")
                        .contentType("application/json")
                        .content("{\"name\":\"Conflux\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void authenticatedProjectRequestUsesTokenSubject() throws Exception {
        UUID actorId = UUID.randomUUID();
        mvc.perform(get("/api/projects")
                        .with(jwt().jwt(token -> token.subject(actorId.toString()))))
                .andExpect(status().isOk());

        verify(projects).list(actorId);
    }

    @Test
    void authenticatedProjectDeleteUsesTokenSubject() throws Exception {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();

        mvc.perform(delete("/api/projects/{projectId}", projectId)
                        .with(jwt().jwt(token -> token.subject(actorId.toString()))))
                .andExpect(status().isNoContent());

        verify(projects).delete(actorId, projectId);
    }

    @Test
    void blankProjectNameIsRejected() throws Exception {
        UUID actorId = UUID.randomUUID();

        mvc.perform(post("/api/projects")
                        .with(jwt().jwt(token -> token.subject(actorId.toString())))
                        .contentType("application/json")
                        .content("{\"name\":\"   \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void workstreamRoutesRequireAuthentication() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();

        mvc.perform(get("/api/projects/{projectId}/teams/{teamId}/workstreams", projectId, teamId))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void unsafeBranchNameIsRejected() throws Exception {
        UUID actorId = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID teamId = UUID.randomUUID();

        mvc.perform(post("/api/projects/{projectId}/teams/{teamId}/workstreams", projectId, teamId)
                        .with(jwt().jwt(token -> token.subject(actorId.toString())))
                        .contentType("application/json")
                        .content("""
                                {"name":"Unsafe","branchName":"../main","baseRevision":"abcdef1"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Autowired
    private WorkstreamService workstreams;

    @Test
    void defaultLookupUsesTokenSubjectAndLiteralRoute() throws Exception {
        UUID actorId = UUID.randomUUID(); UUID projectId = UUID.randomUUID(); UUID teamId = UUID.randomUUID();
        mvc.perform(get("/api/projects/{projectId}/teams/{teamId}/workstreams/default", projectId, teamId)
                .with(jwt().jwt(token -> token.subject(actorId.toString())))).andExpect(status().isOk());
        verify(workstreams).getDefault(actorId, projectId, teamId);
    }

    @Test
    void defaultRoutesRequireAuthentication() throws Exception {
        UUID projectId = UUID.randomUUID(); UUID teamId = UUID.randomUUID();
        mvc.perform(get("/api/projects/{projectId}/teams/{teamId}/workstreams/default", projectId, teamId))
                .andExpect(status().isUnauthorized());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                "/api/projects/{projectId}/teams/{teamId}/workstreams/default/repository", projectId, teamId)
                .contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void repositoryRoutesRequireAuthenticationAndUseTokenSubject() throws Exception {
        UUID actorId = UUID.randomUUID(); UUID projectId = UUID.randomUUID();
        String path = "/api/projects/" + projectId + "/repository";
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path)
                .contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(get(path).with(jwt().jwt(token -> token.subject(actorId.toString()))))
                .andExpect(status().isNoContent());
        verify(projects).getRepository(actorId, projectId);
        String json = """
                {"repositoryUrl":"https://git.example.com/team/repo.git","accessMode":"PUBLIC",
                 "canonicalBranch":"main","canonicalRevision":"%s","expectedVersion":0}
                """.formatted("a".repeat(40));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path)
                .with(jwt().jwt(token -> token.subject(actorId.toString())))
                .contentType("application/json").content(json)).andExpect(status().isOk());
        verify(projects).updateRepository(org.mockito.ArgumentMatchers.eq(actorId), org.mockito.ArgumentMatchers.eq(projectId),
                org.mockito.ArgumentMatchers.argThat(request -> request.expectedVersion() == 0L
                        && request.canonicalRevision().equals("a".repeat(40))));
    }

    @Test
    void repositoryConfigurationRejectsCredentialsAndMissingVersion() throws Exception {
        String path = "/api/projects/" + UUID.randomUUID() + "/repository";
        for (String json : new String[]{
                """
                {"repositoryUrl":"https://user:secret@git.example.com/repo","accessMode":"PUBLIC",
                 "canonicalBranch":"main","canonicalRevision":"%s","expectedVersion":0}
                """.formatted("a".repeat(40)),
                """
                {"repositoryUrl":"https://git.example.com/repo","accessMode":"PUBLIC",
                 "canonicalBranch":"main","canonicalRevision":"%s"}
                """.formatted("a".repeat(40))}) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path)
                    .with(jwt().jwt(token -> token.subject(UUID.randomUUID().toString())))
                    .contentType("application/json").content(json)).andExpect(status().isBadRequest());
        }
    }

    @TestConfiguration
    static class StubConfig {

        @Bean
        ProjectService projectService() {
            return mock(ProjectService.class);
        }

        @Bean
        WorkstreamService workstreamService() {
            return mock(WorkstreamService.class);
        }

        @Bean
        JwtDecoder jwtDecoder() {
            return token -> null;
        }
    }
}
