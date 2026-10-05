package store

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound means no matching row.
var ErrNotFound = errors.New("not found")

// ErrConflict means a unique constraint was hit (e.g. email taken).
var ErrConflict = errors.New("conflict")

// Wrapped is a wrapped key as stored: base64 nonce and ciphertext.
type Wrapped struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

// KdfParams are the client's Argon2id parameters.
type KdfParams struct {
	V   int    `json:"v"`
	Ops uint32 `json:"ops"`
	Mem uint32 `json:"mem"`
}

// User is an account row.
type User struct {
	ID                uuid.UUID
	Email             string
	KdfSalt           []byte
	Kdf               KdfParams
	AuthHash          []byte
	AuthSalt          []byte
	WrappedPassword   Wrapped
	WrappedRecovery   Wrapped
	RecoveryProofHash []byte
	FailedLogins      int
	LockedUntil       *time.Time
	CreatedAt         time.Time
}

// Session is a signed-in device.
type Session struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	DeviceLabel string
	CreatedAt   time.Time
	LastSeenAt  time.Time
	ExpiresAt   time.Time
}

// Accounts is the account store.
type Accounts struct{ Pool *pgxpool.Pool }

const userColumns = `id, email, kdf_salt, kdf_params, auth_hash, auth_salt, wrapped_ak_pw,
	wrapped_ak_recovery, recovery_proof_hash, failed_logins, locked_until, created_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.KdfSalt, &u.Kdf, &u.AuthHash, &u.AuthSalt, &u.WrappedPassword,
		&u.WrappedRecovery, &u.RecoveryProofHash, &u.FailedLogins, &u.LockedUntil, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// UserByEmail looks an account up by email (case-insensitive).
func (a Accounts) UserByEmail(ctx context.Context, email string) (*User, error) {
	return scanUser(a.Pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE email = $1`, email))
}

// UserByID looks an account up by id.
func (a Accounts) UserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	return scanUser(a.Pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// ---------------------------------------------------------------------------
// Email codes

// RecentCodes counts codes sent to an email for a purpose since a time.
func (a Accounts) RecentCodes(ctx context.Context, email, purpose string, since time.Time) (int, error) {
	var n int
	err := a.Pool.QueryRow(ctx,
		`SELECT count(*) FROM email_codes WHERE email = $1 AND purpose = $2 AND created_at > $3`,
		email, purpose, since).Scan(&n)
	return n, err
}

// CreateCode stores a new code; older unconsumed codes for the same email
// and purpose stop working.
func (a Accounts) CreateCode(ctx context.Context, email, purpose string, userID *uuid.UUID, codeHash []byte, expires time.Time) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`UPDATE email_codes SET consumed_at = now() WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
		email, purpose); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO email_codes (id, email, purpose, user_id, code_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		uuid.New(), email, purpose, userID, codeHash, expires); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CodeResult is the outcome of checking a code.
type CodeResult int

const (
	CodeOK CodeResult = iota
	CodeWrong
	CodeExpired // expired, used up, too many attempts, or never sent
)

// MaxCodeAttempts is how many guesses a code allows.
const MaxCodeAttempts = 5

// CheckCode verifies a code. On success the code is consumed and, when
// tokenHash is given, a token is attached to it (the sign-up token).
func (a Accounts) CheckCode(ctx context.Context, email, purpose string, matches func(stored []byte) bool,
	now time.Time, tokenHash []byte, tokenExpires time.Time,
) (CodeResult, *uuid.UUID, error) {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return CodeExpired, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id uuid.UUID
	var stored []byte
	var attempts int
	var userID *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, code_hash, attempts, user_id FROM email_codes
		WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > $3
		ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, email, purpose, now).Scan(&id, &stored, &attempts, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CodeExpired, nil, nil
	}
	if err != nil {
		return CodeExpired, nil, err
	}
	if attempts >= MaxCodeAttempts {
		return CodeExpired, nil, nil
	}
	if !matches(stored) {
		if _, err := tx.Exec(ctx, `UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1`, id); err != nil {
			return CodeExpired, nil, err
		}
		return CodeWrong, nil, tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `UPDATE email_codes SET consumed_at = $2, token_hash = $3, token_expires_at = $4 WHERE id = $1`,
		id, now, tokenHash, tokenExpires); err != nil {
		return CodeExpired, nil, err
	}
	return CodeOK, userID, tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Sign-up

// NewUser is what registration stores.
type NewUser struct {
	ID                uuid.UUID
	Email             string
	KdfSalt           []byte
	Kdf               KdfParams
	AuthHash          []byte
	AuthSalt          []byte
	WrappedPassword   Wrapped
	WrappedRecovery   Wrapped
	RecoveryProofHash []byte
}

// ErrBadToken means the sign-up token is unknown, used or expired.
var ErrBadToken = errors.New("sign-up token invalid")

// ErrBadInvite means the invite code is unknown or used.
var ErrBadInvite = errors.New("invite invalid")

// Register creates an account. It atomically uses up the sign-up token and,
// when inviteHash is non-nil, the invite.
func (a Accounts) Register(ctx context.Context, u NewUser, tokenHash, inviteHash []byte, now time.Time) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `UPDATE email_codes SET token_hash = NULL
		WHERE email = $1 AND purpose = 'signup' AND token_hash = $2 AND token_expires_at > $3`,
		u.Email, tokenHash, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrBadToken
	}
	if _, err := tx.Exec(ctx, `INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash, auth_salt,
		wrapped_ak_pw, wrapped_ak_recovery, recovery_proof_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		u.ID, u.Email, u.KdfSalt, u.Kdf, u.AuthHash, u.AuthSalt, u.WrappedPassword, u.WrappedRecovery,
		u.RecoveryProofHash); err != nil {
		if isUnique(err) {
			return ErrConflict
		}
		return err
	}
	if inviteHash != nil {
		tag, err := tx.Exec(ctx, `UPDATE invite_codes SET used_by = $2, used_at = $3
			WHERE code_hash = $1 AND used_at IS NULL`, inviteHash, u.ID, now)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ErrBadInvite
		}
	}
	return tx.Commit(ctx)
}

// InviteUsable reports whether an invite exists and is unused.
func (a Accounts) InviteUsable(ctx context.Context, inviteHash []byte) (bool, error) {
	var ok bool
	err := a.Pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM invite_codes WHERE code_hash = $1 AND used_at IS NULL)`, inviteHash).Scan(&ok)
	return ok, err
}

// CreateInvites stores new invite codes (as hashes).
func (a Accounts) CreateInvites(ctx context.Context, hashes [][]byte) error {
	batch := &pgx.Batch{}
	for _, h := range hashes {
		batch.Queue(`INSERT INTO invite_codes (code_hash) VALUES ($1)`, h)
	}
	return a.Pool.SendBatch(ctx, batch).Close()
}

// ---------------------------------------------------------------------------
// Login state

// RecordFailedLogin counts a failure and locks the account with backoff
// after five: 1, 2, 4 … minutes, capped at an hour.
func (a Accounts) RecordFailedLogin(ctx context.Context, id uuid.UUID, now time.Time) error {
	_, err := a.Pool.Exec(ctx, `UPDATE users SET failed_logins = failed_logins + 1,
		locked_until = CASE WHEN failed_logins + 1 >= 5
			THEN $2::timestamptz + make_interval(mins => LEAST(60, power(2, failed_logins + 1 - 5)::int))
			ELSE locked_until END
		WHERE id = $1`, id, now)
	return err
}

// ResetFailedLogins clears the failure count after a successful login.
func (a Accounts) ResetFailedLogins(ctx context.Context, id uuid.UUID) error {
	_, err := a.Pool.Exec(ctx, `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, id)
	return err
}

// UpdateCredentials replaces the password-derived values (password change
// or recovery) and signs out every other session.
func (a Accounts) UpdateCredentials(ctx context.Context, id uuid.UUID, kdfSalt []byte, kdf KdfParams,
	authHash, authSalt []byte, wrapped Wrapped, keepSession *uuid.UUID,
) error {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE users SET kdf_salt = $2, kdf_params = $3, auth_hash = $4, auth_salt = $5,
		wrapped_ak_pw = $6, failed_logins = 0, locked_until = NULL WHERE id = $1`,
		id, kdfSalt, kdf, authHash, authSalt, wrapped); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)`,
		id, keepSession); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateEmail changes the login email.
func (a Accounts) UpdateEmail(ctx context.Context, id uuid.UUID, email string) error {
	_, err := a.Pool.Exec(ctx, `UPDATE users SET email = $2 WHERE id = $1`, id, email)
	if isUnique(err) {
		return ErrConflict
	}
	return err
}

// DeleteUser removes the account and everything attached to it.
func (a Accounts) DeleteUser(ctx context.Context, id uuid.UUID) error {
	_, err := a.Pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

// ---------------------------------------------------------------------------
// Sessions

// CreateSession signs in a device.
func (a Accounts) CreateSession(ctx context.Context, userID uuid.UUID, tokenHash []byte, label string, now, expires time.Time) (uuid.UUID, error) {
	id := uuid.New()
	_, err := a.Pool.Exec(ctx, `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, last_seen_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $5, $6)`, id, userID, tokenHash, label, now, expires)
	return id, err
}

// SessionByToken finds a live session by token hash.
func (a Accounts) SessionByToken(ctx context.Context, tokenHash []byte, now time.Time) (*Session, error) {
	var s Session
	err := a.Pool.QueryRow(ctx, `SELECT id, user_id, device_label, created_at, last_seen_at, expires_at
		FROM sessions WHERE token_hash = $1 AND expires_at > $2`, tokenHash, now).
		Scan(&s.ID, &s.UserID, &s.DeviceLabel, &s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

// TouchSession records use and extends the expiry (sliding sessions).
func (a Accounts) TouchSession(ctx context.Context, id uuid.UUID, now, expires time.Time) error {
	_, err := a.Pool.Exec(ctx, `UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id = $1`, id, now, expires)
	return err
}

// ListSessions returns a user's signed-in devices, newest first.
func (a Accounts) ListSessions(ctx context.Context, userID uuid.UUID, now time.Time) ([]Session, error) {
	rows, err := a.Pool.Query(ctx, `SELECT id, user_id, device_label, created_at, last_seen_at, expires_at
		FROM sessions WHERE user_id = $1 AND expires_at > $2 ORDER BY last_seen_at DESC`, userID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Session, error) {
		var s Session
		err := r.Scan(&s.ID, &s.UserID, &s.DeviceLabel, &s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt)
		return s, err
	})
}

// DeleteSession signs out one device of a user.
func (a Accounts) DeleteSession(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	tag, err := a.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND id = $2`, userID, id)
	return tag.RowsAffected() == 1, err
}

// JSONB columns are encoded explicitly: with QueryExecModeExec (needed for
// Neon's pooler, see db.go) pgx doesn't know parameter types, so structs
// must turn themselves into JSON text, which Postgres reads as jsonb.

func jsonValue(v any) (driver.Value, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func jsonScan(dst any, src any) error {
	switch s := src.(type) {
	case []byte:
		return json.Unmarshal(s, dst)
	case string:
		return json.Unmarshal([]byte(s), dst)
	default:
		return fmt.Errorf("cannot scan %T into JSON", src)
	}
}

func (w Wrapped) Value() (driver.Value, error)   { return jsonValue(w) }
func (w *Wrapped) Scan(src any) error            { return jsonScan(w, src) }
func (k KdfParams) Value() (driver.Value, error) { return jsonValue(k) }
func (k *KdfParams) Scan(src any) error          { return jsonScan(k, src) }
