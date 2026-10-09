package com.conflux.identityservice.grpc.security;

import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.grpc.server.GlobalServerInterceptor;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
@GlobalServerInterceptor
public class InternalGrpcAuthenticationInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> INTERNAL_TOKEN = Metadata.Key.of(
            "x-conflux-internal-token", Metadata.ASCII_STRING_MARSHALLER);

    private final byte[] expectedToken;

    public InternalGrpcAuthenticationInterceptor(
            @Value("${app.grpc.internal-token}") String internalToken) {
        if (internalToken == null || internalToken.length() < 32) {
            throw new IllegalArgumentException("Internal gRPC token must contain at least 32 characters");
        }
        expectedToken = internalToken.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public <RequestT, ResponseT> ServerCall.Listener<RequestT> interceptCall(
            ServerCall<RequestT, ResponseT> call,
            Metadata headers,
            ServerCallHandler<RequestT, ResponseT> next) {
        String suppliedToken = headers.get(INTERNAL_TOKEN);
        if (suppliedToken == null || !MessageDigest.isEqual(
                expectedToken, suppliedToken.getBytes(StandardCharsets.UTF_8))) {
            call.close(Status.UNAUTHENTICATED.withDescription("Service authentication required"),
                    new Metadata());
            return new ServerCall.Listener<>() {
            };
        }
        return next.startCall(call, headers);
    }
}
