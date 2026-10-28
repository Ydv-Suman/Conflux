package com.conflux.collaborationservice.shared;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.concurrent.*;

public final class WebSocketPeer implements WebSocket.Listener, AutoCloseable {
    public final BlockingQueue<Object> messages = new LinkedBlockingQueue<>();
    public final CompletableFuture<Integer> closed = new CompletableFuture<>();
    public final WebSocket socket;
    private final java.io.ByteArrayOutputStream binary = new java.io.ByteArrayOutputStream();
    private final StringBuilder text = new StringBuilder();
    public WebSocketPeer(URI endpoint) throws Exception {
        socket = HttpClient.newHttpClient().newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5))
                .buildAsync(endpoint, this).get(5, TimeUnit.SECONDS);
    }
    @Override public void onOpen(WebSocket socket) { socket.request(1); }
    @Override public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
        byte[] bytes = new byte[data.remaining()]; data.get(bytes); binary.writeBytes(bytes);
        if (last) { messages.add(binary.toByteArray()); binary.reset(); }
        socket.request(1); return null;
    }
    @Override public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
        text.append(data); if (last) { messages.add(text.toString()); text.setLength(0); }
        socket.request(1); return null;
    }
    @Override public CompletionStage<?> onClose(WebSocket socket, int status, String reason) {
        closed.complete(status); return null;
    }
    @Override public void onError(WebSocket socket, Throwable error) { closed.completeExceptionally(error); }
    public void send(byte[] bytes) throws Exception { socket.sendBinary(ByteBuffer.wrap(bytes), true).get(5, TimeUnit.SECONDS); }
    public byte[] binary() throws Exception { return assertInstanceOf(byte[].class, messages.poll(5, TimeUnit.SECONDS)); }
    public void control(String type) throws Exception { assertEquals("{\"type\":\"" + type + "\"}", messages.poll(5, TimeUnit.SECONDS)); }
    @Override public void close() {
        if (!socket.isOutputClosed()) socket.sendClose(1000, "").exceptionally(error -> null).join();
    }
}
