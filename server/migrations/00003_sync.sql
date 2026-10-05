-- +goose Up
-- Sync (PLAN.md §11): the latest encrypted version of each record, with a
-- per-user sequence. The server can't read records; it sees ids that look
-- random, sizes (padded), sequence numbers and whether a record is a
-- tombstone (needed to purge old deletions).

ALTER TABLE users
  ADD COLUMN next_seq        BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN stored_bytes    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN record_count    INT    NOT NULL DEFAULT 0,
  ADD COLUMN tombstone_floor BIGINT NOT NULL DEFAULT 0;  -- tombstones at or below this seq were purged

CREATE TABLE records (
  user_id    UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id  UUID     NOT NULL,
  seq        BIGINT   NOT NULL,
  alg        SMALLINT NOT NULL,
  key_id     INT      NOT NULL,
  nonce      BYTEA    NOT NULL,
  ciphertext BYTEA    NOT NULL,
  tombstone  BOOLEAN  NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, record_id)
);
CREATE INDEX records_user_seq ON records (user_id, seq);
CREATE INDEX records_tombstones ON records (updated_at) WHERE tombstone;

-- +goose Down
DROP TABLE records;
ALTER TABLE users
  DROP COLUMN next_seq,
  DROP COLUMN stored_bytes,
  DROP COLUMN record_count,
  DROP COLUMN tombstone_floor;
