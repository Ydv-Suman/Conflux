package com.conflux.collaborationservice;

import java.net.URI;
import java.util.UUID;
import java.util.regex.Pattern;

record DocumentId(UUID projectId, UUID workstreamId, String documentId) {
    private static final Pattern PATH = Pattern.compile(
            "/ws/projects/([0-9a-f-]{36})/workstreams/([0-9a-f-]{36})/documents/([A-Za-z0-9._-]{1,128})");

    static DocumentId from(URI uri) {
        var match = PATH.matcher(uri.getPath());
        if (!match.matches() || uri.getQuery() != null) throw new IllegalArgumentException("Invalid document URL");
        return new DocumentId(UUID.fromString(match.group(1)), UUID.fromString(match.group(2)), match.group(3));
    }

    String key() {
        return projectId + "/" + workstreamId + "/" + documentId;
    }
}
