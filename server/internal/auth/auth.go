// Package auth holds the server's account security primitives: hashing the
// client's AuthKey, session tokens, email and invite codes, and fake salts
// for unknown emails (PLAN.md §10.2, §11.6).
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/hkdf"
)

// Keys are derived from AUTH_SECRET, one per environment.
type Keys struct {
	code     []byte // HMAC key for email codes
	fakeSalt []byte // HMAC key for deterministic fake salts
	totp     []byte // XChaCha20-Poly1305 key for TOTP secrets at rest
	backup   []byte // HMAC key for backup codes
}

// NewKeys derives the server's HMAC keys from a secret of at least 32 bytes.
func NewKeys(secret []byte) (Keys, error) {
	if len(secret) < 32 {
		return Keys{}, errors.New("AUTH_SECRET must be at least 32 bytes")
	}
	derive := func(label string) []byte {
		out := make([]byte, 32)
		if _, err := io.ReadFull(hkdf.New(sha256.New, secret, nil, []byte(label)), out); err != nil {
			panic(err) // HKDF over SHA-256 cannot fail for 32 bytes
		}
		return out
	}
	return Keys{
		code: derive("dayrule/server/code/v1"), fakeSalt: derive("dayrule/server/fake-salt/v1"),
		totp: derive("dayrule/server/totp/v1"), backup: derive("dayrule/server/backup-code/v1"),
	}, nil
}

func (k Keys) mac(key []byte, parts ...string) []byte {
	m := hmac.New(sha256.New, key)
	for _, p := range parts {
		m.Write([]byte(p))
		m.Write([]byte{0})
	}
	return m.Sum(nil)
}

// CodeHash is what's stored for an email code, bound to email and purpose.
func (k Keys) CodeHash(email, purpose, code string) []byte {
	return k.mac(k.code, "email-code", email, purpose, code)
}

// InviteHash is what's stored for an invite code: a plain SHA-256 of the
// normalised code. It needs no server secret, so the invite command can run
// against any environment with only its database URL. Invites are
// single-use and only gate sign-up, so the missing key costs little.
func InviteHash(code string) []byte {
	h := sha256.Sum256([]byte("dayrule/invite/v1\x00" + NormalizeInvite(code)))
	return h[:]
}

// NormalizeInvite makes codes case- and space-insensitive.
func NormalizeInvite(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// FakeSalt is a stable, plausible salt for an email that has no account,
// so prelogin doesn't reveal which emails are registered.
func (k Keys) FakeSalt(email string) []byte {
	return k.mac(k.fakeSalt, email)[:16]
}

// Argon2id parameters for hashing the AuthKey on the server (OWASP minimum).
// The AuthKey already came out of a strong client-side Argon2id; this extra
// hash means a database leak can't be replayed to log in.
const (
	hashTime    = 2
	hashMemory  = 19 * 1024 // KiB
	hashThreads = 1
	hashLen     = 32
)

// HashAuthKey returns a salt and Argon2id hash of the client's AuthKey.
func HashAuthKey(authKey []byte) (salt, hash []byte, err error) {
	salt = make([]byte, 16)
	if _, err = rand.Read(salt); err != nil {
		return nil, nil, err
	}
	return salt, argon2.IDKey(authKey, salt, hashTime, hashMemory, hashThreads, hashLen), nil
}

// VerifyAuthKey checks an AuthKey in constant time.
func VerifyAuthKey(authKey, salt, hash []byte) bool {
	got := argon2.IDKey(authKey, salt, hashTime, hashMemory, hashThreads, hashLen)
	return subtle.ConstantTimeCompare(got, hash) == 1
}

// BurnVerify does the same work as a real check, for unknown accounts, so
// timing doesn't reveal whether an email is registered.
func BurnVerify(authKey []byte) {
	_ = argon2.IDKey(authKey, make([]byte, 16), hashTime, hashMemory, hashThreads, hashLen)
}

// NewToken returns a random 256-bit token (base64url) and its SHA-256.
func NewToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, TokenHash(token), nil
}

// TokenHash is what's stored for a session or signup token.
func TokenHash(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// NewCode returns a uniformly random 6-digit code.
func NewCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// NewInviteCode returns a readable invite code like "K7Q2-M9XD-4TPA".
func NewInviteCode() (string, error) {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no 0/O, 1/I/L
	out := make([]byte, 0, 14)
	for i := range 12 {
		if i > 0 && i%4 == 0 {
			out = append(out, '-')
		}
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		out = append(out, alphabet[n.Int64()])
	}
	return string(out), nil
}

// Equal compares two hashes in constant time.
func Equal(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}
