package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/email"
	"github.com/jonhadfield/dayrule/server/internal/push"
	"github.com/jonhadfield/dayrule/server/internal/safehttp"
	"github.com/jonhadfield/dayrule/server/internal/store"
	"github.com/jonhadfield/dayrule/server/internal/testdb"
)

// ---------------------------------------------------------------------------
// Harness

type harness struct {
	t       *testing.T
	h       http.Handler
	mail    *email.Memory
	keys    auth.Keys
	store   store.Accounts
	records store.Records
	push    *push.Memory
	now     time.Time
	invite  string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	// Hermetic DNS for calendar/push SSRF checks (no real lookups in tests).
	oldLookup := safehttp.Lookup
	safehttp.Lookup = func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host == "private.test" {
			return []net.IPAddr{{IP: net.ParseIP("10.0.0.1")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	}
	t.Cleanup(func() { safehttp.Lookup = oldLookup })

	pool := testdb.New(t)
	keys, err := auth.NewKeys(bytes.Repeat([]byte("k"), 32))
	if err != nil {
		t.Fatal(err)
	}
	hs := &harness{t: t, mail: &email.Memory{}, keys: keys, store: store.Accounts{Pool: pool},
		now: time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)}
	passkeys, err := NewPasskeys(store.Passkeys{Accounts: hs.store}, []string{testOrigin})
	if err != nil {
		t.Fatal(err)
	}
	acc := &Accounts{Store: hs.store, Keys: keys, Email: hs.mail, InviteOnly: true,
		Now: func() time.Time { return hs.now }, Passkeys: passkeys}
	hs.records = store.Records{Accounts: hs.store}
	errStore := store.ErrorReports{Pool: pool}
	sync := &Sync{Accounts: acc, Store: hs.records, Errors: errStore, CronSecret: "cron-test-secret"}
	hs.push = &push.Memory{Gone: map[string]bool{}}
	reminders := &Reminders{Accounts: acc, Store: store.Reminders{Accounts: hs.store}, Push: hs.push,
		VAPIDPublicKey: "test-vapid-public", CronSecret: "cron-test-secret"}
	errs := &Errors{Accounts: acc, Store: errStore}
	hs.h = NewHandler(Config{Version: "test", Accounts: acc, Sync: sync, Reminders: reminders,
		Errors: errs, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	hs.invite = hs.newInvite()
	return hs
}

func (hs *harness) newInvite() string {
	code, _ := auth.NewInviteCode()
	if err := hs.store.CreateInvites(context.Background(), [][]byte{auth.InviteHash(code)}); err != nil {
		hs.t.Fatal(err)
	}
	return code
}

type client struct {
	hs     *harness
	cookie string
	bearer string
	header string // X-Dayrule-Client; default "web"
	origin string // sent as the Origin header, as a browser does
}

type resp struct {
	code int
	body map[string]any
	raw  *httptest.ResponseRecorder
}

func (c *client) do(method, path string, body any) resp {
	c.hs.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	clientHdr := c.header
	if clientHdr == "" {
		clientHdr = "web"
	}
	req.Header.Set("X-Dayrule-Client", clientHdr)
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", sessionCookie+"="+c.cookie)
	}
	if c.origin != "" {
		req.Header.Set("Origin", c.origin)
	}
	rec := httptest.NewRecorder()
	c.hs.h.ServeHTTP(rec, req)
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == sessionCookie {
			c.cookie = ck.Value
		}
	}
	out := resp{code: rec.Code, raw: rec}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.body)
	return out
}

func rnd(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

func wrapped() store.Wrapped { return store.Wrapped{Nonce: rnd(24), Ciphertext: rnd(48)} }

var kdf = store.KdfParams{V: 1, Ops: 3, Mem: 64 << 20}

var codeRe = regexp.MustCompile(`\b(\d{6})\b`)

func (hs *harness) codeFor(addr string) string {
	hs.t.Helper()
	m, ok := hs.mail.Last(strings.ToLower(addr))
	if !ok {
		hs.t.Fatalf("no email to %s", addr)
	}
	match := codeRe.FindStringSubmatch(m.Text)
	if match == nil {
		hs.t.Fatalf("no code in email %q", m.Subject)
	}
	return match[1]
}

type account struct {
	email, authKey, proof string
	userID                string
	c                     *client
}

// signUp runs the whole sign-up flow and returns a signed-in client.
func (hs *harness) signUp(addr string) account {
	hs.t.Helper()
	c := &client{hs: hs}
	if r := c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": addr, "inviteCode": hs.invite}); r.code != 202 {
		hs.t.Fatalf("signup/start = %d %v", r.code, r.body)
	}
	r := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": addr, "code": hs.codeFor(addr)})
	if r.code != 200 {
		hs.t.Fatalf("signup/verify = %d %v", r.code, r.body)
	}
	a := account{email: addr, authKey: rnd(32), proof: rnd(32), userID: uuid.NewString(), c: c}
	r = c.do("POST", "/api/v1/auth/register", map[string]any{
		"email": addr, "signupToken": r.body["signupToken"], "inviteCode": hs.invite, "userId": a.userID,
		"salt": rnd(16), "kdf": kdf, "authKey": a.authKey, "wrappedPassword": wrapped(),
		"wrappedRecovery": wrapped(), "recoveryProof": a.proof, "deviceLabel": "Test",
	})
	if r.code != 201 {
		hs.t.Fatalf("register = %d %v", r.code, r.body)
	}
	hs.invite = hs.newInvite()
	return a
}

// ---------------------------------------------------------------------------
// Tests

func TestSignUpSignInAndSessions(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("Ada@Example.com")

	if r := a.c.do("GET", "/api/v1/account", nil); r.code != 200 || r.body["email"] != "ada@example.com" {
		t.Fatalf("account = %d %v", r.code, r.body)
	}

	// Sign in on a second device.
	b := &client{hs: hs}
	pre := b.do("POST", "/api/v1/auth/prelogin", map[string]string{"email": "ada@example.com"})
	if pre.code != 200 || pre.body["salt"] == "" {
		t.Fatalf("prelogin = %v", pre.body)
	}
	if r := b.do("POST", "/api/v1/auth/login", map[string]string{"email": "ada@example.com", "authKey": a.authKey, "deviceLabel": "Phone"}); r.code != 200 || r.body["wrappedPassword"] == nil {
		t.Fatalf("login = %d %v", r.code, r.body)
	}

	r := b.do("GET", "/api/v1/account/sessions", nil)
	list, _ := r.body["sessions"].([]any)
	if len(list) != 2 {
		t.Fatalf("sessions = %v", r.body)
	}

	// Revoke the first device from the second.
	var firstID string
	for _, s := range list {
		m := s.(map[string]any)
		if m["current"] == false {
			firstID = m["id"].(string)
		}
	}
	if r := b.do("DELETE", "/api/v1/account/sessions/"+firstID, nil); r.code != 204 {
		t.Fatalf("revoke = %d", r.code)
	}
	if r := a.c.do("GET", "/api/v1/account", nil); r.code != 401 {
		t.Fatalf("revoked session still works: %d", r.code)
	}

	// Log out.
	b.do("POST", "/api/v1/auth/logout", nil)
	if r := b.do("GET", "/api/v1/account", nil); r.code != 401 {
		t.Fatalf("logged-out session still works: %d", r.code)
	}
}

func TestSignUpDoesNotRevealExistingAccounts(t *testing.T) {
	hs := newHarness(t)
	hs.signUp("bo@example.com")
	c := &client{hs: hs}
	r := c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": "bo@example.com", "inviteCode": hs.invite})
	if r.code != 202 {
		t.Fatalf("existing email got %d, want the same 202", r.code)
	}
	m, _ := hs.mail.Last("bo@example.com")
	if !strings.Contains(m.Subject, "already have") || codeRe.MatchString(m.Text) {
		t.Fatalf("existing email should get a notice without a code, got %q", m.Subject)
	}

	// Wrong verify after start must match for taken and free emails (bad_code).
	freshInvite := hs.newInvite()
	if r := c.do("POST", "/api/v1/auth/signup/start", map[string]string{
		"email": "fresh@example.com", "inviteCode": freshInvite,
	}); r.code != 202 {
		t.Fatalf("fresh signup/start = %d %v", r.code, r.body)
	}
	bad := "000000"
	if bad == hs.codeFor("fresh@example.com") {
		bad = "111111"
	}
	taken := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": "bo@example.com", "code": bad})
	free := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": "fresh@example.com", "code": bad})
	if taken.code != free.code || taken.body["code"] != free.body["code"] || taken.body["code"] != "bad_code" {
		t.Fatalf("verify reveals accounts: taken=%v free=%v", taken.body, free.body)
	}

	// Prelogin for an unknown email looks normal and is stable.
	p1 := c.do("POST", "/api/v1/auth/prelogin", map[string]string{"email": "nobody@example.com"})
	p2 := c.do("POST", "/api/v1/auth/prelogin", map[string]string{"email": "nobody@example.com"})
	if p1.code != 200 || p1.body["salt"] != p2.body["salt"] {
		t.Fatalf("fake salt unstable: %v %v", p1.body, p2.body)
	}
	// Unknown email and wrong password fail identically.
	r1 := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "nobody@example.com", "authKey": rnd(32)})
	r2 := c.do("POST", "/api/v1/auth/login", map[string]string{"email": "bo@example.com", "authKey": rnd(32)})
	if r1.code != 401 || r2.code != 401 || r1.body["code"] != r2.body["code"] {
		t.Fatalf("login failures differ: %v / %v", r1.body, r2.body)
	}
}

func TestInviteRequiredAndSingleUse(t *testing.T) {
	hs := newHarness(t)
	c := &client{hs: hs}
	if r := c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": "x@example.com", "inviteCode": "NOPE-NOPE-NOPE"}); r.code != 400 || r.body["code"] != "bad_invite" {
		t.Fatalf("bad invite = %d %v", r.code, r.body)
	}
	used := hs.invite
	hs.signUp("first@example.com")
	if r := c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": "second@example.com", "inviteCode": used}); r.code != 400 {
		t.Fatalf("reused invite accepted: %d", r.code)
	}
}

func TestCodeAttemptsAreLimited(t *testing.T) {
	hs := newHarness(t)
	c := &client{hs: hs}
	c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": "z@example.com", "inviteCode": hs.invite})
	good := hs.codeFor("z@example.com")
	bad := "000000"
	if bad == good {
		bad = "111111"
	}
	for range store.MaxCodeAttempts {
		if r := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": "z@example.com", "code": bad}); r.code != 400 || r.body["code"] != "bad_code" {
			t.Fatalf("wrong code = %v", r.body)
		}
	}
	if r := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": "z@example.com", "code": good}); r.body["code"] != "expired_code" {
		t.Fatalf("code still usable after %d wrong guesses: %v", store.MaxCodeAttempts, r.body)
	}

	// Codes expire after 10 minutes.
	c.do("POST", "/api/v1/auth/signup/start", map[string]string{"email": "y@example.com", "inviteCode": hs.invite})
	code := hs.codeFor("y@example.com")
	hs.now = hs.now.Add(11 * time.Minute)
	if r := c.do("POST", "/api/v1/auth/signup/verify", map[string]string{"email": "y@example.com", "code": code}); r.body["code"] != "expired_code" {
		t.Fatalf("expired code accepted: %v", r.body)
	}
}

func TestLockoutAfterFailedLogins(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("lock@example.com")
	c := &client{hs: hs}
	for range 5 {
		c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": rnd(32)})
	}
	if r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey}); r.code != 429 {
		t.Fatalf("not locked after 5 failures: %d", r.code)
	}
	hs.now = hs.now.Add(2 * time.Minute)
	if r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey}); r.code != 200 {
		t.Fatalf("still locked after backoff: %d %v", r.code, r.body)
	}
}

func TestRecoveryAndPasswordChange(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("rec@example.com")
	other := &client{hs: hs}
	other.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})

	// Wrong proof fails; right proof returns the recovery wrap.
	c := &client{hs: hs}
	if r := c.do("POST", "/api/v1/auth/recover/start", map[string]string{"email": a.email, "recoveryProof": rnd(32)}); r.code != 401 {
		t.Fatalf("wrong proof = %d", r.code)
	}
	if r := c.do("POST", "/api/v1/auth/recover/start", map[string]string{"email": a.email, "recoveryProof": a.proof}); r.code != 200 || r.body["wrappedRecovery"] == nil {
		t.Fatalf("recover/start = %d %v", r.code, r.body)
	}
	newKey := rnd(32)
	r := c.do("POST", "/api/v1/auth/recover/complete", map[string]any{
		"email": a.email, "recoveryProof": a.proof, "salt": rnd(16), "kdf": kdf,
		"authKey": newKey, "wrappedPassword": wrapped(),
	})
	if r.code != 200 {
		t.Fatalf("recover/complete = %d %v", r.code, r.body)
	}
	if r := other.do("GET", "/api/v1/account", nil); r.code != 401 {
		t.Fatalf("recovery didn't sign out other devices: %d", r.code)
	}
	if m, _ := hs.mail.Last(a.email); !strings.Contains(m.Subject, "password was changed") {
		t.Fatalf("no notice, got %q", m.Subject)
	}

	// Change the password while signed in; this device stays signed in.
	third := &client{hs: hs}
	third.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": newKey})
	newer := rnd(32)
	r = c.do("PUT", "/api/v1/account/password", map[string]any{
		"currentAuthKey": newKey, "salt": rnd(16), "kdf": kdf, "authKey": newer, "wrappedPassword": wrapped(),
	})
	if r.code != 204 {
		t.Fatalf("password change = %d %v", r.code, r.body)
	}
	if r := c.do("GET", "/api/v1/account", nil); r.code != 200 {
		t.Fatalf("current session dropped: %d", r.code)
	}
	if r := third.do("GET", "/api/v1/account", nil); r.code != 401 {
		t.Fatalf("other session kept: %d", r.code)
	}
	if r := (&client{hs: hs}).do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": newer}); r.code != 200 {
		t.Fatalf("new password rejected: %d", r.code)
	}
}

func TestEmailChangeAndAccountDeletion(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("old@example.com")
	if r := a.c.do("POST", "/api/v1/account/email/start", map[string]string{"newEmail": "new@example.com", "currentAuthKey": rnd(32)}); r.code != 401 {
		t.Fatalf("email change without the password = %d", r.code)
	}
	if r := a.c.do("POST", "/api/v1/account/email/start", map[string]string{"newEmail": "new@example.com", "currentAuthKey": a.authKey}); r.code != 202 {
		t.Fatalf("email/start = %d", r.code)
	}
	r := a.c.do("POST", "/api/v1/account/email/verify", map[string]string{"newEmail": "new@example.com", "code": hs.codeFor("new@example.com")})
	if r.code != 200 {
		t.Fatalf("email/verify = %d %v", r.code, r.body)
	}
	if m, _ := hs.mail.Last("old@example.com"); !strings.Contains(m.Subject, "email was changed") {
		t.Fatalf("old address not told, got %q", m.Subject)
	}
	if r := a.c.do("GET", "/api/v1/account", nil); r.body["email"] != "new@example.com" {
		t.Fatalf("email not changed: %v", r.body)
	}

	if r := a.c.do("DELETE", "/api/v1/account", map[string]string{"authKey": a.authKey}); r.code != 204 {
		t.Fatalf("delete = %d", r.code)
	}
	if _, err := hs.store.UserByEmail(context.Background(), "new@example.com"); err != store.ErrNotFound {
		t.Fatalf("user still exists: %v", err)
	}
}

func TestStateChangingRequestsNeedClientHeader(t *testing.T) {
	hs := newHarness(t)
	req := httptest.NewRequest("POST", "/api/v1/auth/prelogin", strings.NewReader(`{"email":"a@example.com"}`))
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing header = %d, want 403", rec.Code)
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("cookie@example.com")
	rec := a.c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey}).raw
	set := rec.Header().Get("Set-Cookie")
	for _, want := range []string{"__Host-session=", "Path=/", "HttpOnly", "Secure", "SameSite=Strict"} {
		if !strings.Contains(set, want) {
			t.Errorf("Set-Cookie %q lacks %q", set, want)
		}
	}
	if strings.Contains(set, "Domain=") {
		t.Errorf("Set-Cookie must be host-only: %q", set)
	}
}

func TestNativeBearerSession(t *testing.T) {
	for _, app := range []string{"ios", "macos"} {
		t.Run(app, func(t *testing.T) {
			hs := newHarness(t)
			addr := app + "@example.com"
			a := hs.signUp(addr)
			a.c.cookie = "" // drop the cookie from sign-up

			native := &client{hs: hs, header: app + "/1"}
			r := native.do("POST", "/api/v1/auth/login", map[string]string{
				"email": a.email, "authKey": a.authKey, "deviceLabel": "Native",
			})
			if r.code != 200 {
				t.Fatalf("login = %d %v", r.code, r.body)
			}
			token, _ := r.body["token"].(string)
			if token == "" {
				t.Fatalf("native login missing token: %v", r.body)
			}
			native.bearer = token
			native.cookie = "" // use Bearer only
			if r := native.do("GET", "/api/v1/account", nil); r.code != 200 || r.body["email"] != addr {
				t.Fatalf("bearer account = %d %v", r.code, r.body)
			}
			if r := native.do("POST", "/api/v1/auth/logout", nil); r.code != 204 {
				t.Fatalf("logout = %d", r.code)
			}
			if r := native.do("GET", "/api/v1/account", nil); r.code != 401 {
				t.Fatalf("after logout = %d, want 401", r.code)
			}
		})
	}
}

func TestRecognisedClient(t *testing.T) {
	for h, want := range map[string]bool{
		"web": true, "ios/1": true, "macos/1": true, "macos/2026.10.1": true,
		"": false, "ios/": false, "macos/": false, "macos/1 2": false, "macos": false,
		"android/1": false, "Web": false, "webx": false, "xmacos/1": false,
	} {
		if got := recognisedClient(h); got != want {
			t.Errorf("recognisedClient(%q) = %v, want %v", h, got, want)
		}
	}
}

func TestBrowserMarkersNeverGetBodyToken(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("browser@example.com")
	c := &client{hs: hs, header: "ios/1", origin: "https://evil.example"}
	r := c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	if r.code != 200 {
		t.Fatalf("login = %d", r.code)
	}
	if _, ok := r.body["token"]; ok {
		t.Fatalf("Origin request must not receive a body token: %v", r.body)
	}
}

func TestUnrecognisedClientHeaderRejected(t *testing.T) {
	hs := newHarness(t)
	req := httptest.NewRequest("POST", "/api/v1/auth/prelogin", strings.NewReader(`{"email":"a@example.com"}`))
	req.Header.Set("X-Dayrule-Client", "android/1")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unrecognised client = %d, want 403", rec.Code)
	}
}
