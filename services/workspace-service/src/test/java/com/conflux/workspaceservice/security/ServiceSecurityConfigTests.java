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
