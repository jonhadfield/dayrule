-- +goose Up
-- Two-step sign-in, second part (PLAN.md §10.2, decision 30): what the
-- go-webauthn library needs to register passkeys and verify them at sign-in.
-- webauthn_credentials is still empty everywhere (nothing wrote to it), so
-- its new NOT NULL columns need no backfill.

-- Credentials are scoped to the relying party (the exact host, §14.4) they
-- were registered on. flags is the authenticator-data flags octet, which the
-- library checks at every sign-in.
ALTER TABLE webauthn_credentials
  ADD COLUMN rp_id              TEXT     NOT NULL,
  ADD COLUMN flags              SMALLINT NOT NULL,
  ADD COLUMN attestation_type   TEXT     NOT NULL DEFAULT '',
  ADD COLUMN attestation_format TEXT     NOT NULL DEFAULT '',
  ADD COLUMN attachment         TEXT     NOT NULL DEFAULT '',
  ADD COLUMN clone_warning      BOOLEAN  NOT NULL DEFAULT false;

-- The WebAuthn user handle: random, made on the first passkey registration,
-- the same for all of a user's passkeys. Not the user id, so authenticators
-- never hold an identifier the rest of the schema uses.
ALTER TABLE users ADD COLUMN webauthn_handle BYTEA UNIQUE;

-- A passkey ceremony in progress: registering one (bound to the signed-in
-- session) or the second step of a sign-in (after the password passed). The
-- client holds the token; only its SHA-256 is stored. Single use.
CREATE TABLE webauthn_ceremonies (
  token_hash   BYTEA PRIMARY KEY,
  user_id      UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT  NOT NULL CHECK (purpose IN ('register', 'login')),
  session_id   UUID  REFERENCES sessions(id) ON DELETE CASCADE, -- register only
  device_label TEXT  NOT NULL DEFAULT '',                        -- login only, for the new session
  data         JSONB,                                            -- go-webauthn SessionData, once options are issued
  attempts     INT   NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX webauthn_ceremonies_expiry ON webauthn_ceremonies (expires_at);

-- +goose Down
DROP TABLE webauthn_ceremonies;
ALTER TABLE users DROP COLUMN webauthn_handle;
ALTER TABLE webauthn_credentials
  DROP COLUMN rp_id,
  DROP COLUMN flags,
  DROP COLUMN attestation_type,
  DROP COLUMN attestation_format,
  DROP COLUMN attachment,
  DROP COLUMN clone_warning;
