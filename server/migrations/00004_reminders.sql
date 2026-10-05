-- +goose Up
-- Reminders (PLAN.md §10.5): the server learns only *when* a reminder
-- fires, never what it's for. Ids are opaque, chosen by the client.

ALTER TABLE users
  ADD COLUMN reminder_channel TEXT NOT NULL DEFAULT 'off'
    CHECK (reminder_channel IN ('off', 'push', 'email', 'both'));

CREATE TABLE push_subscriptions (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);

CREATE TABLE reminders (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         UUID NOT NULL,
  fire_at    TIMESTAMPTZ NOT NULL,
  local_time TEXT NOT NULL, -- "14:00", for the email text
  sent_at    TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX reminders_due ON reminders (fire_at) WHERE sent_at IS NULL;

-- +goose Down
DROP TABLE reminders;
DROP TABLE push_subscriptions;
ALTER TABLE users DROP COLUMN reminder_channel;
