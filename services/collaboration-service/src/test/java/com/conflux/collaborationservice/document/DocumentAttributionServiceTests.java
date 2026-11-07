package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.AttributedDocumentStore;
import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class DocumentAttributionServiceTests {
    final DocumentAuthorization authorization = mock(DocumentAuthorization.class);
    final AttributedDocumentStore store = mock(AttributedDocumentStore.class);
    final DocumentAttributionService service = new DocumentAttributionService(authorization, store);
    final DocumentId document = new DocumentId(UUID.randomUUID(), UUID.randomUUID(), "main-ts");
    final DocumentAuthorization.Credentials credentials = new DocumentAuthorization.Credentials(UUID.randomUUID(), "token");
    final UUID actor = UUID.randomUUID(), requestId = UUID.randomUUID();

    @Test void derivesBindingActorFromAuthorizationAndRechecksOnRetry() throws Exception {
        when(authorization.authorize(document, credentials)).thenReturn(Mono.just(actor));
        var binding = new DocumentJournal.WriterBinding(actor, requestId, 10, Instant.now());
        when(store.register(document, actor, requestId)).thenReturn(binding);
        var request = service.register(document, credentials, requestId);
        assertEquals(binding, request.block());
        when(authorization.authorize(document, credentials)).thenReturn(Mono.error(new DocumentAuthorization.Denied(4403)));
        assertThrows(DocumentAuthorization.Denied.class, request::block);
        verify(store, times(1)).register(document, actor, requestId);
        verify(authorization, times(2)).authorize(document, credentials);
    }

    @Test void rejectedMembershipOrUnavailableAuthorizationNeverTouchesPersistence() {
        when(authorization.authorize(document, credentials)).thenReturn(Mono.error(new DocumentAuthorization.Denied(4403)));
        assertThrows(DocumentAuthorization.Denied.class, () -> service.submit(document, credentials, 10, requestId, new byte[]{1}).block());
        when(authorization.authorize(document, credentials)).thenReturn(Mono.error(new IllegalStateException("unavailable")));
        assertThrows(IllegalStateException.class, () -> service.register(document, credentials, requestId).block());
        verifyNoInteractions(store);
    }

    @Test void snapshotsMutableRequestBytesBeforeAsynchronousAuthorization() throws Exception {
        when(authorization.authorize(document, credentials)).thenReturn(Mono.just(actor));
        var entry = new DocumentJournal.Entry(1, actor, Instant.now(), new byte[]{1}, null);
        when(store.submit(eq(document), eq(actor), eq(10L), eq(requestId), any())).thenAnswer(call -> {
            assertArrayEquals(new byte[]{1}, call.getArgument(4));
            return entry;
        });
        byte[] update = {1};
        var request = service.submit(document, credentials, 10, requestId, update);
        update[0] = 99;
        assertEquals(entry, request.block());
    }
}
