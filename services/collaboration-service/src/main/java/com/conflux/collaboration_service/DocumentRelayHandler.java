package com.conflux.collaboration_service;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.socket.CloseStatus;
import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.WebSocketMessage;
import org.springframework.web.reactive.socket.WebSocketSession;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

@Component
final class DocumentRelayHandler implements WebSocketHandler {

	private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9._-]{1,128}");

	private final Map<RoomId, DocumentRoom> rooms = new ConcurrentHashMap<>();

	@Override
	public Mono<Void> handle(WebSocketSession session) {
		RoomId roomId = RoomId.from(session.getHandshakeInfo().getUri());
		if (roomId == null) {
			return session.close(CloseStatus.BAD_DATA);
		}

		DocumentRoom room = rooms.computeIfAbsent(roomId, ignored -> new DocumentRoom());
		ClientConnection connection = room.join(session.getId());

		Mono<Void> receive = session.receive()
				.filter(message -> message.getType() == WebSocketMessage.Type.BINARY)
				.doOnNext(message -> room.publish(session.getId(), readBytes(message)))
				.doFinally(ignored -> room.leave(session.getId(), connection.outbound()))
				.then();

		Mono<Void> send = session.send(connection.updates()
				.map(bytes -> session.binaryMessage(factory -> factory.wrap(bytes))));

		return Mono.when(receive, send);
	}

	private byte[] readBytes(WebSocketMessage message) {
		byte[] bytes = new byte[message.getPayload().readableByteCount()];
		message.getPayload().read(bytes);
		return bytes;
	}

	private static final class DocumentRoom {

		// shortcut: history and client queues are unbounded in memory;
		// add durable compaction and queue limits before production.
		private final List<byte[]> history = new ArrayList<>();
		private final Map<String, Sinks.Many<byte[]>> clients = new ConcurrentHashMap<>();

		private synchronized ClientConnection join(String sessionId) {
			Sinks.Many<byte[]> outbound = Sinks.many().unicast().onBackpressureBuffer();
			clients.put(sessionId, outbound);
			return new ClientConnection(List.copyOf(history), outbound);
		}

		private synchronized void publish(String senderId, byte[] update) {
			history.add(update);
			clients.forEach((clientId, client) -> {
				if (!clientId.equals(senderId)) {
					client.tryEmitNext(update);
				}
			});
		}

		private void leave(String sessionId, Sinks.Many<byte[]> outbound) {
			clients.remove(sessionId, outbound);
			outbound.tryEmitComplete();
		}
	}

	private record ClientConnection(List<byte[]> history, Sinks.Many<byte[]> outbound) {

		private Flux<byte[]> updates() {
			return Flux.concat(Flux.fromIterable(history), outbound.asFlux());
		}
	}

	private record RoomId(String projectId, String workstreamId, String documentId) {

		private static RoomId from(URI uri) {
			String[] parts = Arrays.stream(uri.getPath().split("/"))
					.filter(part -> !part.isBlank())
					.toArray(String[]::new);

			if (parts.length != 7
					|| !parts[0].equals("ws")
					|| !parts[1].equals("projects")
					|| !parts[3].equals("workstreams")
					|| !parts[5].equals("documents")
					|| !valid(parts[2])
					|| !valid(parts[4])
					|| !valid(parts[6])) {
				return null;
			}

			return new RoomId(parts[2], parts[4], parts[6]);
		}

		private static boolean valid(String value) {
			return VALID_ID.matcher(value).matches();
		}
	}
}
