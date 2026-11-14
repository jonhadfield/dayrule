package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestErrorReport(t *testing.T) {
	hs := newHarness(t)
	c := &client{hs: hs}

	wantCode(t, "needs message", c.do("POST", "/api/v1/errors", map[string]string{
		"release": "abc", "stack": "at foo",
	}), 400, "bad_request")

	r := c.do("POST", "/api/v1/errors", map[string]string{
		"release": "build-test",
		"message": "boom",
		"stack":   "Error: boom\n    at main",
	})
	wantCode(t, "accepted", r, 204, "")

	long := strings.Repeat("x", maxErrorMessage+50)
	wantCode(t, "long message clipped", c.do("POST", "/api/v1/errors", map[string]string{
		"message": long,
	}), 204, "")

	_, err := hs.store.Pool.Exec(context.Background(),
		`UPDATE error_reports SET created_at = $1`, hs.now.Add(-40*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/internal/gc", nil)
	req.Header.Set("Authorization", "Bearer cron-test-secret")
	req.Header.Set("X-Dayrule-Client", "web")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("gc: %d %s", rec.Code, rec.Body.String())
	}
	var out map[string]int64
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["purgedReports"] < 1 {
		t.Fatalf("expected purgedReports ≥ 1, got %#v", out)
	}
}
