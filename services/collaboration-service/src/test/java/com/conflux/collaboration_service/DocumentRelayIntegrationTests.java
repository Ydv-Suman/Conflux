package com.conflux.collaboration_service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient;

import reactor.core.Disposable;
import reactor.core.publisher.Mono;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DocumentRelayIntegrationTests {

	private final ReactorNettyWebSocketClient client = new ReactorNettyWebSocketClient();

	@Value("${local.server.port}")
	private int port;

	@Test
	void relaysBinaryUpdatesWithinTheSameRoom() throws Exception {
		URI room = endpoint("project-one", "auth", "tokens-java");
		Receiver receiver = connectReceiver(room, 1);

		try {
			byte[] update = { 1, 2, 3, 4 };
			send(room, update);

			assertArrayEquals(update, receiver.messages().get(5, TimeUnit.SECONDS).getFirst());
		} finally {
			receiver.connection().dispose();
		}
	}

	@Test
	void doesNotRelayUpdatesAcrossRooms() throws Exception {
		URI authRoom = endpoint("project-one", "auth", "config-java");
		URI paymentRoom = endpoint("project-one", "payments", "config-java");
		Receiver paymentReceiver = connectReceiver(paymentRoom, 1);

		try {
			send(authRoom, new byte[] { 5, 6 });
			assertThrows(TimeoutException.class,
					() -> paymentReceiver.messages().get(300, TimeUnit.MILLISECONDS));

			byte[] paymentUpdate = { 7, 8 };
			send(paymentRoom, paymentUpdate);
			assertArrayEquals(paymentUpdate,
					paymentReceiver.messages().get(5, TimeUnit.SECONDS).getFirst());
		} finally {
			paymentReceiver.connection().dispose();
		}
	}

	@Test
	void replaysMissedUpdatesInOrderAfterReconnect() throws Exception {
		URI room = endpoint("project-one", "auth", "reconnect-java");
		byte[] firstUpdate = { 9, 10 };
		byte[] secondUpdate = { 11, 12 };
		Receiver initialConnection = connectReceiver(room, 1);

		try {
			send(room, firstUpdate);
			assertArrayEquals(firstUpdate,
					initialConnection.messages().get(5, TimeUnit.SECONDS).getFirst());
		} finally {
			initialConnection.connection().dispose();
		}

		send(room, secondUpdate);
		Receiver reconnected = connectReceiver(room, 2);

		try {
			List<byte[]> replayed = reconnected.messages().get(5, TimeUnit.SECONDS);
			assertArrayEquals(firstUpdate, replayed.get(0));
			assertArrayEquals(secondUpdate, replayed.get(1));
		} finally {
			reconnected.connection().dispose();
		}
	}

	private Receiver connectReceiver(URI endpoint, int expectedMessages) throws InterruptedException {
		var connected = new CountDownLatch(1);
		var messages = new CompletableFuture<List<byte[]>>();

		Disposable connection = client.execute(endpoint, session -> {
			connected.countDown();
			return session.receive()
					.take(expectedMessages)
					.map(incoming -> {
						byte[] bytes = new byte[incoming.getPayload().readableByteCount()];
						incoming.getPayload().read(bytes);
						return bytes;
					})
					.collectList()
					.doOnNext(messages::complete)
					.then();
		}).subscribe();

		assertTrue(connected.await(5, TimeUnit.SECONDS));
		return new Receiver(connection, messages);
	}

	private void send(URI endpoint, byte[] update) {
		client.execute(endpoint, session -> session.send(
				Mono.just(session.binaryMessage(factory -> factory.wrap(update)))))
				.block(Duration.ofSeconds(5));
	}

	private URI endpoint(String projectId, String workstreamId, String documentId) {
		return URI.create("ws://localhost:" + port
				+ "/ws/projects/" + projectId
				+ "/workstreams/" + workstreamId
				+ "/documents/" + documentId);
	}

	private record Receiver(Disposable connection, CompletableFuture<List<byte[]>> messages) {
	}
}
