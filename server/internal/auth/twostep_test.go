package auth

import (
	"bytes"
	"encoding/base32"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestTOTPMatchesRFC6238(t *testing.T) {
	// RFC 6238 appendix B, SHA-1, last six digits of each eight-digit code.
	secret := []byte("12345678901234567890")
	for _, v := range []struct {
		unix int64
		code string
	}{{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"}, {1234567890, "005924"}, {2000000000, "279037"}} {
		if got := TOTPCode(secret, TOTPStep(time.Unix(v.unix, 0))); got != v.code {
			t.Errorf("TOTP at %d = %s, want %s", v.unix, got, v.code)
		}
	}
}

func TestMatchTOTP(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil || len(secret) != 20 {
		t.Fatalf("secret %x (%v)", secret, err)
	}
	now := time.Unix(1_800_000_000, 0)
	cur := TOTPStep(now)
	for _, d := range []int64{-1, 0, 1} {
		if s, ok := MatchTOTP(secret, TOTPCode(secret, cur+d), now, 0); !ok || s != cur+d {
			t.Errorf("step %+d = %d %v", d, s, ok)
		}
	}
	for _, d := range []int64{-2, 2} {
		if _, ok := MatchTOTP(secret, TOTPCode(secret, cur+d), now, 0); ok {
			t.Errorf("step %+d accepted", d)
		}
	}
	if _, ok := MatchTOTP(secret, TOTPCode(secret, cur), now, cur); ok {
		t.Error("a used step was accepted again")
	}
	if _, ok := MatchTOTP(secret, TOTPCode(secret, cur+1), now, cur); !ok {
		t.Error("the next step was refused after a used one")
	}
	if _, ok := MatchTOTP(secret, "", now, 0); ok {
		t.Error("empty code accepted")
	}
}

func TestTOTPURI(t *testing.T) {
	secret := []byte("12345678901234567890")
	u := TOTPURI(secret, "Dayrule", "pat@example.com")
	want := "otpauth://totp/Dayrule:pat@example.com?algorithm=SHA1&digits=6&issuer=Dayrule&period=30&secret=" +
		base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret)
	if u != want {
		t.Errorf("uri = %s", u)
	}
}

func TestSealedTOTPSecret(t *testing.T) {
	k, _ := NewKeys(bytes.Repeat([]byte{7}, 32))
	secret, _ := NewTOTPSecret()
	sealed, err := k.SealTOTP(secret, []byte("user-a"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, secret) {
		t.Fatal("secret stored in the clear")
	}
	if got, err := k.OpenTOTP(sealed, []byte("user-a")); err != nil || !bytes.Equal(got, secret) {
		t.Errorf("open = %x %v", got, err)
	}
	if _, err := k.OpenTOTP(sealed, []byte("user-b")); err == nil {
		t.Error("opened for another account")
	}
	other, _ := NewKeys(bytes.Repeat([]byte{8}, 32))
	if _, err := other.OpenTOTP(sealed, []byte("user-a")); err == nil {
		t.Error("opened with another AUTH_SECRET")
	}
}

func TestBackupCodes(t *testing.T) {
	codes, err := NewBackupCodes()
	if err != nil || len(codes) != BackupCodeCount {
		t.Fatalf("codes %v (%v)", codes, err)
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if !regexp.MustCompile(`^[a-z2-9]{5}-[a-z2-9]{5}$`).MatchString(c) || !IsBackupCode(NormalizeCode(c)) {
			t.Errorf("bad code %q", c)
		}
		seen[c] = true
	}
	if len(seen) != len(codes) {
		t.Error("duplicate codes")
	}
	if IsBackupCode("123456") || IsBackupCode("0000000000") {
		t.Error("not a backup code")
	}
	k, _ := NewKeys(bytes.Repeat([]byte{7}, 32))
	h := k.BackupCodeHash("u1", codes[0])
	if !Equal(h, k.BackupCodeHash("u1", " "+strings.ToUpper(strings.ReplaceAll(codes[0], "-", " "))+" ")) {
		t.Error("hash not normalised")
	}
	if Equal(h, k.BackupCodeHash("u2", codes[0])) {
		t.Error("hash not bound to the account")
	}
}
