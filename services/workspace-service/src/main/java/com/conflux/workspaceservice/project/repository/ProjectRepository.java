package com.conflux.workspaceservice.project.repository;

import com.conflux.workspaceservice.project.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

    List<Project> findAllByCreatedByOrderByCreatedAtDesc(UUID createdBy);

    Optional<Project> findByProjectIdAndCreatedBy(UUID projectId, UUID createdBy);
}
