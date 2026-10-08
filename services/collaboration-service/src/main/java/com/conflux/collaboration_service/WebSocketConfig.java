package com.conflux.collaboration_service;

import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.HandlerMapping;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter;

@Configuration
class WebSocketConfig {

	static final String DOCUMENT_ENDPOINT_PATTERN =
			"/ws/projects/*/workstreams/*/documents/*";

	@Bean
	HandlerMapping webSocketHandlerMapping(DocumentRelayHandler handler) {
		return new SimpleUrlHandlerMapping(Map.of(DOCUMENT_ENDPOINT_PATTERN, handler), -1);
	}

	@Bean
	WebSocketHandlerAdapter webSocketHandlerAdapter() {
		return new WebSocketHandlerAdapter();
	}
}
