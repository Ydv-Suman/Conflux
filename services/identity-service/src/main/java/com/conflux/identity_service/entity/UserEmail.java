package com.conflux.identity_service.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Getter
@Setter
@Table(name = "user_emails")
public class UserEmail {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "user_email_id", nullable = false, updatable = false)
    private UUID userEmailId;

    @OneToOne(optional = false)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    @Column(name = "email", nullable = false, length = 100)
    private String email;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    @Column(name = "verification_source", length = 20)
    private String verificationSource;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }
}
