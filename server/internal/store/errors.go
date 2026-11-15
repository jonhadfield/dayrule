package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrorReports stores client crash reports (PLAN.md decision 10).
type ErrorReports struct {
	Pool *pgxpool.Pool
}

// ErrorReport is one stored crash report (owner tooling / GC).
type ErrorReport struct {
	ID        int64
	Release   string
	Message   string
	Stack     string
	UserAgent string
	CreatedAt time.Time
}

// Insert adds one report. Callers must already truncate fields.
func (e ErrorReports) Insert(ctx context.Context, release, message, stack, userAgent string) error {
	_, err := e.Pool.Exec(ctx,
		`INSERT INTO error_reports (release, message, stack, user_agent)
		 VALUES ($1, $2, $3, $4)`,
		release, message, stack, userAgent)
	return err
}

// Recent returns the newest reports, newest first (limit clamped 1–200).
func (e ErrorReports) Recent(ctx context.Context, limit int) ([]ErrorReport, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := e.Pool.Query(ctx,
		`SELECT id, release, message, stack, user_agent, created_at
		 FROM error_reports
		 ORDER BY created_at DESC, id DESC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ErrorReport
	for rows.Next() {
		var r ErrorReport
		if err := rows.Scan(&r.ID, &r.Release, &r.Message, &r.Stack, &r.UserAgent, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// PurgeOlderThan deletes reports older than retention and returns how many.
func (e ErrorReports) PurgeOlderThan(ctx context.Context, now time.Time, retention time.Duration) (int64, error) {
	tag, err := e.Pool.Exec(ctx,
		`DELETE FROM error_reports WHERE created_at < $1`,
		now.Add(-retention))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
