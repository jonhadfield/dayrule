-- +goose Up
-- Accounts (PLAN.md §10.2, §11.3, §11.5). The server stores no user content
-- and no password: only hashes, wrapped keys and the login email.

CREATE TABLE users (
  id                  UUID PRIMARY KEY,
  email               CITEXT NOT NULL UNIQUE,
  kdf_salt            BYTEA NOT NULL,          -- client Argon2id salt
  kdf_params          JSONB NOT NULL,          -- client Argon2id parameters
  auth_hash           BYTEA NOT NULL,          -- server Argon2id(AuthKey)
  auth_salt           BYTEA NOT NULL,
  wrapped_ak_pw       JSONB NOT NULL,          -- {nonce, ciphertext}, base64
  wrapped_ak_recovery JSONB NOT NULL,
  recovery_proof_hash BYTEA NOT NULL,          -- SHA-256 of the recovery proof
  failed_logins       INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   BYTEA NOT NULL UNIQUE,          -- SHA-256 of the cookie token
  device_label TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE email_codes (
  id               UUID PRIMARY KEY,
  email            CITEXT NOT NULL,
  purpose          TEXT NOT NULL CHECK (purpose IN ('signup', 'email_change')),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  code_hash        BYTEA NOT NULL,             -- HMAC of the 6-digit code
  attempts         INT NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  token_hash       BYTEA,                      -- signup token, once verified
  token_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_lookup ON email_codes (email, purpose, created_at DESC);

CREATE TABLE invite_codes (
  code_hash  BYTEA PRIMARY KEY,                -- HMAC of the invite code
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ
);

-- +goose Down
DROP TABLE invite_codes;
DROP TABLE email_codes;
DROP TABLE sessions;
DROP TABLE users;
