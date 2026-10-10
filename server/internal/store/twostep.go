package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TwoStep stores the code-based second sign-in steps (PLAN.md §10.2,
// decision 30): a TOTP secret and backup codes.
type TwoStep struct{ Accounts }

// TOTP is an account's authenticator-app secret, sealed.
type TOTP struct {
	Sealed      []byte
	ConfirmedAt *time.Time // nil while being set up
	LastStep    int64
	Attempts    int
	CreatedAt   time.Time
	LastUsedAt  *time.Time
}

// Methods summarises an account's second steps.
type Methods struct {
	Passkeys    int
	TOTP        bool
	BackupCodes int
}

// Methods returns which second steps an account has.
func (t TwoStep) Methods(ctx context.Context, userID uuid.UUID) (Methods, error) {
	var m Methods
	err := t.Pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM webauthn_credentials WHERE user_id = $1),
		EXISTS (SELECT 1 FROM totp_secrets WHERE user_id = $1 AND confirmed_at IS NOT NULL),
		(SELECT count(*) FROM backup_codes WHERE user_id = $1)`, userID).Scan(&m.Passkeys, &m.TOTP, &m.BackupCodes)
	return m, err
}

// StartTOTP stores a new secret being set up, replacing one that never was.
// An account whose TOTP is already on is ErrConflict.
func (t TwoStep) StartTOTP(ctx context.Context, userID uuid.UUID, sealed []byte, now time.Time) error {
	tag, err := t.Pool.Exec(ctx, `INSERT INTO totp_secrets (user_id, secret, created_at) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET secret = $2, created_at = $3, attempts = 0
		WHERE totp_secrets.confirmed_at IS NULL`, userID, sealed, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// TOTP returns an account's secret, set up or not.
func (t TwoStep) TOTP(ctx context.Context, userID uuid.UUID) (*TOTP, error) {
	var s TOTP
	err := t.Pool.QueryRow(ctx, `SELECT secret, confirmed_at, last_step, attempts, created_at, last_used_at
		FROM totp_secrets WHERE user_id = $1`, userID).
		Scan(&s.Sealed, &s.ConfirmedAt, &s.LastStep, &s.Attempts, &s.CreatedAt, &s.LastUsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// SetupFailed counts a wrong code while TOTP is being set up.
func (t TwoStep) SetupFailed(ctx context.Context, userID uuid.UUID) error {
	_, err := t.Pool.Exec(ctx, `UPDATE totp_secrets SET attempts = attempts + 1
		WHERE user_id = $1 AND confirmed_at IS NULL`, userID)
	return err
}

// ConfirmTOTP turns TOTP on, with the step of the code that confirmed it.
func (t TwoStep) ConfirmTOTP(ctx context.Context, userID uuid.UUID, step int64, now time.Time) error {
	tag, err := t.Pool.Exec(ctx, `UPDATE totp_secrets SET confirmed_at = $3, last_step = $2
		WHERE user_id = $1 AND confirmed_at IS NULL`, userID, step, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UseTOTP records a code used at sign-in. A step at or before the last one
// is ErrConflict, so two requests can't both use the same code.
func (t TwoStep) UseTOTP(ctx context.Context, userID uuid.UUID, step int64, now time.Time) error {
	tag, err := t.Pool.Exec(ctx, `UPDATE totp_secrets SET last_step = $2, last_used_at = $3
		WHERE user_id = $1 AND confirmed_at IS NOT NULL AND last_step < $2`, userID, step, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// DeleteTOTP removes an account's secret and reports whether TOTP was on
// (rather than only being set up).
func (t TwoStep) DeleteTOTP(ctx context.Context, userID uuid.UUID) (bool, error) {
	var confirmed bool
	err := t.Pool.QueryRow(ctx, `DELETE FROM totp_secrets WHERE user_id = $1
		RETURNING confirmed_at IS NOT NULL`, userID).Scan(&confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return confirmed, err
}

// ReplaceBackupCodes swaps an account's backup codes for new ones.
func (t TwoStep) ReplaceBackupCodes(ctx context.Context, userID uuid.UUID, hashes [][]byte) error {
	tx, err := t.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM backup_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO backup_codes (user_id, code_hash) SELECT $1, unnest($2::bytea[])`,
		userID, hashes); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UseBackupCode deletes a backup code and returns how many are left. An
// unknown or used code is ErrNotFound.
func (t TwoStep) UseBackupCode(ctx context.Context, userID uuid.UUID, hash []byte) (int, error) {
	var left int
	err := t.Pool.QueryRow(ctx, `WITH used AS (
			DELETE FROM backup_codes WHERE user_id = $1 AND code_hash = $2 RETURNING 1
		)
		SELECT (SELECT count(*) FROM backup_codes WHERE user_id = $1) - 1 FROM used`, userID, hash).Scan(&left)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return left, err
}

// DropUnneededBackupCodes deletes the backup codes once the account has no
// passkey and no TOTP left, so they can't come back into force with a new
// second step. It reports whether it deleted any.
func (t TwoStep) DropUnneededBackupCodes(ctx context.Context, userID uuid.UUID) (bool, error) {
	tag, err := t.Pool.Exec(ctx, `DELETE FROM backup_codes WHERE user_id = $1
		AND NOT EXISTS (SELECT 1 FROM webauthn_credentials WHERE user_id = $1)
		AND NOT EXISTS (SELECT 1 FROM totp_secrets WHERE user_id = $1 AND confirmed_at IS NOT NULL)`, userID)
	return tag.RowsAffected() > 0, err
}

// SecondStepLocked reports whether wrong codes have locked the account's
// code-based second steps.
func (t TwoStep) SecondStepLocked(ctx context.Context, userID uuid.UUID, now time.Time) (bool, error) {
	var locked bool
	err := t.Pool.QueryRow(ctx, `SELECT COALESCE(second_step_locked_until > $2, false) FROM users WHERE id = $1`,
		userID, now).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	return locked, err
}

// SecondStepFailed counts a wrong code, locking codes out with the same
// back-off as wrong passwords: after 5, for 1 minute, doubling to an hour.
func (t TwoStep) SecondStepFailed(ctx context.Context, userID uuid.UUID, now time.Time) error {
	_, err := t.Pool.Exec(ctx, `UPDATE users SET second_step_failures = second_step_failures + 1,
		second_step_locked_until = CASE WHEN second_step_failures + 1 >= 5
			THEN $2::timestamptz + make_interval(mins => LEAST(60, power(2, second_step_failures + 1 - 5)::int))
			ELSE second_step_locked_until END
		WHERE id = $1`, userID, now)
	return err
}

// SecondStepPassed clears the count after a second step succeeds.
func (t TwoStep) SecondStepPassed(ctx context.Context, userID uuid.UUID) error {
	_, err := t.Pool.Exec(ctx, `UPDATE users SET second_step_failures = 0, second_step_locked_until = NULL
		WHERE id = $1 AND second_step_failures > 0`, userID)
	return err
}

// ---------------------------------------------------------------------------
// Turning two-step sign-in off by email, after a wait

// RequestReset schedules a reset unless one is already pending, and returns
// when it is due and whether this call made it.
func (t TwoStep) RequestReset(ctx context.Context, userID uuid.UUID, now, due time.Time) (time.Time, bool, error) {
	tag, err := t.Pool.Exec(ctx, `INSERT INTO two_step_resets (user_id, requested_at, due_at) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO NOTHING`, userID, now, due)
	if err != nil {
		return time.Time{}, false, err
	}
	var at time.Time
	err = t.Pool.QueryRow(ctx, `SELECT due_at FROM two_step_resets WHERE user_id = $1`, userID).Scan(&at)
	return at, tag.RowsAffected() == 1, err
}

// PendingReset returns when a pending reset is due, or nil.
func (t TwoStep) PendingReset(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var at time.Time
	err := t.Pool.QueryRow(ctx, `SELECT due_at FROM two_step_resets WHERE user_id = $1`, userID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &at, nil
}

// CancelReset removes a pending reset and reports whether there was one.
func (t TwoStep) CancelReset(ctx context.Context, userID uuid.UUID) (bool, error) {
	tag, err := t.Pool.Exec(ctx, `DELETE FROM two_step_resets WHERE user_id = $1`, userID)
	return tag.RowsAffected() > 0, err
}

// CompleteReset carries out a reset that is due: every passkey, the TOTP
// secret, the backup codes and any second step in progress go. It reports
// whether one was due.
func (t TwoStep) CompleteReset(ctx context.Context, userID uuid.UUID, now time.Time) (bool, error) {
	tx, err := t.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `DELETE FROM two_step_resets WHERE user_id = $1 AND due_at <= $2`, userID, now)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	for _, q := range []string{
		`DELETE FROM webauthn_credentials WHERE user_id = $1`,
		`DELETE FROM totp_secrets WHERE user_id = $1`,
		`DELETE FROM backup_codes WHERE user_id = $1`,
		`DELETE FROM webauthn_ceremonies WHERE user_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, userID); err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}

// ResetNotice is a pending reset to warn an account about.
type ResetNotice struct {
	Email string
	DueAt time.Time
}

// ResetsDueSoon marks and returns the pending resets due within the next
// period that haven't had their warning yet.
func (t TwoStep) ResetsDueSoon(ctx context.Context, now time.Time, within time.Duration) ([]ResetNotice, error) {
	rows, err := t.Pool.Query(ctx, `UPDATE two_step_resets r SET reminded_at = $1 FROM users u
		WHERE u.id = r.user_id AND r.reminded_at IS NULL AND r.due_at > $1 AND r.due_at <= $2
		RETURNING u.email, r.due_at`, now, now.Add(within))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ResetNotice, error) {
		var n ResetNotice
		return n, r.Scan(&n.Email, &n.DueAt)
	})
}
