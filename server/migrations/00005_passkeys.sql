-- +goose Up
-- Two-step sign-in, first part (PLAN.md §10.2, decision 30): passkeys that
-- the server verifies as a second step at sign-in. Unlike passkey unlock,
-- which is device-local and stores nothing here, the server keeps each
-- passkey's public key and signature counter. Expand only: nothing reads
-- this table yet.

CREATE TABLE webauthn_credentials (
  credential_id   BYTEA   PRIMARY KEY,
  user_id         UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key      BYTEA   NOT NULL,            -- COSE public key
  sign_count      BIGINT  NOT NULL DEFAULT 0,  -- the authenticator's counter, for clone detection
  aaguid          BYTEA,                       -- authenticator model, if it says
  transports      TEXT[]  NOT NULL DEFAULT '{}',
  backup_eligible BOOLEAN NOT NULL DEFAULT false,
  backup_state    BOOLEAN NOT NULL DEFAULT false,
  label           TEXT    NOT NULL,            -- e.g. "Chrome on macOS", like sessions.device_label
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);
CREATE INDEX webauthn_credentials_user ON webauthn_credentials (user_id);

-- +goose Down
DROP TABLE webauthn_credentials;
