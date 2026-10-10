package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MaxPasskeys caps how many sign-in passkeys an account can have.
const MaxPasskeys = 10

// ErrTooMany means the account already has MaxPasskeys passkeys.
var ErrTooMany = errors.New("too many passkeys")

// Passkey is a WebAuthn credential the server verifies as the second step
// at sign-in (PLAN.md §10.2, decision 30). It holds a public key, never
// anything that can decrypt the account.
type Passkey struct {
	CredentialID   []byte
	PublicKey      []byte
	SignCount      int64
	AAGUID         []byte
	Transports     []string
	BackupEligible bool
	BackupState    bool
	Label          string
	CreatedAt      time.Time
	LastUsedAt     *time.Time
}

// Passkeys stores sign-in passkeys.
type Passkeys struct{ Accounts }

// Add stores a newly registered passkey. A credential id that is already
// registered, to any account, is ErrConflict.
func (p Passkeys) Add(ctx context.Context, userID uuid.UUID, k Passkey, now time.Time) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Lock the user row so two registrations can't both pass the cap.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
		return err
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM webauthn_credentials WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return err
	}
	if n >= MaxPasskeys {
		return ErrTooMany
	}
	transports := k.Transports
	if transports == nil {
		transports = []string{}
	}
	_, err = tx.Exec(ctx, `INSERT INTO webauthn_credentials (credential_id, user_id, public_key, sign_count, aaguid,
		transports, backup_eligible, backup_state, label, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		k.CredentialID, userID, k.PublicKey, k.SignCount, k.AAGUID, transports,
		k.BackupEligible, k.BackupState, k.Label, now)
	if isUnique(err) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// List returns an account's passkeys, oldest first.
func (p Passkeys) List(ctx context.Context, userID uuid.UUID) ([]Passkey, error) {
	rows, err := p.Pool.Query(ctx, `SELECT credential_id, public_key, sign_count, aaguid, transports,
		backup_eligible, backup_state, label, created_at, last_used_at
		FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at, credential_id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Passkey, error) {
		var k Passkey
		err := r.Scan(&k.CredentialID, &k.PublicKey, &k.SignCount, &k.AAGUID, &k.Transports,
			&k.BackupEligible, &k.BackupState, &k.Label, &k.CreatedAt, &k.LastUsedAt)
		return k, err
	})
}

// Used records a successful sign-in with a passkey: its new signature
// counter and backup state. The caller has already checked the counter.
func (p Passkeys) Used(ctx context.Context, userID uuid.UUID, credentialID []byte, signCount int64,
	backupState bool, now time.Time) error {
	tag, err := p.Pool.Exec(ctx, `UPDATE webauthn_credentials
		SET sign_count = $3, backup_state = $4, last_used_at = $5
		WHERE user_id = $1 AND credential_id = $2`, userID, credentialID, signCount, backupState, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes one of an account's passkeys.
func (p Passkeys) Delete(ctx context.Context, userID uuid.UUID, credentialID []byte) (bool, error) {
	tag, err := p.Pool.Exec(ctx, `DELETE FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2`,
		userID, credentialID)
	return tag.RowsAffected() == 1, err
}
