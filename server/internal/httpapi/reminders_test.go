package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

func (hs *harness) runReminderCron() map[string]any {
	hs.t.Helper()
	req := httptest.NewRequest("GET", "/api/internal/reminders", nil)
	req.Header.Set("Authorization", "Bearer cron-test-secret")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		hs.t.Fatalf("cron = %d %s", rec.Code, rec.Body.String())
	}
	return decodeBody(hs.t, rec.Body.String())
}

func TestReminderSettingsAndSending(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("remind@example.com")

	s := a.c.do("GET", "/api/v1/reminders/settings", nil)
	if s.body["channel"] != "off" || s.body["vapidPublicKey"] != "test-vapid-public" {
		t.Fatalf("settings = %v", s.body)
	}
	if r := a.c.do("PUT", "/api/v1/reminders/settings", map[string]string{"channel": "sometimes"}); r.code != 400 {
		t.Fatalf("bad channel = %d", r.code)
	}
	if r := a.c.do("PUT", "/api/v1/reminders/settings", map[string]string{"channel": "both"}); r.code != 204 {
		t.Fatalf("set channel = %d", r.code)
	}
	sub := map[string]any{"endpoint": "https://push.example.com/abc", "keys": map[string]string{"p256dh": "pk", "auth": "au"}}
	if r := a.c.do("POST", "/api/v1/push/subscriptions", sub); r.code != 204 {
		t.Fatalf("subscribe = %d %v", r.code, r.body)
	}
	if r := a.c.do("POST", "/api/v1/push/subscriptions", map[string]any{"endpoint": "http://insecure.example.com", "keys": map[string]string{"p256dh": "x", "auth": "y"}}); r.code != 400 {
		t.Fatalf("http endpoint should be refused, got %d", r.code)
	}

	soon, later := uuid.NewString(), uuid.NewString()
	put := func(rs ...map[string]any) {
		t.Helper()
		if r := a.c.do("PUT", "/api/v1/reminders", map[string]any{"reminders": rs}); r.code != 204 {
			t.Fatalf("put reminders = %d %v", r.code, r.body)
		}
	}
	put(
		map[string]any{"id": soon, "fireAt": hs.now.Add(5 * time.Minute), "localTime": "13:05"},
		map[string]any{"id": later, "fireAt": hs.now.Add(3 * time.Hour), "localTime": "16:00"},
	)

	// Not due yet.
	if got := hs.runReminderCron(); got["due"].(float64) != 0 {
		t.Fatalf("early cron = %v", got)
	}
	hs.now = hs.now.Add(6 * time.Minute)
	got := hs.runReminderCron()
	if got["due"].(float64) != 1 || got["pushed"].(float64) != 1 || got["emailed"].(float64) != 1 {
		t.Fatalf("cron = %v", got)
	}
	if len(hs.push.Sent) != 1 || !strings.Contains(hs.push.Sent[0].Payload, soon) || !strings.Contains(hs.push.Sent[0].Payload, "13:05") {
		t.Fatalf("push = %+v", hs.push.Sent)
	}
	m, ok := hs.mail.Last(a.email)
	if !ok || !strings.Contains(m.Text, "13:05") || strings.Contains(m.Text, soon) {
		t.Fatalf("email = %+v", m)
	}
	// Sent once only.
	if got := hs.runReminderCron(); got["due"].(float64) != 0 {
		t.Fatalf("second run = %v", got)
	}

	// Replacing: an unchanged sent reminder stays sent; a removed one goes.
	put(map[string]any{"id": soon, "fireAt": hs.now.Add(-1 * time.Minute), "localTime": "13:05"})
	hs.now = hs.now.Add(4 * time.Hour)
	if got := hs.runReminderCron(); got["due"].(float64) != 0 {
		t.Fatalf("removed reminder was sent: %v", got)
	}
}

func TestRemindersSkipStaleOffAndGoneDevices(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("stale@example.com")
	a.c.do("PUT", "/api/v1/reminders/settings", map[string]string{"channel": "push"})
	a.c.do("POST", "/api/v1/push/subscriptions", map[string]any{"endpoint": "https://push.example.com/gone", "keys": map[string]string{"p256dh": "pk", "auth": "au"}})
	hs.push.Gone["https://push.example.com/gone"] = true

	a.c.do("PUT", "/api/v1/reminders", map[string]any{"reminders": []map[string]any{
		{"id": uuid.NewString(), "fireAt": hs.now.Add(-2 * time.Hour), "localTime": "10:00"}, // too late
		{"id": uuid.NewString(), "fireAt": hs.now.Add(-time.Minute), "localTime": "11:59"},
	}})
	got := hs.runReminderCron()
	if got["due"].(float64) != 1 || got["pushed"].(float64) != 0 {
		t.Fatalf("cron = %v", got)
	}
	subs, _ := store.Reminders{Accounts: hs.store}.Subscriptions(t.Context(), uuid.MustParse(a.userID))
	if len(subs) != 0 {
		t.Fatalf("gone subscription kept: %v", subs)
	}

	// Channel off: nothing is sent.
	a.c.do("PUT", "/api/v1/reminders/settings", map[string]string{"channel": "off"})
	a.c.do("PUT", "/api/v1/reminders", map[string]any{"reminders": []map[string]any{
		{"id": uuid.NewString(), "fireAt": hs.now.Add(-time.Minute), "localTime": "11:59"},
	}})
	if got := hs.runReminderCron(); got["due"].(float64) != 0 {
		t.Fatalf("sent with channel off: %v", got)
	}

	if r := (&client{hs: hs}).do("PUT", "/api/v1/reminders", map[string]any{"reminders": []any{}}); r.code != 401 {
		t.Fatalf("no session = %d", r.code)
	}
	req := httptest.NewRequest("GET", "/api/internal/reminders", nil)
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("cron without secret = %d", rec.Code)
	}
}

func decodeBody(t *testing.T, body string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatal(err)
	}
	return m
}
