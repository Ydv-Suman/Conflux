package com.conflux.identityservice.security;

import com.conflux.identityservice.shared.config.WebConfig;
import com.conflux.identityservice.user.controller.UserController;
import com.conflux.identityservice.auth.controller.AuthController;
import com.conflux.identityservice.team.controller.TeamController;
import com.conflux.identityservice.auth.service.AuthService;
import com.conflux.identityservice.user.service.IUserService;
import com.conflux.identityservice.shared.service.RateLimitService;
import com.conflux.identityservice.team.service.TeamService;
import com.conflux.identityservice.team.service.TeamInvitationService;
import com.conflux.identityservice.team.controller.TeamInvitationController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

import jakarta.servlet.http.Cookie;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;

@WebMvcTest({UserController.class, AuthController.class, TeamController.class, TeamInvitationController.class})
@Import({ServiceSecurityConfig.class, PathConfig.class, WebConfig.class,
        ServiceSecurityConfigTests.StubConfig.class})
class ServiceSecurityConfigTests {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private IUserService userService;

    @Test
    void registrationDoesNotRequireCsrfToken() throws Exception {
        mvc.perform(post("/api/users")
                        .contentType("application/json")
                        .content("""
                                {"firstName":"First","lastName":"Last","username":"test.user",
                                 "email":"user@example.com","password":"LongPassword1!",
                                 "confirmPassword":"LongPassword1!"}
                                """))
                .andExpect(status().isAccepted());
    }

    @Test
    void invalidRegistrationReturnsBadRequestWithoutEchoingPassword() throws Exception {
        mvc.perform(post("/api/users")
                        .contentType("application/json")
                        .content("""
                                {"firstName":"First","lastName":"Last","username":"test.user",
                                 "email":"user@example.com","password":"Short1!",
                                 "confirmPassword":"Short1!"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(not(containsString("Short1!"))));
    }

    @Test
    void cookieLogoutIgnoresAnExpiredBearerToken() throws Exception {
        mvc.perform(post("/api/auth/logout")
                        .header("Origin", "http://localhost:5173")
                        .header("Authorization", "Bearer expired-token")
                        .cookie(new Cookie("conflux_refresh", "opaque-refresh-token")))
                .andExpect(status().isNoContent());
    }

    @Test
    void userCrudRequiresAuthentication() throws Exception {
        mvc.perform(get("/api/users/me")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/users/me").contentType("application/json").content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/users/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void teamRoutesRequireAuthentication() throws Exception {
        mvc.perform(get("/api/teams")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/teams")
                        .contentType("application/json")
                        .content("{\"name\":\"Payments\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void authenticatedUserCanAccessOnlyOwnProfileRoute() throws Exception {
        java.util.UUID userId = java.util.UUID.randomUUID();
        mvc.perform(get("/api/users/me").with(jwt().jwt(token -> token.subject(userId.toString()))))
                .andExpect(status().isOk());
        org.mockito.Mockito.verify(userService).getUser(userId);
    }

    @Test
    void invitationRoutesRequireAuthentication() throws Exception {
        String id = java.util.UUID.randomUUID().toString();
        mvc.perform(get("/api/users/me/invitations")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/teams/" + id + "/invitations")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/invitations/" + id + "/accept")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/invitations/" + id + "/decline")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/teams/" + id + "/invitations/" + id)).andExpect(status().isUnauthorized());
    }

    @Test
    void invitationInboxUsesAuthenticatedSubject() throws Exception {
        var id = java.util.UUID.randomUUID();
        mvc.perform(get("/api/users/me/invitations").with(jwt().jwt(token -> token.subject(id.toString()))))
                .andExpect(status().isOk());
        org.mockito.Mockito.verify(invitationService).inbox(id);
    }

    @Autowired
    private TeamInvitationService invitationService;

    @Test
    void oldAddMemberRouteCreatesInvitationInstead() throws Exception {
        var actorId = java.util.UUID.randomUUID();
        var teamId = java.util.UUID.randomUUID();
        mvc.perform(post("/api/teams/" + teamId + "/members")
                        .with(jwt().jwt(token -> token.subject(actorId.toString())))
                        .contentType("application/json")
                        .content("{\"email\":\"target@example.com\",\"role\":\"DEVELOPER\"}"))
                .andExpect(status().isCreated());
        org.mockito.Mockito.verify(invitationService).invite(org.mockito.ArgumentMatchers.eq(actorId),
                org.mockito.ArgumentMatchers.eq(teamId), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void invalidInvitationRequestReturnsBadRequest() throws Exception {
        var id = java.util.UUID.randomUUID();
        mvc.perform(post("/api/teams/" + id + "/invitations")
                        .with(jwt().jwt(token -> token.subject(id.toString())))
                        .contentType("application/json").content("{\"email\":\"invalid\"}"))
                .andExpect(status().isBadRequest());
    }

    @TestConfiguration
    static class StubConfig {

        @Bean
        IUserService userService() {
            return mock(IUserService.class);
        }

        @Bean
        RateLimitService rateLimitService() {
            return mock(RateLimitService.class);
        }

        @Bean
        AuthService authService() {
            return mock(AuthService.class);
        }

        @Bean
        TeamService teamService() {
            return mock(TeamService.class);
        }

        @Bean
        TeamInvitationService teamInvitationService() {
            return mock(TeamInvitationService.class);
        }

        @Bean
        JwtDecoder jwtDecoder() {
            return token -> null;
        }
    }
}
