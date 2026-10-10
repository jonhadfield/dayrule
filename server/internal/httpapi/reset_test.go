package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/auth"
)

// secondStepToken signs in with the password on a new device and returns
// the second step.
func secondStepToken(t *testing.T, hs *harness, a account) map[string]any {
	t.Helper()
	c := &client{hs: hs, origin: testOrigin}
	r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	step, ok := r.body["secondStep"].(map[string]any)
	if !ok {
		t.Fatalf("login = %d %v, want a second step", r.code, r.body)
	}
	return step
}

// requestReset asks for a reset by email and confirms it with the code.
func requestReset(t *testing.T, hs *harness, a account) time.Time {
	t.Helper()
	c := &client{hs: hs}
	step := secondStepToken(t, hs, a)
	wantCode(t, "reset/start", c.do("POST", "/api/v1/auth/login/reset/start", map[string]any{"token": step["token"]}), 202, "")
	r := c.do("POST", "/api/v1/auth/login/reset/confirm", map[string]string{"email": a.email, "code": hs.codeFor(a.email)})
	if r.code != 200 {
		t.Fatalf("reset/confirm = %d %v", r.code, r.body)
	}
	due, err := time.Parse(time.RFC3339, r.body["resetDueAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return due
}

func runGC(t *testing.T, hs *harness) map[string]any {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/internal/gc", nil)
	req.Header.Set("Authorization", "Bearer cron-test-secret")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("gc = %d %s", rec.Code, rec.Body.String())
	}
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

func lastSubject(hs *harness, addr string) string {
	m, _ := hs.mail.Last(addr)
	return m.Subject
}

func TestTwoStepResetByEmail(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("ada@example.com")
	setUpTOTP(t, hs, a)
	c := &client{hs: hs}

	if step := secondStepToken(t, hs, a); step["resetDueAt"] != nil {
		t.Errorf("resetDueAt before any request = %v", step["resetDueAt"])
	}
	wantCode(t, "no password step", c.do("POST", "/api/v1/auth/login/reset/start",
		map[string]string{"token": "made-up"}), 400, "bad_ceremony")

	step := secondStepToken(t, hs, a)
	wantCode(t, "start", c.do("POST", "/api/v1/auth/login/reset/start", map[string]any{"token": step["token"]}), 202, "")
	code := hs.codeFor(a.email)
	wantCode(t, "a wrong code", c.do("POST", "/api/v1/auth/login/reset/confirm",
		map[string]string{"email": a.email, "code": "000000"}), 400, "bad_code")
	wantCode(t, "another account's address", c.do("POST", "/api/v1/auth/login/reset/confirm",
		map[string]string{"email": "nobody@example.com", "code": code}), 400, "expired_code")
	r := c.do("POST", "/api/v1/auth/login/reset/confirm", map[string]string{"email": a.email, "code": code})
	if r.code != 200 {
		t.Fatalf("confirm = %d %v", r.code, r.body)
	}
	due, _ := time.Parse(time.RFC3339, r.body["resetDueAt"].(string))
	if !due.Equal(hs.now.Add(resetWait)) {
		t.Errorf("due = %v, want a week on", due)
	}
	if s := lastSubject(hs, a.email); !strings.Contains(s, "turned off in 7 days") {
		t.Errorf("notice = %q", s)
	}
	wantCode(t, "the code again", c.do("POST", "/api/v1/auth/login/reset/confirm",
		map[string]string{"email": a.email, "code": code}), 400, "expired_code")

	// While it waits: the second step is still needed, and says when.
	step = secondStepToken(t, hs, a)
	if step["resetDueAt"] == nil {
		t.Error("the second step doesn't mention the pending reset")
	}
	if r := c.do("POST", "/api/v1/auth/login/reset/start", map[string]any{"token": step["token"]}); r.code != 200 || r.body["resetDueAt"] == nil {
		t.Errorf("asking again = %d %v, want the pending date and no new code", r.code, r.body)
	}
	if s := a.c.do("GET", "/api/v1/account/two-step", nil); s.body["resetDueAt"] == nil {
		t.Errorf("account status = %v", s.body)
	}

	// A day before, one warning.
	hs.now = hs.now.Add(resetWait - 12*time.Hour)
	if got := runGC(t, hs)["resetWarnings"]; got != 1.0 {
		t.Errorf("warnings = %v", got)
	}
	if s := lastSubject(hs, a.email); !strings.Contains(s, "turned off tomorrow") {
		t.Errorf("warning = %q", s)
	}
	if got := runGC(t, hs)["resetWarnings"]; got != 0.0 {
		t.Errorf("warned twice: %v", got)
	}
	secondStepToken(t, hs, a) // not yet

	// Once due, the password alone signs in, and every second step is gone.
	hs.now = hs.now.Add(12*time.Hour + time.Second)
	d := &client{hs: hs}
	r = d.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	if r.code != 200 || r.body["wrappedPassword"] == nil || d.cookie == "" {
		t.Fatalf("login once due = %d %v", r.code, r.body)
	}
	if s := lastSubject(hs, a.email); !strings.Contains(s, "was turned off") {
		t.Errorf("notice = %q", s)
	}
	if s := d.do("GET", "/api/v1/account/two-step", nil); s.body["totp"] != nil || s.body["resetDueAt"] != nil {
		t.Errorf("status after = %v", s.body)
	}
}

func TestTwoStepResetIsCancelled(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("cy@example.com")
	secret := setUpTOTP(t, hs, a)

	t.Run("by signing in with the second step", func(t *testing.T) {
		requestReset(t, hs, a)
		hs.now = hs.now.Add(time.Minute)
		_, r := codeStep(t, hs, a, auth.TOTPCode(secret, auth.TOTPStep(hs.now)))
		wantCode(t, "code step", r, 200, "")
		if s := lastSubject(hs, a.email); !strings.Contains(s, "will stay on") {
			t.Errorf("notice = %q", s)
		}
		if s := a.c.do("GET", "/api/v1/account/two-step", nil); s.body["resetDueAt"] != nil {
			t.Errorf("still pending: %v", s.body)
		}
	})

	t.Run("from Account", func(t *testing.T) {
		requestReset(t, hs, a)
		wantCode(t, "cancel", a.c.do("DELETE", "/api/v1/account/two-step/reset", nil), 204, "")
		wantCode(t, "cancel again", a.c.do("DELETE", "/api/v1/account/two-step/reset", nil), 404, "not_found")
	})

	t.Run("by a new password", func(t *testing.T) {
		requestReset(t, hs, a)
		newKey := rnd(32)
		wantCode(t, "change", a.c.do("PUT", "/api/v1/account/password", map[string]any{
			"currentAuthKey": a.authKey, "salt": rnd(16), "kdf": kdf, "authKey": newKey, "wrappedPassword": wrapped(),
		}), 204, "")
		a.authKey = newKey
		hs.now = hs.now.Add(resetWait + time.Hour)
		secondStepToken(t, hs, a) // still needed after the week
	})
}

func TestTwoStepResetCodesAreRateLimited(t *testing.T) {
	// Its own account and clock: code rows are timed by the database.
	hs := newHarness(t)
	a := hs.signUp("dee@example.com")
	setUpTOTP(t, hs, a)
	c := &client{hs: hs}
	for i := range 4 {
		r := c.do("POST", "/api/v1/auth/login/reset/start", map[string]any{"token": secondStepToken(t, hs, a)["token"]})
		want, code := 202, ""
		if i == 3 {
			want, code = 429, "too_many_codes"
		}
		wantCode(t, "start", r, want, code)
	}
}
