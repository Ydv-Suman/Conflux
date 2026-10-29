package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.*;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.socket.*;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import tools.jackson.databind.ObjectMapper;

class DocumentAcknowledgementTests {
    @TempDir Path directory;
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "file");
    final UUID actor = UUID.randomUUID();

    @Test void lostReceiptCanBeRetriedAfterRestartWithoutDuplicateHistoryOrBroadcast() throws Exception {
        byte[] update = {1, 2, 3};
        String original;
        try (var journal = new DocumentJournal(directory.toString()); var peer = peer(journal, true)) {
            peer.control("initialize"); peer.send(update); peer.control("synced");
            original = peer.next(); // Simulate receipt lost before the client records it.
            assertReceipt(original, update, 1);
        }
        // A new journal and handler have no in-memory deduplication state.
        try (var journal = new DocumentJournal(directory.toString())) {
            var handler = handler(journal);
            try (var peer = new Peer(handler, true); var observer = new Peer(handler, false)) {
                assertArrayEquals(update, peer.nextBinary()); peer.control("synced");
                assertArrayEquals(update, observer.nextBinary()); observer.control("synced");
                peer.send(update); assertEquals(original, peer.next());
                peer.send(update); assertEquals(original, peer.next());
                assertNull(observer.output.poll(150, TimeUnit.MILLISECONDS));
                assertEquals(1, journal.read(document).size());
                byte[] next = {4};
                peer.send(next); assertReceipt(peer.next(), next, 2);
                assertArrayEquals(next, observer.nextBinary());
                assertEquals(2, journal.read(document).size());
            }
        }
    }

    @Test void receiptAndBroadcastWaitForDurableAppend() throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var journal = spy(new DocumentJournal(directory.toString()))) {
            journal.append(document, actor, new byte[]{0}, 1);
            doAnswer(call -> {
                entered.countDown();
                if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("Test append timed out");
                return call.callRealMethod();
            }).when(journal).append(any(), any(), any(), anyInt());
            var handler = handler(journal);
            try (var peer = new Peer(handler, true); var observer = new Peer(handler, false)) {
                peer.nextBinary(); peer.control("synced");
                observer.nextBinary(); observer.control("synced");
                peer.send(new byte[]{7});
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                try {
                    assertNull(peer.output.poll(150, TimeUnit.MILLISECONDS));
                    assertNull(observer.output.poll(150, TimeUnit.MILLISECONDS));
                } finally { release.countDown(); }
                assertReceipt(peer.next(), new byte[]{7}, 2);
                assertArrayEquals(new byte[]{7}, observer.nextBinary());
                assertEquals(2, journal.read(document).size());
            } finally { release.countDown(); }
        }
    }

    @Test void failedAppendNeverAcknowledgesOrBroadcasts() throws Exception {
        try (var journal = spy(new DocumentJournal(directory.toString()))) {
            journal.append(document, actor, new byte[]{0}, 1);
            doThrow(new IOException("Disk unavailable")).when(journal).append(any(), any(), any(), anyInt());
            var handler = handler(journal);
            try (var peer = new Peer(handler, true); var observer = new Peer(handler, false)) {
                peer.nextBinary(); peer.control("synced");
                observer.nextBinary(); observer.control("synced");
                peer.send(new byte[]{8});
                assertEquals(1013, peer.closed.get(5, TimeUnit.SECONDS));
                assertEquals(1013, observer.closed.get(5, TimeUnit.SECONDS));
                assertTrue(peer.output.isEmpty()); assertTrue(observer.output.isEmpty());
                assertEquals(1, journal.read(document).size());
            }
        }
    }

    private void assertReceipt(String value, byte[] update, int sequence) throws Exception {
        var receipt = new ObjectMapper().readTree(value);
        assertEquals("ack", receipt.get("type").asText());
        assertEquals(sequence, receipt.get("sequence").asInt());
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(update)), receipt.get("sha256").asText());
    }
    private DocumentRelayHandler handler(DocumentJournal journal) {
        var authorization = mock(DocumentAuthorization.class);
        when(authorization.authorize(any(), any())).thenReturn(Mono.just(actor));
        return new DocumentRelayHandler(authorization, journal, new ObjectMapper());
    }
    private Peer peer(DocumentJournal journal, boolean receipts) throws Exception { return new Peer(handler(journal), receipts); }

    private final class Peer implements AutoCloseable {
        final BlockingQueue<Object> output = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        final Sinks.Many<WebSocketMessage> input = Sinks.many().unicast().onBackpressureBuffer();
        final Disposable handling;
        Peer(DocumentRelayHandler handler, boolean receipts) {
            var session = mock(WebSocketSession.class);
            when(session.getId()).thenReturn(UUID.randomUUID().toString());
            when(session.getHandshakeInfo()).thenReturn(new HandshakeInfo(URI.create("ws://localhost/ws/projects/"
                    + document.projectId() + "/workstreams/" + document.workstreamId() + "/documents/" + document.documentId()),
                    new HttpHeaders(), Mono.empty(), null));
            when(session.receive()).thenReturn(input.asFlux());
            when(session.textMessage(anyString())).thenAnswer(call -> message(WebSocketMessage.Type.TEXT, ((String) call.getArgument(0)).getBytes(StandardCharsets.UTF_8)));
            when(session.binaryMessage(any())).thenAnswer(call -> {
                java.util.function.Function<org.springframework.core.io.buffer.DataBufferFactory, org.springframework.core.io.buffer.DataBuffer> factory = call.getArgument(0);
                return new WebSocketMessage(WebSocketMessage.Type.BINARY, factory.apply(DefaultDataBufferFactory.sharedInstance));
            });
            when(session.send(any())).thenAnswer(call -> Flux.<WebSocketMessage>from(call.getArgument(0)).doOnNext(frame -> {
                byte[] bytes = new byte[frame.getPayload().readableByteCount()]; frame.getPayload().read(bytes);
                output.add(frame.getType() == WebSocketMessage.Type.TEXT ? new String(bytes, StandardCharsets.UTF_8) : bytes);
            }).then());
            when(session.close(any())).thenAnswer(call -> { closed.complete(((CloseStatus) call.getArgument(0)).getCode()); return Mono.empty(); });
            handling = handler.handle(session).subscribe();
            input.tryEmitNext(message(WebSocketMessage.Type.TEXT, ("{\"teamId\":\"" + UUID.randomUUID()
                    + "\",\"token\":\"test\",\"acknowledgements\":" + receipts + "}").getBytes(StandardCharsets.UTF_8)));
        }
        void send(byte[] bytes) { assertEquals(Sinks.EmitResult.OK, input.tryEmitNext(message(WebSocketMessage.Type.BINARY, bytes))); }
        String next() throws Exception { return assertInstanceOf(String.class, output.poll(5, TimeUnit.SECONDS)); }
        byte[] nextBinary() throws Exception { return assertInstanceOf(byte[].class, output.poll(5, TimeUnit.SECONDS)); }
        void control(String type) throws Exception { assertEquals("{\"type\":\"" + type + "\"}", next()); }
        @Override public void close() { handling.dispose(); }
    }
    private static WebSocketMessage message(WebSocketMessage.Type type, byte[] bytes) {
        return new WebSocketMessage(type, DefaultDataBufferFactory.sharedInstance.wrap(bytes));
    }
}
