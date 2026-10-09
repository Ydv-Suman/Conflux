package com.conflux.workspaceservice.workstream.controller;

import com.conflux.workspaceservice.workstream.dto.CreateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.dto.UpdateWorkstreamRequestDto;
import com.conflux.workspaceservice.workstream.dto.UpdateWorkstreamStatusRequestDto;
import com.conflux.workspaceservice.workstream.dto.WorkstreamDto;
import com.conflux.workspaceservice.workstream.service.WorkstreamService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/workstreams")
public class WorkstreamController {

    private final WorkstreamService workstreams;

    public WorkstreamController(WorkstreamService workstreams) {
        this.workstreams = workstreams;
    }

    @PostMapping(version = "1.0")
    public ResponseEntity<WorkstreamDto> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID projectId,
            @Valid @RequestBody CreateWorkstreamRequestDto request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(workstreams.create(userId(jwt), projectId, request));
    }

    @GetMapping(version = "1.0")
    public List<WorkstreamDto> list(
            @AuthenticationPrincipal Jwt jwt, @PathVariable UUID projectId) {
        return workstreams.list(userId(jwt), projectId);
    }

    @GetMapping(path = "/{workstreamId}", version = "1.0")
    public WorkstreamDto get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID projectId,
            @PathVariable UUID workstreamId) {
        return workstreams.get(userId(jwt), projectId, workstreamId);
    }

    @PutMapping(path = "/{workstreamId}", version = "1.0")
    public WorkstreamDto update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID projectId,
            @PathVariable UUID workstreamId,
            @Valid @RequestBody UpdateWorkstreamRequestDto request) {
        return workstreams.update(userId(jwt), projectId, workstreamId, request);
    }

    @PutMapping(path = "/{workstreamId}/status", version = "1.0")
    public WorkstreamDto updateStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID projectId,
            @PathVariable UUID workstreamId,
            @Valid @RequestBody UpdateWorkstreamStatusRequestDto request) {
        return workstreams.updateStatus(userId(jwt), projectId, workstreamId, request.status());
    }

    private UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
