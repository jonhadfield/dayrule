package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MaxReminders caps how many future reminders an account can have.
const MaxReminders = 2000

// Reminder is a time the server should nudge the user. It carries nothing
// about what the reminder is for.
type Reminder struct {
	ID        uuid.UUID
	FireAt    time.Time
	LocalTime string
}

// PushSubscription is one device's Web Push endpoint.
type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Due is a reminder to send now, with where to send it.
type Due struct {
	UserID    uuid.UUID
	ID        uuid.UUID
	LocalTime string
	Channel   string
	Email     string
}

// Reminders stores reminder times and push subscriptions.
type Reminders struct{ Accounts }

func (r Reminders) Channel(ctx context.Context, userID uuid.UUID) (string, error) {
	var ch string
	err := r.Pool.QueryRow(ctx, `SELECT reminder_channel FROM users WHERE id = $1`, userID).Scan(&ch)
	return ch, err
}

func (r Reminders) SetChannel(ctx context.Context, userID uuid.UUID, channel string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET reminder_channel = $2 WHERE id = $1`, userID, channel)
	return err
}

// Replace sets the account's future reminders to exactly these. One
// already sent for the same time stays sent; a moved one is sent again.
func (r Reminders) Replace(ctx context.Context, userID uuid.UUID, rs []Reminder) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ids := make([]string, len(rs))
	for i, x := range rs {
		ids[i] = x.ID.String()
	}
	if _, err := tx.Exec(ctx, `DELETE FROM reminders WHERE user_id = $1 AND sent_at IS NULL AND NOT (id = ANY($2::uuid[]))`,
		userID, ids); err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, x := range rs {
		batch.Queue(`INSERT INTO reminders (user_id, id, fire_at, local_time) VALUES ($1, $2, $3, $4)
			ON CONFLICT (user_id, id) DO UPDATE SET fire_at = EXCLUDED.fire_at, local_time = EXCLUDED.local_time,
				sent_at = CASE WHEN reminders.fire_at = EXCLUDED.fire_at THEN reminders.sent_at ELSE NULL END`,
			userID, x.ID, x.FireAt, x.LocalTime)
	}
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r Reminders) Subscribe(ctx context.Context, userID uuid.UUID, s PushSubscription) error {
	_, err := r.Pool.Exec(ctx, `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		userID, s.Endpoint, s.P256dh, s.Auth)
	return err
}

func (r Reminders) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}

func (r Reminders) Subscriptions(ctx context.Context, userID uuid.UUID) ([]PushSubscription, error) {
	rows, err := r.Pool.Query(ctx, `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PushSubscription, error) {
		var s PushSubscription
		err := row.Scan(&s.Endpoint, &s.P256dh, &s.Auth)
		return s, err
	})
}

// ClaimDue marks reminders due by now as sent and returns them. Marking
// first means overlapping cron runs never send one twice (at most once).
// Reminders more than an hour late are skipped rather than sent stale.
func (r Reminders) ClaimDue(ctx context.Context, now time.Time, limit int) ([]Due, error) {
	rows, err := r.Pool.Query(ctx, `WITH due AS (
			SELECT r.user_id, r.id FROM reminders r JOIN users u ON u.id = r.user_id
			WHERE r.sent_at IS NULL AND r.fire_at <= $1 AND r.fire_at > $1 - interval '1 hour'
				AND u.reminder_channel <> 'off'
			ORDER BY r.fire_at LIMIT $2
			FOR UPDATE OF r SKIP LOCKED
		)
		UPDATE reminders r SET sent_at = $1 FROM due, users u
		WHERE r.user_id = due.user_id AND r.id = due.id AND u.id = r.user_id
		RETURNING r.user_id, r.id, r.local_time, u.reminder_channel, u.email`, now, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Due, error) {
		var d Due
		err := row.Scan(&d.UserID, &d.ID, &d.LocalTime, &d.Channel, &d.Email)
		return d, err
	})
}

// GCReminders drops reminders that were sent or missed days ago.
func (r Reminders) GCReminders(ctx context.Context, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `DELETE FROM reminders WHERE fire_at < $1`, now.Add(-48*time.Hour))
	return err
}
