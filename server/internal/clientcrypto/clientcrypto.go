// Package clientcrypto mirrors the browser's key derivation and record
// encryption (web/src/crypto/primitives.ts, PLAN.md §10.2–10.3).
//
// The server never derives user keys or decrypts records; this package
// exists so the shared test vectors (docs/crypto-vectors.json) are checked
// by a second, independent implementation, and for future tools such as an
// export verifier.
package clientcrypto

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
	"golang.org/x/text/unicode/norm"
)

const (
	KeyBytes  = 32
	SaltBytes = 16

	LabelAuth         = "dayrule/auth/v1"
	LabelKEK          = "dayrule/kek/v1"
	LabelRecovery     = "dayrule/recovery/v1"
	LabelWrapUnderKEK = "dayrule/wrap/password/v1"
	LabelWrapRecovery = "dayrule/wrap/recovery/v1"
	LabelRecord       = "dayrule/record/v1"
)

// KdfParams mirrors the per-user Argon2id parameters.
type KdfParams struct {
	V   int    `json:"v"`
	Ops uint32 `json:"ops"`
	Mem uint32 `json:"mem"` // bytes
}

// MasterKey derives the 32-byte master key from a password (NFKC-normalised).
func MasterKey(password string, salt []byte, p KdfParams) ([]byte, error) {
	if len(salt) != SaltBytes {
		return nil, errors.New("salt must be 16 bytes")
	}
	return argon2.IDKey([]byte(norm.NFKC.String(password)), salt, p.Ops, p.Mem/1024, 1, KeyBytes), nil
}

// HKDF is HKDF-SHA256 with an empty salt and a text label as info.
func HKDF(ikm []byte, label string) ([]byte, error) {
	out := make([]byte, KeyBytes)
	if _, err := io.ReadFull(hkdf.New(sha256.New, ikm, nil, []byte(label)), out); err != nil {
		return nil, err
	}
	return out, nil
}

// Seal encrypts with XChaCha20-Poly1305.
func Seal(key, nonce, plaintext, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	return aead.Seal(nil, nonce, plaintext, aad), nil
}

// Open decrypts with XChaCha20-Poly1305.
func Open(key, nonce, ciphertext, aad []byte) ([]byte, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ciphertext, aad)
}

// WrapAAD binds a wrapped key to its purpose and user.
func WrapAAD(label, userID string) []byte {
	return []byte(label + "|" + userID)
}

// RecordAAD binds a record ciphertext to its user, record, schema, suite and key.
func RecordAAD(userID, recordID string, schemaVersion, keyID int) []byte {
	return fmt.Appendf(nil, "%s|%s|%s|v%d|alg1|key%d", LabelRecord, userID, recordID, schemaVersion, keyID)
}

// Unpad removes the ISO/IEC 7816-4 padding added before encryption.
func Unpad(b []byte) ([]byte, error) {
	i := len(b) - 1
	for i >= 0 && b[i] == 0 {
		i--
	}
	if i < 0 || b[i] != 0x80 {
		return nil, errors.New("bad padding")
	}
	return b[:i], nil
}

// OpenRecord decrypts and unpads a record into v.
func OpenRecord(ak, nonce, ciphertext []byte, userID, recordID string, schemaVersion, keyID int, v any) error {
	padded, err := Open(ak, nonce, ciphertext, RecordAAD(userID, recordID, schemaVersion, keyID))
	if err != nil {
		return err
	}
	plain, err := Unpad(padded)
	if err != nil {
		return err
	}
	return json.Unmarshal(plain, v)
}
