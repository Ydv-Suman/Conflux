UPDATE user_emails
SET verification_source = 'EMAIL'
WHERE verification_source = 'LOCAL';

ALTER TABLE user_emails
    ADD CONSTRAINT user_emails_verification_source_ck
    CHECK (verification_source IS NULL OR verification_source IN ('EMAIL', 'GITHUB'));

ALTER TABLE email_verification_tokens
    ALTER COLUMN token_hash TYPE VARCHAR(64);

CREATE INDEX email_verification_tokens_expires_idx
    ON email_verification_tokens (expires_at);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
