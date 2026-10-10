package com.conflux.workspaceservice.identity.config;

import io.grpc.CallOptions;
import io.grpc.Channel;
import io.grpc.ClientCall;
import io.grpc.ClientInterceptor;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.stub.MetadataUtils;

public final class InternalGrpcTokenInterceptor implements ClientInterceptor {

    private static final Metadata.Key<String> INTERNAL_TOKEN = Metadata.Key.of(
            "x-conflux-internal-token", Metadata.ASCII_STRING_MARSHALLER);

    private final ClientInterceptor delegate;

    public InternalGrpcTokenInterceptor(String token) {
        if (token == null || token.length() < 32) {
            throw new IllegalArgumentException("Internal gRPC token must contain at least 32 characters");
        }
        Metadata headers = new Metadata();
        headers.put(INTERNAL_TOKEN, token);
        delegate = MetadataUtils.newAttachHeadersInterceptor(headers);
    }

    @Override
    public <RequestT, ResponseT> ClientCall<RequestT, ResponseT> interceptCall(
            MethodDescriptor<RequestT, ResponseT> method,
            CallOptions callOptions,
            Channel next) {
        return delegate.interceptCall(method, callOptions, next);
    }
}
