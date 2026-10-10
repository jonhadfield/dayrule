package store

import (
	"context"
	"crypto/rand"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MaxPasskeys caps how many sign-in passkeys an account can have.
const MaxPasskeys = 10

// ErrTooMany means the account already has MaxPasskeys passkeys.
var ErrTooMany = errors.New("too many passkeys")

// Authenticator-data flag bits (WebAuthn §6.1) kept in Passkey.Flags.
const (
	FlagBackupEligible = 1 << 3
	FlagBackupState    = 1 << 4
)

// Passkey is a WebAuthn credential the server verifies as the second step
// at sign-in (PLAN.md §10.2, decision 30). It holds a public key, never
// anything that can decrypt the account.
type Passkey struct {
	CredentialID      []byte
	RPID              string
	PublicKey         []byte
	SignCount         int64
	CloneWarning      bool
	Flags             uint8
	AAGUID            []byte
	Transports        []string
	Attachment        string
	AttestationType   string
	AttestationFormat string
	Label             string
	CreatedAt         time.Time
	LastUsedAt        *time.Time
}

// Passkeys stores sign-in passkeys and passkey ceremonies in progress.
type Passkeys struct{ Accounts }

// Handle returns the user's WebAuthn user handle, making it on first use.
func (p Passkeys) Handle(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	fresh := make([]byte, 32)
	if _, err := rand.Read(fresh); err != nil {
		return nil, err
	}
	var h []byte
	err := p.Pool.QueryRow(ctx, `UPDATE users SET webauthn_handle = COALESCE(webauthn_handle, $2)
		WHERE id = $1 RETURNING webauthn_handle`, userID, fresh).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return h, err
}

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
	_, err = tx.Exec(ctx, `INSERT INTO webauthn_credentials (credential_id, user_id, rp_id, public_key, sign_count,
		clone_warning, flags, backup_eligible, backup_state, aaguid, transports, attachment, attestation_type,
		attestation_format, label, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		k.CredentialID, userID, k.RPID, k.PublicKey, k.SignCount, k.CloneWarning, int16(k.Flags),
		k.Flags&FlagBackupEligible != 0, k.Flags&FlagBackupState != 0, k.AAGUID, transports, k.Attachment,
		k.AttestationType, k.AttestationFormat, k.Label, now)
	if isUnique(err) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// List returns an account's passkeys on every relying party, oldest first.
func (p Passkeys) List(ctx context.Context, userID uuid.UUID) ([]Passkey, error) {
	rows, err := p.Pool.Query(ctx, `SELECT credential_id, rp_id, public_key, sign_count, clone_warning, flags,
		aaguid, transports, attachment, attestation_type, attestation_format, label, created_at, last_used_at
		FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at, credential_id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Passkey, error) {
		var k Passkey
		var flags int16
		err := r.Scan(&k.CredentialID, &k.RPID, &k.PublicKey, &k.SignCount, &k.CloneWarning, &flags,
			&k.AAGUID, &k.Transports, &k.Attachment, &k.AttestationType, &k.AttestationFormat, &k.Label,
			&k.CreatedAt, &k.LastUsedAt)
		k.Flags = uint8(flags)
		return k, err
	})
}

// Used records a successful sign-in with a passkey: the values the
// verification updated (signature counter, clone warning, flags).
func (p Passkeys) Used(ctx context.Context, userID uuid.UUID, credentialID []byte, signCount int64,
	cloneWarning bool, flags uint8, now time.Time) error {
	tag, err := p.Pool.Exec(ctx, `UPDATE webauthn_credentials
		SET sign_count = $3, clone_warning = $4, flags = $5, backup_state = $6, last_used_at = $7
		WHERE user_id = $1 AND credential_id = $2`,
		userID, credentialID, signCount, cloneWarning, int16(flags), flags&FlagBackupState != 0, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes one of an account's passkeys and returns its label.
func (p Passkeys) Delete(ctx context.Context, userID uuid.UUID, credentialID []byte) (string, error) {
	var label string
	err := p.Pool.QueryRow(ctx, `DELETE FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2
		RETURNING label`, userID, credentialID).Scan(&label)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return label, err
}

// ---------------------------------------------------------------------------
// Ceremonies in progress

// Ceremony purposes.
const (
	CeremonyRegister = "register"
	CeremonyLogin    = "login"
)

// A Ceremony is a passkey registration or sign-in second step in progress.
type Ceremony struct {
	UserID      uuid.UUID
	Purpose     string
	SessionID   *uuid.UUID // register: the session that started it
	DeviceLabel string     // login: the label for the new session
	Data        []byte     // go-webauthn SessionData (JSON), while a challenge is out
}

// StartCeremony stores a new ceremony under the hash of its token, with
// its first challenge when data is given.
func (p Passkeys) StartCeremony(ctx context.Context, tokenHash []byte, c Ceremony, data []byte, expires time.Time) error {
	var d *string
	attempts := 0
	if data != nil {
		s := string(data)
		d, attempts = &s, 1
	}
	_, err := p.Pool.Exec(ctx, `INSERT INTO webauthn_ceremonies (token_hash, user_id, purpose, session_id,
		device_label, data, attempts, expires_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
		tokenHash, c.UserID, c.Purpose, c.SessionID, c.DeviceLabel, d, attempts, expires)
	return err
}

// CeremonyUser returns the user of a live ceremony that may still be given
// a challenge.
func (p Passkeys) CeremonyUser(ctx context.Context, tokenHash []byte, purpose string, now time.Time,
	maxChallenges int) (uuid.UUID, error) {
	var id uuid.UUID
	err := p.Pool.QueryRow(ctx, `SELECT user_id FROM webauthn_ceremonies
		WHERE token_hash = $1 AND purpose = $2 AND expires_at > $3 AND attempts < $4`,
		tokenHash, purpose, now, maxChallenges).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return id, err
}

// IssueChallenge attaches a new challenge to a live ceremony, replacing any
// earlier one. Each ceremony gets at most maxChallenges; after that, and
// once it has expired, it is ErrNotFound.
func (p Passkeys) IssueChallenge(ctx context.Context, tokenHash []byte, purpose string, data []byte,
	now time.Time, maxChallenges int) error {
	tag, err := p.Pool.Exec(ctx, `UPDATE webauthn_ceremonies SET data = $3::jsonb, attempts = attempts + 1
		WHERE token_hash = $1 AND purpose = $2 AND expires_at > $4 AND attempts < $5`,
		tokenHash, purpose, string(data), now, maxChallenges)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// TakeChallenge returns a live ceremony with its outstanding challenge and
// clears the challenge, so each one can be answered only once. A ceremony
// with no challenge out is ErrNotFound.
func (p Passkeys) TakeChallenge(ctx context.Context, tokenHash []byte, purpose string, now time.Time) (*Ceremony, error) {
	c := Ceremony{Purpose: purpose}
	var data string
	err := p.Pool.QueryRow(ctx, `WITH old AS (
			SELECT token_hash, data FROM webauthn_ceremonies
			WHERE token_hash = $1 AND purpose = $2 AND expires_at > $3 AND data IS NOT NULL
			FOR UPDATE
		)
		UPDATE webauthn_ceremonies w SET data = NULL FROM old
		WHERE w.token_hash = old.token_hash
		RETURNING w.user_id, w.session_id, w.device_label, old.data::text`,
		tokenHash, purpose, now).Scan(&c.UserID, &c.SessionID, &c.DeviceLabel, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.Data = []byte(data)
	return &c, nil
}

// EndCeremony removes a ceremony once it has succeeded.
func (p Passkeys) EndCeremony(ctx context.Context, tokenHash []byte) error {
	_, err := p.Pool.Exec(ctx, `DELETE FROM webauthn_ceremonies WHERE token_hash = $1`, tokenHash)
	return err
}
