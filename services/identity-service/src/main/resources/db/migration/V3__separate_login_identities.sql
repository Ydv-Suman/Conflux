CREATE TABLE user_emails (
    user_email_id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    email VARCHAR(100) NOT NULL,
    verified_at TIMESTAMPTZ,
    verification_source VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX user_emails_email_lower_uq ON user_emails (LOWER(email));

CREATE TABLE local_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE external_identities (
    identity_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT external_identities_provider_subject_uq UNIQUE (provider, provider_subject),
    CONSTRAINT external_identities_user_provider_uq UNIQUE (user_id, provider)
);

INSERT INTO user_emails (user_email_id, user_id, email, verified_at, verification_source, created_at)
SELECT user_id, user_id, email, CASE WHEN email_verified THEN updated_at END,
       CASE WHEN email_verified THEN 'LOCAL' END, created_at
FROM users;

INSERT INTO local_credentials (user_id, password_hash)
SELECT user_id, password FROM users;

DROP INDEX users_email_lower_uq;
ALTER TABLE users DROP COLUMN email, DROP COLUMN email_verified, DROP COLUMN password;
