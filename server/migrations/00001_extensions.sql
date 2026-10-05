-- +goose Up
-- citext gives case-insensitive email addresses (users.email, PLAN.md §11.5).
CREATE EXTENSION IF NOT EXISTS citext;

-- +goose Down
DROP EXTENSION IF EXISTS citext;
