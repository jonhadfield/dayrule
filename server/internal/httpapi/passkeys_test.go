package httpapi

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

const testOrigin = "https://dayrule.test"

// ---------------------------------------------------------------------------
// A software authenticator: ES256, "none" attestation, real signatures, so
// go-webauthn's verification runs unmodified.

type authenticator struct {
	t      *testing.T
	key    *ecdsa.PrivateKey
	id     []byte
	rpID   string
	origin string
	count  uint32
	flags  byte // extra authenticator-data flags, such as backup eligible
}

func newAuthenticator(t *testing.T) *authenticator {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &authenticator{t: t, key: key, id: id, rpID: "dayrule.test", origin: testOrigin}
}

var b64url = base64.RawURLEncoding

func (k *authenticator) authData(attested bool) []byte {
	rp := sha256.Sum256([]byte(k.rpID))
	flags := byte(0x01|0x04) | k.flags // user present, user verified
	if attested {
		flags |= 0x40
	}
	out := append(rp[:], flags)
	out = binary.BigEndian.AppendUint32(out, k.count)
	if attested {
		out = append(out, make([]byte, 16)...) // AAGUID
		out = binary.BigEndian.AppendUint16(out, uint16(len(k.id)))
		out = append(out, k.id...)
		enc, _ := cbor.CanonicalEncOptions().EncMode()
		pub, err := enc.Marshal(map[int]any{
			1: 2, 3: -7, -1: 1, // EC2, ES256, P-256
			-2: k.key.X.FillBytes(make([]byte, 32)),
			-3: k.key.Y.FillBytes(make([]byte, 32)),
		})
		if err != nil {
			k.t.Fatal(err)
		}
		out = append(out, pub...)
	}
	return out
}

func (k *authenticator) clientData(typ string, options map[string]any) []byte {
	pk := options["publicKey"].(map[string]any)
	b, _ := json.Marshal(map[string]any{"type": typ, "challenge": pk["challenge"], "origin": k.origin, "crossOrigin": false})
	return b
}

// create answers registration options with a new credential.
func (k *authenticator) create(options map[string]any) map[string]any {
	k.t.Helper()
	att, err := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": k.authData(true)})
	if err != nil {
		k.t.Fatal(err)
	}
	return map[string]any{
		"id": b64url.EncodeToString(k.id), "rawId": b64url.EncodeToString(k.id), "type": "public-key",
		"authenticatorAttachment": "platform", "clientExtensionResults": map[string]any{},
		"response": map[string]any{
			"clientDataJSON":    b64url.EncodeToString(k.clientData("webauthn.create", options)),
			"attestationObject": b64url.EncodeToString(att),
			"transports":        []string{"internal", "hybrid"},
		},
	}
}

// get answers sign-in options with a signed assertion.
func (k *authenticator) get(options map[string]any) map[string]any {
	k.t.Helper()
	k.count++
	cd := k.clientData("webauthn.get", options)
	ad := k.authData(false)
	h := sha256.Sum256(cd)
	digest := sha256.Sum256(append(append([]byte{}, ad...), h[:]...))
	sig, err := ecdsa.SignASN1(rand.Reader, k.key, digest[:])
	if err != nil {
		k.t.Fatal(err)
	}
	return map[string]any{
		"id": b64url.EncodeToString(k.id), "rawId": b64url.EncodeToString(k.id), "type": "public-key",
		"authenticatorAttachment": "platform", "clientExtensionResults": map[string]any{},
		"response": map[string]any{
			"clientDataJSON":    b64url.EncodeToString(cd),
			"authenticatorData": b64url.EncodeToString(ad),
			"signature":         b64url.EncodeToString(sig),
		},
	}
}

// ---------------------------------------------------------------------------
// Helpers

func options(t *testing.T, r resp) map[string]any {
	t.Helper()
	o, ok := r.body["options"].(map[string]any)
	if r.code != 200 || !ok {
		t.Fatalf("options = %d %v", r.code, r.body)
	}
	return o
}

// addPasskey registers k on a's account from a's signed-in client.
func addPasskey(t *testing.T, a account, k *authenticator, label string) resp {
	t.Helper()
	a.c.origin = testOrigin
	r := a.c.do("POST", "/api/v1/account/passkeys/options", map[string]any{"currentAuthKey": a.authKey})
	opts := options(t, r)
	return a.c.do("POST", "/api/v1/account/passkeys", map[string]any{
		"token": r.body["token"], "credential": k.create(opts), "label": label,
	})
}

// passwordStep signs in with the password on a new device and returns the
// second-step token.
func passwordStep(t *testing.T, hs *harness, a account) (*client, string) {
	t.Helper()
	c := &client{hs: hs, origin: testOrigin}
	r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey, "deviceLabel": "Laptop"})
	step, ok := r.body["secondStep"].(map[string]any)
	if r.code != 200 || !ok {
		t.Fatalf("login = %d %v, want a second step", r.code, r.body)
	}
	if r.body["wrappedPassword"] != nil || c.cookie != "" {
		t.Fatalf("the password alone gave a session or the wrapped key: %v", r.body)
	}
	if m := step["methods"].([]any); len(m) != 1 || m[0] != "passkey" {
		t.Errorf("methods = %v", m)
	}
	return c, step["token"].(string)
}

func passkeyStep(c *client, token string, k *authenticator) resp {
	c.hs.t.Helper()
	opts := options(c.hs.t, c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}))
	return c.do("POST", "/api/v1/auth/login/passkey", map[string]any{"token": token, "credential": k.get(opts)})
}

func wantCode(t *testing.T, what string, r resp, status int, code string) {
	t.Helper()
	if r.code != status || (code != "" && r.body["code"] != code) {
		t.Errorf("%s = %d %v, want %d %s", what, r.code, r.body, status, code)
	}
}

// ---------------------------------------------------------------------------
// Tests

func TestPasskeySignIn(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("pat@example.com")
	key := newAuthenticator(t)
	key.flags = 0x08 // backup eligible, like a synced passkey

	r := addPasskey(t, a, key, "  MacBook  ")
	if r.code != 201 || r.body["label"] != "MacBook" || r.body["site"] != "dayrule.test" {
		t.Fatalf("add = %d %v", r.code, r.body)
	}
	if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "passkey was added") || !strings.Contains(m.Text, `"MacBook"`) {
		t.Errorf("notice = %q", m.Subject)
	}
	list := a.c.do("GET", "/api/v1/account/passkeys", nil)
	if ks := list.body["passkeys"].([]any); len(ks) != 1 || ks[0].(map[string]any)["id"] != b64url.EncodeToString(key.id) {
		t.Errorf("list = %v", list.body)
	}

	// The password alone is no longer enough; with the passkey it is.
	c, token := passwordStep(t, hs, a)
	r = passkeyStep(c, token, key)
	if r.code != 200 || r.body["userId"] != a.userID || r.body["wrappedPassword"] == nil || c.cookie == "" {
		t.Fatalf("passkey step = %d %v", r.code, r.body)
	}
	if acc := c.do("GET", "/api/v1/account", nil); acc.code != 200 {
		t.Errorf("account with the new session = %d", acc.code)
	}
	last := a.c.do("GET", "/api/v1/account/passkeys", nil).body["passkeys"].([]any)[0].(map[string]any)
	if last["lastUsedAt"] == nil {
		t.Error("lastUsedAt not recorded")
	}

	t.Run("a finished step can't be replayed", func(t *testing.T) {
		wantCode(t, "options again", c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}),
			400, "bad_ceremony")
	})

	t.Run("a wrong passkey fails; the right one can still follow", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		wantCode(t, "stranger's passkey", passkeyStep(c, token, newAuthenticator(t)), 401, "bad_passkey")
		if c.cookie != "" {
			t.Error("a failed step set a session")
		}
		if r := passkeyStep(c, token, key); r.code != 200 {
			t.Errorf("retry = %d %v", r.code, r.body)
		}
	})

	t.Run("each challenge is answered once", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		opts := options(t, c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}))
		cred := key.get(opts)
		bad := map[string]any{"token": token, "credential": map[string]any{"id": "x"}}
		wantCode(t, "garbage", c.do("POST", "/api/v1/auth/login/passkey", bad), 401, "bad_passkey")
		wantCode(t, "the answer after the challenge was used", c.do("POST", "/api/v1/auth/login/passkey",
			map[string]any{"token": token, "credential": cred}), 400, "bad_ceremony")
	})

	t.Run("challenges run out", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		for range maxChallenges {
			options(t, c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}))
		}
		wantCode(t, "one more", c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}),
			400, "bad_ceremony")
	})

	t.Run("the step expires", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		hs.now = hs.now.Add(ceremonyLifetime + time.Second)
		defer func() { hs.now = hs.now.Add(-ceremonyLifetime - time.Second) }()
		wantCode(t, "late options", c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}),
			400, "bad_ceremony")
	})

	t.Run("only from a known origin", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		c.origin = "https://dayrule-git-x.vercel.app"
		wantCode(t, "options", c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}),
			400, "passkey_origin")
		// And skipping the passkey from there is no way in either.
		r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
		if r.body["secondStep"] == nil || c.cookie != "" {
			t.Errorf("login from another origin = %d %v", r.code, r.body)
		}
	})

	t.Run("native client without Origin uses the sole RP", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		c.origin = ""
		c.header = "ios/2"
		options(t, c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}))
	})

	t.Run("web client without Origin is refused", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		c.origin = ""
		c.header = "web"
		wantCode(t, "options", c.do("POST", "/api/v1/auth/login/passkey/options", map[string]string{"token": token}),
			400, "passkey_origin")
	})

	t.Run("a copied passkey is refused", func(t *testing.T) {
		c, token := passwordStep(t, hs, a)
		clone := *key
		clone.count = 1 // behind the stored counter
		wantCode(t, "clone", passkeyStep(c, token, &clone), 401, "passkey_cloned")
		if c.cookie != "" {
			t.Error("a cloned passkey got a session")
		}
	})
}

func TestPasskeyManagement(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("lee@example.com")
	key := newAuthenticator(t)

	t.Run("adding needs the password, before any prompt", func(t *testing.T) {
		a.c.origin = testOrigin
		wantCode(t, "wrong password", a.c.do("POST", "/api/v1/account/passkeys/options",
			map[string]any{"currentAuthKey": rnd(32)}), 401, "bad_login")
		wantCode(t, "no password", a.c.do("POST", "/api/v1/account/passkeys/options", map[string]any{}), 400, "")
	})

	t.Run("adding is tied to the session that started it", func(t *testing.T) {
		a.c.origin = testOrigin
		r := a.c.do("POST", "/api/v1/account/passkeys/options", map[string]any{"currentAuthKey": a.authKey})
		opts := options(t, r)
		other := &client{hs: hs, origin: testOrigin}
		other.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
		wantCode(t, "finish on another device", other.do("POST", "/api/v1/account/passkeys", map[string]any{
			"token": r.body["token"], "credential": key.create(opts),
		}), 400, "bad_ceremony")
	})

	t.Run("only from a known origin", func(t *testing.T) {
		a.c.origin = "https://evil.example"
		wantCode(t, "options", a.c.do("POST", "/api/v1/account/passkeys/options",
			map[string]any{"currentAuthKey": a.authKey}), 400, "passkey_origin")
	})

	t.Run("a passkey from another site is refused", func(t *testing.T) {
		wrongRP := newAuthenticator(t)
		wrongRP.rpID = "evil.example"
		wantCode(t, "add", addPasskey(t, a, wrongRP, ""), 401, "bad_passkey")
	})

	if r := addPasskey(t, a, key, ""); r.code != 201 || r.body["label"] != "Passkey" {
		t.Fatalf("add = %d %v", r.code, r.body)
	}

	t.Run("the same passkey can't be added twice", func(t *testing.T) {
		// The options exclude it, so a browser wouldn't offer it; the
		// database refuses it anyway.
		wantCode(t, "again", addPasskey(t, a, key, ""), 409, "passkey_exists")
	})

	t.Run("removing needs the password, then sign-in is password only", func(t *testing.T) {
		path := "/api/v1/account/passkeys/" + b64url.EncodeToString(key.id)
		wantCode(t, "wrong password", a.c.do("DELETE", path, map[string]string{"currentAuthKey": rnd(32)}), 401, "bad_login")
		wantCode(t, "someone else's", a.c.do("DELETE", "/api/v1/account/passkeys/AAAA",
			map[string]string{"currentAuthKey": a.authKey}), 404, "not_found")
		wantCode(t, "remove", a.c.do("DELETE", path, map[string]string{"currentAuthKey": a.authKey}), 204, "")
		if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "passkey was removed") {
			t.Errorf("notice = %q", m.Subject)
		}
		c := &client{hs: hs, origin: testOrigin}
		r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
		if r.code != 200 || r.body["wrappedPassword"] == nil {
			t.Errorf("login = %d %v", r.code, r.body)
		}
	})

	t.Run("at most MaxPasskeys", func(t *testing.T) {
		for i := range 10 {
			if r := addPasskey(t, a, newAuthenticator(t), ""); r.code != 201 {
				t.Fatalf("add %d = %d %v", i, r.code, r.body)
			}
		}
		wantCode(t, "eleventh", addPasskey(t, a, newAuthenticator(t), ""), 409, "too_many_passkeys")
	})
}

func TestRecoveryNeedsNoPasskey(t *testing.T) {
	// The recovery phrase counts as both factors (decision 30).
	hs := newHarness(t)
	a := hs.signUp("sam@example.com")
	if r := addPasskey(t, a, newAuthenticator(t), ""); r.code != 201 {
		t.Fatalf("add = %d %v", r.code, r.body)
	}
	c := &client{hs: hs}
	r := c.do("POST", "/api/v1/auth/recover/complete", map[string]any{
		"email": a.email, "recoveryProof": a.proof, "salt": rnd(16), "kdf": kdf, "authKey": rnd(32),
		"wrappedPassword": wrapped(),
	})
	if r.code != 200 || c.cookie == "" {
		t.Errorf("recover = %d %v", r.code, r.body)
	}
}

func TestPasskeysRPNativePrefersProduction(t *testing.T) {
	p, err := NewPasskeys(store.Passkeys{}, []string{
		"https://preview.dayrule.app", "https://dayrule.app",
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/", nil)
	req.Header.Set("X-Dayrule-Client", "macos/9")
	wa, err := p.rp(req)
	if err != nil {
		t.Fatal(err)
	}
	if wa.Config.RPID != "dayrule.app" {
		t.Fatalf("RPID = %q, want dayrule.app", wa.Config.RPID)
	}
}
