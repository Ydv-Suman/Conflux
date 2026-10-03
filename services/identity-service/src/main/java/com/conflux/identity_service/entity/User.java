package com.conflux.identity_service.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.CascadeType;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Getter
@Setter
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Size(max = 50)
    @NotNull
    @Column(name = "first_name", nullable = false)
    private String firstName;

    @Size(max = 50)
    @Column(name = "middle_name")
    private String middleName;

    @Size(max = 50)
    @NotNull
    @Column(name = "last_name", nullable = false)
    private String lastName;

    @Size(min = 5, max = 50)
    @NotNull
    @Column(name = "username", nullable = false)
    private String username;

    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL, optional = false)
    private UserEmail primaryEmail;

    @OneToOne(mappedBy = "user", cascade = CascadeType.ALL, optional = false)
    private LocalCredential localCredential;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public void setPrimaryEmail(UserEmail primaryEmail) {
        this.primaryEmail = primaryEmail;
        primaryEmail.setUser(this);
    }

    public void setLocalCredential(LocalCredential localCredential) {
        this.localCredential = localCredential;
        localCredential.setUser(this);
    }
}
