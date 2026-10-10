package com.conflux.workspaceservice.identity.config;

import com.conflux.identityservice.grpc.team.v1.TeamAuthorizationGrpc;
import io.grpc.ClientInterceptor;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class IdentityGrpcClientConfig {

    @Bean(destroyMethod = "shutdown")
    ManagedChannel identityGrpcChannel(
            @Value("${app.identity.grpc-target}") String target,
            @Value("${app.identity.grpc-token}") String token,
            @Value("${app.identity.grpc-plaintext}") boolean plaintext) {
        ClientInterceptor authentication = new InternalGrpcTokenInterceptor(token);
        ManagedChannelBuilder<?> builder = ManagedChannelBuilder.forTarget(target);
        if (plaintext) {
            builder.usePlaintext();
        }
        return builder.intercept(authentication).build();
    }

    @Bean
    TeamAuthorizationGrpc.TeamAuthorizationBlockingStub teamAuthorizationStub(
            ManagedChannel identityGrpcChannel) {
        return TeamAuthorizationGrpc.newBlockingStub(identityGrpcChannel);
    }
}
