package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // RFC 6238 TOTP: HMAC-SHA-1 is what authenticator apps expect
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/chacha20poly1305"
)

// Two-step sign-in codes (PLAN.md §10.2, decision 30): TOTP for authenticator
// apps, and single-use backup codes.

const (
	// TOTPPeriod and TOTPDigits are the defaults every authenticator app
	// supports (RFC 6238 with HMAC-SHA-1).
	TOTPPeriod = 30
	TOTPDigits = 6
	totpSkew   = 1 // steps either side of now, for clocks that drift
)

// NewTOTPSecret returns a random 160-bit TOTP secret (RFC 4226's
// recommended length).
func NewTOTPSecret() ([]byte, error) {
	b := make([]byte, 20)
	_, err := rand.Read(b)
	return b, err
}

var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// TOTPSecretText is the secret as people type it into an app.
func TOTPSecretText(secret []byte) string { return totpBase32.EncodeToString(secret) }

// TOTPURI is the otpauth:// URI an authenticator app scans as a QR code.
func TOTPURI(secret []byte, issuer, account string) string {
	q := url.Values{}
	q.Set("secret", TOTPSecretText(secret))
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprint(TOTPDigits))
	q.Set("period", fmt.Sprint(TOTPPeriod))
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + q.Encode()
}

// TOTPStep is the 30-second step a time falls in.
func TOTPStep(t time.Time) int64 { return t.Unix() / TOTPPeriod }

// TOTPCode is the code for one step (RFC 4226 §5.3 truncation).
func TOTPCode(secret []byte, step int64) string {
	m := hmac.New(sha1.New, secret)
	_ = binary.Write(m, binary.BigEndian, uint64(step))
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	n := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", TOTPDigits, n%1_000_000)
}

// MatchTOTP checks a code against the steps around now, accepting only
// steps after the last one used, so no code works twice. It returns the
// step that matched.
func MatchTOTP(secret []byte, code string, now time.Time, lastStep int64) (int64, bool) {
	cur := TOTPStep(now)
	var found int64
	ok := 0
	for s := cur - totpSkew; s <= cur+totpSkew; s++ {
		// Every step is checked, so timing doesn't say which one matched.
		match := subtle.ConstantTimeCompare([]byte(TOTPCode(secret, s)), []byte(code))
		if match == 1 && s > lastStep && ok == 0 {
			found, ok = s, 1
		}
	}
	return found, ok == 1
}

// SealTOTP encrypts a TOTP secret for storage, bound to its account (aad),
// so the database alone can't produce codes.
func (k Keys) SealTOTP(secret, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(k.totp)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize(), aead.NonceSize()+len(secret)+aead.Overhead())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, secret, aad), nil
}

// OpenTOTP decrypts a secret sealed by SealTOTP for the same account.
func (k Keys) OpenTOTP(sealed, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(k.totp)
	if err != nil {
		return nil, err
	}
	if len(sealed) < aead.NonceSize() {
		return nil, errors.New("sealed TOTP secret too short")
	}
	return aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], aad)
}

// BackupCodeCount is how many backup codes are made at a time.
const BackupCodeCount = 10

const backupAlphabet = "abcdefghjkmnpqrstuvwxyz23456789" // no 0/o, 1/i/l

// NewBackupCodes returns BackupCodeCount codes like "k7q2m-9xd4t", about
// 49 bits each.
func NewBackupCodes() ([]string, error) {
	out := make([]string, BackupCodeCount)
	for i := range out {
		b := make([]byte, 0, 11)
		for j := range 10 {
			if j == 5 {
				b = append(b, '-')
			}
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(backupAlphabet))))
			if err != nil {
				return nil, err
			}
			b = append(b, backupAlphabet[n.Int64()])
		}
		out[i] = string(b)
	}
	return out, nil
}

// NormalizeCode makes a typed code comparable: lower case, without spaces
// or hyphens.
func NormalizeCode(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == ' ' || r == '-' || r == '\t':
			return -1
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		}
		return r
	}, s)
}

// IsBackupCode reports whether a normalised code has a backup code's shape.
func IsBackupCode(code string) bool {
	if len(code) != 10 {
		return false
	}
	for _, r := range code {
		if !strings.ContainsRune(backupAlphabet, r) {
			return false
		}
	}
	return true
}

// BackupCodeHash is what's stored for a backup code: keyed, so a database
// leak alone can't be searched for codes, and bound to the account.
func (k Keys) BackupCodeHash(userID, code string) []byte {
	return k.mac(k.backup, "backup-code", userID, NormalizeCode(code))
}
