package auth

import (
	"bytes"
	"regexp"
	"testing"
)

func TestKeysRequireLongSecret(t *testing.T) {
	if _, err := NewKeys([]byte("short")); err == nil {
		t.Fatal("accepted a short secret")
	}
}

func TestHashesAreBoundAndStable(t *testing.T) {
	k, err := NewKeys(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	a := k.CodeHash("a@example.com", "signup", "123456")
	if !Equal(a, k.CodeHash("a@example.com", "signup", "123456")) {
		t.Error("code hash not stable")
	}
	if Equal(a, k.CodeHash("a@example.com", "email_change", "123456")) {
		t.Error("code hash not bound to purpose")
	}
	if Equal(a, k.CodeHash("b@example.com", "signup", "123456")) {
		t.Error("code hash not bound to email")
	}
	if len(k.FakeSalt("x@example.com")) != 16 || !bytes.Equal(k.FakeSalt("x@example.com"), k.FakeSalt("x@example.com")) {
		t.Error("fake salt must be 16 stable bytes")
	}
}

func TestAuthKeyHashing(t *testing.T) {
	key := bytes.Repeat([]byte{1}, 32)
	salt, hash, err := HashAuthKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyAuthKey(key, salt, hash) {
		t.Error("correct key rejected")
	}
	if VerifyAuthKey(bytes.Repeat([]byte{2}, 32), salt, hash) {
		t.Error("wrong key accepted")
	}
}

func TestCodesAndTokens(t *testing.T) {
	for range 50 {
		c, err := NewCode()
		if err != nil || !regexp.MustCompile(`^\d{6}$`).MatchString(c) {
			t.Fatalf("bad code %q (%v)", c, err)
		}
		inv, _ := NewInviteCode()
		if !regexp.MustCompile(`^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$`).MatchString(inv) {
			t.Fatalf("bad invite %q", inv)
		}
	}
	tok, hash, err := NewToken()
	if err != nil || len(tok) < 40 || !Equal(hash, TokenHash(tok)) {
		t.Fatal("token/hash mismatch")
	}
}

func TestInviteHashIgnoresCaseAndSpaces(t *testing.T) {
	if !Equal(InviteHash("abcd-efgh-jkmn"), InviteHash("  ABCD-EFGH-JKMN ")) {
		t.Error("invite hash should ignore case and surrounding spaces")
	}
	if Equal(InviteHash("ABCD-EFGH-JKMN"), InviteHash("ABCD-EFGH-JKMP")) {
		t.Error("different codes must hash differently")
	}
}
