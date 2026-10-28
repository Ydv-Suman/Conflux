package com.conflux.collaborationservice.config;

import com.conflux.collaborationservice.document.DocumentRelayHandler;
import com.conflux.collaborationservice.filetree.FileTreeHandler;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.HandlerMapping;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter;
import org.springframework.web.reactive.socket.server.support.HandshakeWebSocketService;
import org.springframework.web.reactive.socket.server.upgrade.ReactorNettyRequestUpgradeStrategy;
import reactor.netty.http.server.WebsocketServerSpec;

@Configuration
class WebSocketConfig {

	@Bean
	org.springframework.web.reactive.function.client.WebClient.Builder webClientBuilder() {
		return org.springframework.web.reactive.function.client.WebClient.builder();
	}

	static final String DOCUMENT_ENDPOINT_PATTERN =
			"/ws/projects/*/workstreams/*/documents/*";

	@Bean
	HandlerMapping webSocketHandlerMapping(DocumentRelayHandler handler, FileTreeHandler files) {
		return new SimpleUrlHandlerMapping(Map.of(DOCUMENT_ENDPOINT_PATTERN, handler,
				"/ws/projects/*/workstreams/*/files", files), -1);
	}

	@Bean
	WebSocketHandlerAdapter webSocketHandlerAdapter() {
		return new WebSocketHandlerAdapter(new HandshakeWebSocketService(
				new ReactorNettyRequestUpgradeStrategy(() -> WebsocketServerSpec.builder()
						.maxFramePayloadLength(DocumentJournal.MAX_UPDATE))));
	}
}
