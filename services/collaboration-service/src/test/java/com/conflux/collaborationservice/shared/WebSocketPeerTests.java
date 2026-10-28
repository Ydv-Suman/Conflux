package com.conflux.collaborationservice.shared;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;

import org.junit.jupiter.api.Test;

class WebSocketPeerTests {
    @Test void oversizedRejectionAcceptsClose1009OrConnectionResetOnly() throws Exception {
        WebSocketPeer.assertOversizedRejection(CompletableFuture.completedFuture(1009));
        WebSocketPeer.assertOversizedRejection(CompletableFuture.failedFuture(new IOException("Connection reset by peer")));
        assertThrows(AssertionError.class, () -> WebSocketPeer.assertOversizedRejection(CompletableFuture.completedFuture(1000)));
        assertThrows(AssertionError.class, () -> WebSocketPeer.assertOversizedRejection(CompletableFuture.completedFuture(1013)));
        assertThrows(ExecutionException.class, () -> WebSocketPeer.assertOversizedRejection(
                CompletableFuture.failedFuture(new IOException("Unexpected end of stream"))));
        assertThrows(ExecutionException.class, () -> WebSocketPeer.assertOversizedRejection(
                CompletableFuture.failedFuture(new IllegalStateException("Connection reset by peer"))));
    }
}
