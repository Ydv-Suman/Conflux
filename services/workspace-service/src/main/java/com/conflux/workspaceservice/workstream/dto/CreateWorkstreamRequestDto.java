package com.conflux.workspaceservice.workstream.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateWorkstreamRequestDto(
        @NotBlank @Size(max = 100) String name,
        @NotBlank @Size(max = 200)
        @Pattern(regexp = "^(?!.*\\.\\.)(?!.*//)(?!.*@\\{)(?!.*\\\\)(?!\\.)(?!.*?/\\.)(?!.*\\.(?:/|$))(?!.*\\.lock(?:/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$",
                message = "must be a safe Git branch name")
        String branchName,
        @NotBlank
        @Pattern(regexp = "^[0-9a-fA-F]{7,64}$", message = "must be a Git revision hash")
        String baseRevision) {

    public CreateWorkstreamRequestDto {
        name = trim(name);
        branchName = trim(branchName);
        baseRevision = trim(baseRevision);
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }
}
