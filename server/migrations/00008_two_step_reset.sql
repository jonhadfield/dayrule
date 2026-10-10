-- +goose Up
-- Two-step sign-in, fifth part (PLAN.md §10.2, decision 30): someone with
-- their password but none of their second steps can have two-step sign-in
-- turned off by email, after a 7-day wait. Expand only: a new code purpose
-- and a new table.

ALTER TABLE email_codes DROP CONSTRAINT email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check
  CHECK (purpose IN ('signup', 'email_change', 'two_step_reset'));

-- A pending reset. It takes effect at the first sign-in with the password
-- after due_at, and is cancelled by a second step, a password change or
-- recovery, or from Account. reminded_at: the notice a day before was sent.
CREATE TABLE two_step_resets (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL,
  due_at       TIMESTAMPTZ NOT NULL,
  reminded_at  TIMESTAMPTZ
);

-- +goose Down
DROP TABLE two_step_resets;
DELETE FROM email_codes WHERE purpose = 'two_step_reset';
ALTER TABLE email_codes DROP CONSTRAINT email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check
  CHECK (purpose IN ('signup', 'email_change'));
