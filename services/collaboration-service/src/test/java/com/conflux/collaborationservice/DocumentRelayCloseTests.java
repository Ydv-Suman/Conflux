package com.conflux.collaborationservice;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.socket.CloseStatus;
import org.springframework.web.reactive.socket.HandshakeInfo;
import org.springframework.web.reactive.socket.WebSocketMessage;
import org.springframework.web.reactive.socket.WebSocketSession;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import tools.jackson.databind.ObjectMapper;

class DocumentRelayCloseTests {
    @Test void handlerCancellationDoesNotReleaseAnInFlightCloseFrame() {
        var authorization = mock(DocumentAuthorization.class);
        var session = mock(WebSocketSession.class);
        var handler = new DocumentRelayHandler(authorization, mock(DocumentJournal.class), new ObjectMapper());
        UUID project = UUID.randomUUID(), workstream = UUID.randomUUID(), team = UUID.randomUUID();
        when(session.getHandshakeInfo()).thenReturn(new HandshakeInfo(URI.create(
                "ws://localhost/ws/projects/" + project + "/workstreams/" + workstream + "/documents/main-ts"),
                new HttpHeaders(), Mono.empty(), null));
        byte[] credentials = ("{\"teamId\":\"" + team + "\",\"token\":\"expired\"}").getBytes(StandardCharsets.UTF_8);
        when(session.receive()).thenReturn(Flux.just(new WebSocketMessage(WebSocketMessage.Type.TEXT,
                DefaultDataBufferFactory.sharedInstance.wrap(credentials))));
        when(authorization.authorize(any(), any())).thenReturn(Mono.error(new DocumentAuthorization.Denied(4403)));

        var flush = Sinks.<Void>empty();
        var started = new AtomicBoolean();
        var cancelled = new AtomicBoolean();
        when(session.close(any(CloseStatus.class))).thenReturn(Mono.defer(() -> {
            started.set(true);
            return flush.asMono().doOnCancel(() -> cancelled.set(true));
        }));
        var handling = handler.handle(session).subscribe();
        try {
            assertTrue(started.get());
            // Reactor Netty completes receive when a server close begins, before its write is flushed.
            // firstWithSignal then cancels the closing branch; the frame must remain owned by Netty.
            handling.dispose();
            assertFalse(cancelled.get(), "Cancellation must not release the close frame before the write finishes");
            verify(session).close(argThat(status -> status.getCode() == 4403));
        } finally {
            flush.tryEmitEmpty();
            handling.dispose();
        }
    }
}
