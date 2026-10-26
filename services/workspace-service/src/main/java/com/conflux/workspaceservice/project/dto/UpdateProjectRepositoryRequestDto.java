package com.conflux.workspaceservice.project.dto;

import com.conflux.workspaceservice.project.entity.RepositoryAccessMode;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public record UpdateProjectRepositoryRequestDto(
        @NotBlank @Size(max = 2048) String repositoryUrl,
        @NotNull RepositoryAccessMode accessMode,
        @NotBlank @Size(max = 200)
        @Pattern(regexp = "^(?!.*\\.\\.)(?!.*//)(?!.*@\\{)(?!.*\\\\)(?!\\.)(?!.*?/\\.)(?!.*[/.]$)(?!.*\\.lock(?:/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$",
                message = "must be a safe Git branch name")
        String canonicalBranch,
        @NotBlank @Pattern(regexp = "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
                message = "must be a full 40- or 64-character Git commit hash")
        String canonicalRevision,
        @NotNull @PositiveOrZero Long expectedVersion) {

    public UpdateProjectRepositoryRequestDto {
        repositoryUrl = trim(repositoryUrl);
        // Normalize the common Git SSH shorthand to a URL for desktop consumers.
        if (repositoryUrl != null && repositoryUrl.matches("[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+")) {
            repositoryUrl = "ssh://" + repositoryUrl.replaceFirst(":", "/");
        }
        canonicalBranch = trim(canonicalBranch);
        canonicalRevision = canonicalRevision == null ? null : canonicalRevision.trim().toLowerCase(Locale.ROOT);
    }

    @JsonIgnore
    @AssertTrue(message = "repositoryUrl must be an HTTPS or SSH Git URL compatible with accessMode, without embedded credentials, query parameters, or fragments")
    public boolean isRepositoryAccessValid() {
        if (repositoryUrl == null || accessMode == null) return true;
        try {
            URI uri = new URI(repositoryUrl);
            if (uri.getHost() == null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() == 0 || uri.getPort() > 65535) return false;
            String path = uri.getRawPath();
            if (path == null || !path.matches("/[A-Za-z0-9._~/-]+") || path.contains("//")) return false;
            for (String segment : path.split("/")) {
                if (segment.equals(".") || segment.equals("..")) return false;
            }
            return switch (accessMode) {
                case PUBLIC, HTTPS_CREDENTIAL_HELPER -> "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null;
                case SSH_AGENT -> "ssh".equals(uri.getScheme()) && uri.getRawUserInfo() != null
                        && uri.getRawUserInfo().matches("[A-Za-z0-9._-]+");
            };
        } catch (URISyntaxException invalid) {
            return false;
        }
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }
}
