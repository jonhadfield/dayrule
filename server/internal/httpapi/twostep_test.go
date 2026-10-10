package httpapi

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/auth"
)

// setUpTOTP turns TOTP on for a and returns the secret.
func setUpTOTP(t *testing.T, hs *harness, a account) []byte {
	t.Helper()
	r := a.c.do("POST", "/api/v1/account/totp/start", map[string]string{"currentAuthKey": a.authKey})
	if r.code != 200 {
		t.Fatalf("totp/start = %d %v", r.code, r.body)
	}
	secret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(r.body["secret"].(string))
	if err != nil || len(secret) != 20 {
		t.Fatalf("secret %v (%v)", r.body["secret"], err)
	}
	code := auth.TOTPCode(secret, auth.TOTPStep(hs.now))
	wantCode(t, "confirm", a.c.do("POST", "/api/v1/account/totp", map[string]string{"code": code}), 204, "")
	return secret
}

// codeStep signs in with the password on a new device and answers the
// second step with a code.
func codeStep(t *testing.T, hs *harness, a account, code string) (*client, resp) {
	t.Helper()
	c := &client{hs: hs, origin: testOrigin}
	r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	step, ok := r.body["secondStep"].(map[string]any)
	if !ok {
		t.Fatalf("login = %d %v, want a second step", r.code, r.body)
	}
	return c, c.do("POST", "/api/v1/auth/login/code", map[string]string{"token": step["token"].(string), "code": code})
}

func methods(t *testing.T, hs *harness, a account) string {
	t.Helper()
	c := &client{hs: hs, origin: testOrigin}
	r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	step, ok := r.body["secondStep"].(map[string]any)
	if !ok {
		return ""
	}
	var out []string
	for _, m := range step["methods"].([]any) {
		out = append(out, m.(string))
	}
	return strings.Join(out, ",")
}

func TestTOTPSignIn(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("tia@example.com")

	if s := a.c.do("GET", "/api/v1/account/two-step", nil); s.body["totp"] != nil || s.body["backupCodes"] != 0.0 {
		t.Fatalf("status = %v", s.body)
	}
	wantCode(t, "start, wrong password", a.c.do("POST", "/api/v1/account/totp/start",
		map[string]string{"currentAuthKey": rnd(32)}), 401, "bad_login")

	r := a.c.do("POST", "/api/v1/account/totp/start", map[string]string{"currentAuthKey": a.authKey})
	if uri, _ := r.body["uri"].(string); !strings.HasPrefix(uri, "otpauth://totp/Dayrule:tia@example.com?") {
		t.Errorf("uri = %v", r.body["uri"])
	}
	if methods(t, hs, a) != "" {
		t.Error("an unfinished set-up already needs a second step")
	}
	wantCode(t, "a wrong code", a.c.do("POST", "/api/v1/account/totp", map[string]string{"code": "000000"}), 400, "bad_code")
	secret := setUpTOTP(t, hs, a)
	if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "authenticator app was added") {
		t.Errorf("notice = %q", m.Subject)
	}
	wantCode(t, "start again", a.c.do("POST", "/api/v1/account/totp/start",
		map[string]string{"currentAuthKey": a.authKey}), 409, "totp_exists")
	if got := methods(t, hs, a); got != "totp" {
		t.Errorf("methods = %q", got)
	}

	now := auth.TOTPStep(hs.now)
	t.Run("the code that turned it on doesn't sign in", func(t *testing.T) {
		_, r := codeStep(t, hs, a, auth.TOTPCode(secret, now))
		wantCode(t, "replay", r, 400, "bad_code")
	})

	c, r := codeStep(t, hs, a, " "+auth.TOTPCode(secret, now+1)[:3]+" "+auth.TOTPCode(secret, now+1)[3:])
	if r.code != 200 || r.body["wrappedPassword"] == nil || c.cookie == "" {
		t.Fatalf("code step = %d %v", r.code, r.body)
	}
	if s := a.c.do("GET", "/api/v1/account/two-step", nil).body["totp"].(map[string]any); s["lastUsedAt"] == nil {
		t.Errorf("lastUsedAt not recorded: %v", s)
	}

	t.Run("each step is used once, and wrong codes run out", func(t *testing.T) {
		hs.now = hs.now.Add(2 * time.Minute)
		c := &client{hs: hs, origin: testOrigin}
		step := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey}).
			body["secondStep"].(map[string]any)
		try := func(code string) resp {
			return c.do("POST", "/api/v1/auth/login/code", map[string]string{"token": step["token"].(string), "code": code})
		}
		for i := range maxCodeAttempts - 1 {
			wantCode(t, "wrong", try("12345"+string(rune('0'+i))), 400, "bad_code")
		}
		r := try(auth.TOTPCode(secret, auth.TOTPStep(hs.now)))
		if r.code != 200 {
			t.Fatalf("right code on the last try = %d %v", r.code, r.body)
		}
		wantCode(t, "after it worked", try(auth.TOTPCode(secret, auth.TOTPStep(hs.now)+1)), 400, "bad_ceremony")
	})

	t.Run("wrong codes lock out codes across sign-ins", func(t *testing.T) {
		hs.now = hs.now.Add(2 * time.Minute)
		for range 5 {
			_, r := codeStep(t, hs, a, "999999")
			wantCode(t, "wrong", r, 400, "bad_code")
		}
		_, r := codeStep(t, hs, a, auth.TOTPCode(secret, auth.TOTPStep(hs.now)))
		wantCode(t, "while locked", r, 429, "locked")
		hs.now = hs.now.Add(2 * time.Minute)
		_, r = codeStep(t, hs, a, auth.TOTPCode(secret, auth.TOTPStep(hs.now)))
		wantCode(t, "after the lock", r, 200, "")
	})

	t.Run("backup codes", func(t *testing.T) {
		wantCode(t, "wrong password", a.c.do("POST", "/api/v1/account/backup-codes",
			map[string]string{"currentAuthKey": rnd(32)}), 401, "bad_login")
		r := a.c.do("POST", "/api/v1/account/backup-codes", map[string]string{"currentAuthKey": a.authKey})
		codes, _ := r.body["codes"].([]any)
		if r.code != 201 || len(codes) != auth.BackupCodeCount {
			t.Fatalf("make = %d %v", r.code, r.body)
		}
		if got := methods(t, hs, a); got != "totp,backup" {
			t.Errorf("methods = %q", got)
		}
		code := codes[3].(string)
		_, r = codeStep(t, hs, a, strings.ToUpper(code))
		wantCode(t, "a backup code", r, 200, "")
		if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "backup code was used") || !strings.Contains(m.Text, "9 left") {
			t.Errorf("notice = %q %q", m.Subject, m.Text)
		}
		_, r = codeStep(t, hs, a, code)
		wantCode(t, "the same code again", r, 400, "bad_code")

		// New codes replace the old.
		a.c.do("POST", "/api/v1/account/backup-codes", map[string]string{"currentAuthKey": a.authKey})
		_, r = codeStep(t, hs, a, codes[4].(string))
		wantCode(t, "an old code", r, 400, "bad_code")
	})

	t.Run("removing needs the password, and takes the backup codes", func(t *testing.T) {
		wantCode(t, "wrong password", a.c.do("DELETE", "/api/v1/account/totp",
			map[string]string{"currentAuthKey": rnd(32)}), 401, "bad_login")
		wantCode(t, "remove", a.c.do("DELETE", "/api/v1/account/totp",
			map[string]string{"currentAuthKey": a.authKey}), 204, "")
		if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "authenticator app was removed") {
			t.Errorf("notice = %q", m.Subject)
		}
		if s := a.c.do("GET", "/api/v1/account/two-step", nil); s.body["totp"] != nil || s.body["backupCodes"] != 0.0 {
			t.Errorf("status = %v", s.body)
		}
		if got := methods(t, hs, a); got != "" {
			t.Errorf("methods after removing = %q", got)
		}
		wantCode(t, "remove again", a.c.do("DELETE", "/api/v1/account/totp",
			map[string]string{"currentAuthKey": a.authKey}), 404, "not_found")
	})
}

func TestTOTPSetUp(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("ros@example.com")
	start := func() []byte {
		r := a.c.do("POST", "/api/v1/account/totp/start", map[string]string{"currentAuthKey": a.authKey})
		s, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(r.body["secret"].(string))
		return s
	}
	confirm := func(code string) resp {
		return a.c.do("POST", "/api/v1/account/totp", map[string]string{"code": code})
	}

	wantCode(t, "nothing started", confirm("123456"), 400, "bad_ceremony")

	t.Run("expires", func(t *testing.T) {
		secret := start()
		hs.now = hs.now.Add(codeLifetime + time.Second)
		wantCode(t, "late", confirm(auth.TOTPCode(secret, auth.TOTPStep(hs.now))), 400, "bad_ceremony")
	})

	t.Run("wrong codes run out", func(t *testing.T) {
		secret := start()
		for range totpSetupAttempts {
			wantCode(t, "wrong", confirm("000000"), 400, "bad_code")
		}
		wantCode(t, "right, too late", confirm(auth.TOTPCode(secret, auth.TOTPStep(hs.now))), 400, "bad_ceremony")
	})

	t.Run("starting again gives a new secret", func(t *testing.T) {
		old, secret := start(), start()
		wantCode(t, "the old secret", confirm(auth.TOTPCode(old, auth.TOTPStep(hs.now))), 400, "bad_code")
		wantCode(t, "the new one", confirm(auth.TOTPCode(secret, auth.TOTPStep(hs.now))), 204, "")
	})
}

func TestBackupCodesNeedASecondStep(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("max@example.com")
	wantCode(t, "no second step", a.c.do("POST", "/api/v1/account/backup-codes",
		map[string]string{"currentAuthKey": a.authKey}), 409, "no_second_step")

	// With a passkey and TOTP, removing one keeps the codes.
	key := newAuthenticator(t)
	if r := addPasskey(t, a, key, ""); r.code != 201 {
		t.Fatalf("add passkey = %d %v", r.code, r.body)
	}
	setUpTOTP(t, hs, a)
	r := a.c.do("POST", "/api/v1/account/backup-codes", map[string]string{"currentAuthKey": a.authKey})
	if r.code != 201 {
		t.Fatalf("make = %d %v", r.code, r.body)
	}
	if got := methods(t, hs, a); got != "passkey,totp,backup" {
		t.Errorf("methods = %q", got)
	}
	wantCode(t, "remove passkey", a.c.do("DELETE", "/api/v1/account/passkeys/"+b64url.EncodeToString(key.id),
		map[string]string{"currentAuthKey": a.authKey}), 204, "")
	if s := a.c.do("GET", "/api/v1/account/two-step", nil); s.body["backupCodes"] != 10.0 {
		t.Errorf("codes after removing the passkey = %v", s.body)
	}
	codes := r.body["codes"].([]any)
	_, step := codeStep(t, hs, a, codes[0].(string))
	wantCode(t, "a backup code", step, 200, "")
}
