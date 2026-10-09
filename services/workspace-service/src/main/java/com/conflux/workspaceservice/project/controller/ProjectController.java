package com.conflux.workspaceservice.project.controller;

import com.conflux.workspaceservice.project.dto.CreateProjectRequestDto;
import com.conflux.workspaceservice.project.dto.ProjectDto;
import com.conflux.workspaceservice.project.dto.UpdateProjectRequestDto;
import com.conflux.workspaceservice.project.service.ProjectService;
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
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectService projects;

    public ProjectController(ProjectService projects) {
        this.projects = projects;
    }

    @PostMapping(version = "1.0")
    public ResponseEntity<ProjectDto> create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateProjectRequestDto request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(projects.create(userId(jwt), request));
    }

    @GetMapping(version = "1.0")
    public List<ProjectDto> list(@AuthenticationPrincipal Jwt jwt) {
        return projects.list(userId(jwt));
    }

    @GetMapping(path = "/{projectId}", version = "1.0")
    public ProjectDto get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID projectId) {
        return projects.get(userId(jwt), projectId);
    }

    @PutMapping(path = "/{projectId}", version = "1.0")
    public ProjectDto update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID projectId,
            @Valid @RequestBody UpdateProjectRequestDto request) {
        return projects.update(userId(jwt), projectId, request);
    }

    private UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
