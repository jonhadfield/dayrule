-- +goose Up
-- Two-step sign-in, fourth part (PLAN.md §10.2, decision 30): TOTP from an
-- authenticator app, and single-use backup codes. Only new tables and
-- columns with defaults, so the running code is unaffected.

-- One TOTP secret per account, encrypted with a key derived from
-- AUTH_SECRET and bound to the user id, so the database alone can't make
-- codes. confirmed_at is NULL while it is being set up (until the first
-- code is entered). last_step is the last 30-second step accepted: no code
-- works twice.
CREATE TABLE totp_secrets (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret       BYTEA NOT NULL,          -- nonce || XChaCha20-Poly1305 ciphertext
  confirmed_at TIMESTAMPTZ,
  last_step    BIGINT NOT NULL DEFAULT 0,
  attempts     INT NOT NULL DEFAULT 0,  -- wrong codes while being set up
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);

-- Backup codes: an HMAC of each (keyed from AUTH_SECRET, bound to the user
-- id). A code is deleted when it is used.
CREATE TABLE backup_codes (
  user_id   UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash BYTEA NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

-- Wrong second-step codes, counted across sign-ins (a correct password
-- doesn't reset them), with the same back-off as wrong passwords.
ALTER TABLE users
  ADD COLUMN second_step_failures     INT NOT NULL DEFAULT 0,
  ADD COLUMN second_step_locked_until TIMESTAMPTZ;

-- Wrong codes within one sign-in's second step.
ALTER TABLE webauthn_ceremonies ADD COLUMN code_attempts INT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE webauthn_ceremonies DROP COLUMN code_attempts;
ALTER TABLE users DROP COLUMN second_step_failures, DROP COLUMN second_step_locked_until;
DROP TABLE backup_codes;
DROP TABLE totp_secrets;
