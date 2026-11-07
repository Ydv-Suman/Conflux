package com.conflux.collaborationservice.document;

import com.conflux.collaborationservice.shared.AttributedDocumentStore;
import com.conflux.collaborationservice.shared.DocumentAuthorization;
import com.conflux.collaborationservice.shared.DocumentId;
import com.conflux.collaborationservice.shared.DocumentJournal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** Authenticated internal API sharing the persistence boundary used by the negotiated socket protocol. */
@Service
public final class DocumentAttributionService {
    private final DocumentAuthorization authorization;
    private final AttributedDocumentStore store;

    public DocumentAttributionService(DocumentAuthorization authorization, AttributedDocumentStore store) {
        this.authorization = authorization;
        this.store = store;
    }

    public Mono<DocumentJournal.WriterBinding> register(DocumentId document,
            DocumentAuthorization.Credentials credentials, UUID requestId) {
        return Mono.defer(() -> authorization.authorize(document, credentials))
                .flatMap(actor -> Mono.fromCallable(() -> store.register(document, actor, requestId))
                        .subscribeOn(Schedulers.boundedElastic()));
    }

    public Mono<DocumentJournal.Entry> submit(DocumentId document, DocumentAuthorization.Credentials credentials,
            long writerId, UUID operationId, byte[] update) {
        byte[] captured = update == null ? null : update.clone();
        // Authorization is rechecked even for receipts retried after restart or revocation.
        return Mono.defer(() -> authorization.authorize(document, credentials))
                .flatMap(actor -> Mono.fromCallable(() -> store.submit(document, actor, writerId, operationId, captured))
                        .subscribeOn(Schedulers.boundedElastic()));
    }
}
