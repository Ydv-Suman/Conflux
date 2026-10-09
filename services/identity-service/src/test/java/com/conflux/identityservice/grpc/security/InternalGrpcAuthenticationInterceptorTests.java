package com.conflux.identityservice.grpc.security;

import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.Status;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class InternalGrpcAuthenticationInterceptorTests {

    private static final String TOKEN = "test-internal-service-token-32-characters";

    @Test
    void rejectsShortConfiguredToken() {
        assertThrows(IllegalArgumentException.class,
                () -> new InternalGrpcAuthenticationInterceptor("too-short"));
    }

    @Test
    void rejectsRequestWithoutServiceToken() {
        InternalGrpcAuthenticationInterceptor interceptor =
                new InternalGrpcAuthenticationInterceptor(TOKEN);
        ServerCall<String, String> call = mock();
        ServerCallHandler<String, String> next = mock();

        interceptor.interceptCall(call, new Metadata(), next);

        ArgumentCaptor<Status> status = ArgumentCaptor.forClass(Status.class);
        verify(call).close(status.capture(), org.mockito.ArgumentMatchers.any(Metadata.class));
        org.junit.jupiter.api.Assertions.assertEquals(
                Status.Code.UNAUTHENTICATED, status.getValue().getCode());
        verify(next, never()).startCall(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void acceptsMatchingServiceToken() {
        InternalGrpcAuthenticationInterceptor interceptor =
                new InternalGrpcAuthenticationInterceptor(TOKEN);
        ServerCall<String, String> call = mock();
        ServerCallHandler<String, String> next = mock();
        ServerCall.Listener<String> listener = mock();
        Metadata headers = new Metadata();
        headers.put(InternalGrpcAuthenticationInterceptor.INTERNAL_TOKEN, TOKEN);
        when(next.startCall(call, headers)).thenReturn(listener);

        ServerCall.Listener<String> result = interceptor.interceptCall(call, headers, next);

        assertSame(listener, result);
    }
}
