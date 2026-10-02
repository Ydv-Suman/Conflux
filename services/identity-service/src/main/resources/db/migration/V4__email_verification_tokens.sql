CREATE TABLE email_verification_tokens (
    token_id UUID PRIMARY KEY,
    user_email_id UUID NOT NULL REFERENCES user_emails(user_email_id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX email_verification_tokens_email_idx
    ON email_verification_tokens (user_email_id);
