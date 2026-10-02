package com.conflux.identity_service.service;

import com.conflux.identity_service.entity.ExternalIdentity;
import com.conflux.identity_service.entity.User;
import com.conflux.identity_service.exception.IdentityAlreadyLinkedException;
import com.conflux.identity_service.repository.ExternalIdentityRepository;
import com.conflux.identity_service.repository.UserRepository;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ExternalIdentityServiceTests {

    private ExternalIdentity linkedIdentity;
    private final User user = user(UUID.randomUUID());
    private final ExternalIdentityRepository identityRepository =
            (ExternalIdentityRepository) Proxy.newProxyInstance(
                    ExternalIdentityRepository.class.getClassLoader(),
                    new Class<?>[]{ExternalIdentityRepository.class},
                    (proxy, method, arguments) -> switch (method.getName()) {
                        case "findByProviderAndProviderSubject" -> Optional.ofNullable(linkedIdentity);
                        case "existsByUserUserIdAndProvider" -> linkedIdentity != null;
                        case "save" -> linkedIdentity = (ExternalIdentity) arguments[0];
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
    private final UserRepository userRepository = (UserRepository) Proxy.newProxyInstance(
            UserRepository.class.getClassLoader(),
            new Class<?>[]{UserRepository.class},
            (proxy, method, arguments) -> {
                if (method.getName().equals("findById")) {
                    return Optional.of(user);
                }
                throw new UnsupportedOperationException(method.getName());
            });
    private final ExternalIdentityService service =
            new ExternalIdentityService(identityRepository, userRepository);

    @Test
    void githubIdentityAlwaysResolvesToItsLinkedUser() {
        service.linkGithub(user.getUserId(), "12345");
        service.linkGithub(user.getUserId(), "12345");

        assertEquals(user.getUserId(), service.resolveGithubUser("12345").orElseThrow());
        assertThrows(IdentityAlreadyLinkedException.class,
                () -> service.linkGithub(UUID.randomUUID(), "12345"));
    }

    private static User user(UUID userId) {
        User user = new User();
        user.setUserId(userId);
        return user;
    }
}
