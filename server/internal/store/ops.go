package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ops is read-only operator queries over account metadata (no ciphertext).
type Ops struct{ Pool *pgxpool.Pool }

// UserSummary is one account as shown to an operator.
type UserSummary struct {
	ID           uuid.UUID
	Email        string
	CreatedAt    time.Time
	StoredBytes  int64
	RecordCount  int
	LastSeenAt   *time.Time // newest live session; nil if none
	SessionCount int        // live sessions (expires_at > now)
	LockedUntil  *time.Time
}

// UsageStats is environment-wide usage metadata.
type UsageStats struct {
	Users             int
	UsersLast7Days    int
	UsersLast30Days   int
	StoredBytes       int64
	RecordCount       int64
	LiveSessions      int
	ActiveUsers7Days  int // distinct users with a session last_seen in the window
	ActiveUsers30Days int
	UnusedInvites     int
	PendingReminders  int
	ErrorReports      int
}

// ListUsers returns accounts newest-first (metadata only).
func (o Ops) ListUsers(ctx context.Context, now time.Time) ([]UserSummary, error) {
	rows, err := o.Pool.Query(ctx, `
		SELECT u.id, u.email, u.created_at, u.stored_bytes, u.record_count, u.locked_until,
			(SELECT max(s.last_seen_at) FROM sessions s
			 WHERE s.user_id = u.id AND s.expires_at > $1) AS last_seen,
			(SELECT count(*)::int FROM sessions s
			 WHERE s.user_id = u.id AND s.expires_at > $1) AS session_count
		FROM users u
		ORDER BY u.created_at DESC`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (UserSummary, error) {
		var u UserSummary
		err := r.Scan(&u.ID, &u.Email, &u.CreatedAt, &u.StoredBytes, &u.RecordCount,
			&u.LockedUntil, &u.LastSeenAt, &u.SessionCount)
		return u, err
	})
}

// Stats returns aggregate usage for the connected environment.
func (o Ops) Stats(ctx context.Context, now time.Time) (UsageStats, error) {
	var s UsageStats
	err := o.Pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*)::int FROM users),
			(SELECT count(*)::int FROM users WHERE created_at > $1),
			(SELECT count(*)::int FROM users WHERE created_at > $2),
			(SELECT coalesce(sum(stored_bytes), 0) FROM users),
			(SELECT coalesce(sum(record_count), 0) FROM users),
			(SELECT count(*)::int FROM sessions WHERE expires_at > $3),
			(SELECT count(DISTINCT user_id)::int FROM sessions
			 WHERE last_seen_at > $1 AND expires_at > $3),
			(SELECT count(DISTINCT user_id)::int FROM sessions
			 WHERE last_seen_at > $2 AND expires_at > $3),
			(SELECT count(*)::int FROM invite_codes WHERE used_at IS NULL),
			(SELECT count(*)::int FROM reminders WHERE sent_at IS NULL),
			(SELECT count(*)::int FROM error_reports)
		`, now.Add(-7*24*time.Hour), now.Add(-30*24*time.Hour), now).
		Scan(&s.Users, &s.UsersLast7Days, &s.UsersLast30Days,
			&s.StoredBytes, &s.RecordCount, &s.LiveSessions,
			&s.ActiveUsers7Days, &s.ActiveUsers30Days,
			&s.UnusedInvites, &s.PendingReminders, &s.ErrorReports)
	return s, err
}
