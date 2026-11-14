-- +goose Up
-- Client error reports (PLAN.md §11.3 / decision 10): message and stack
-- only, kept 30 days. No user content; no request/response bodies.

CREATE TABLE error_reports (
  id         BIGSERIAL PRIMARY KEY,
  release    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL,
  stack      TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX error_reports_created ON error_reports (created_at);

-- +goose Down
DROP TABLE error_reports;
