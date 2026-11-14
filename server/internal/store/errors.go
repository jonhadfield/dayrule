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

// Insert adds one report. Callers must already truncate fields.
func (e ErrorReports) Insert(ctx context.Context, release, message, stack, userAgent string) error {
	_, err := e.Pool.Exec(ctx,
		`INSERT INTO error_reports (release, message, stack, user_agent)
		 VALUES ($1, $2, $3, $4)`,
		release, message, stack, userAgent)
	return err
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
