package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

func rec(id string, baseSeq int64, size int, tombstone bool) map[string]any {
	ct := make([]byte, size)
	_, _ = rand.Read(ct)
	return map[string]any{
		"id": id, "baseSeq": baseSeq, "alg": 1, "keyId": 1,
		"nonce": rnd(24), "ciphertext": base64.StdEncoding.EncodeToString(ct), "tombstone": tombstone,
	}
}

func results(t *testing.T, r resp) []map[string]any {
	t.Helper()
	if r.code != 200 {
		t.Fatalf("push = %d %v", r.code, r.body)
	}
	raw, _ := r.body["results"].([]any)
	out := make([]map[string]any, len(raw))
	for i, x := range raw {
		out[i] = x.(map[string]any)
	}
	return out
}

func TestPushPullAndConflicts(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("sync@example.com")
	id1, id2 := uuid.NewString(), uuid.NewString()

	res := results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id1, 0, 300, false), rec(id2, 0, 300, false)}}))
	if res[0]["seq"].(float64) != 1 || res[1]["seq"].(float64) != 2 {
		t.Fatalf("seqs = %v", res)
	}
	if h := a.c.do("GET", "/api/v1/sync/head", nil); h.body["seq"].(float64) != 2 {
		t.Fatalf("head = %v", h.body)
	}

	// A second device pulls everything.
	b := &client{hs: hs}
	b.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})
	p := b.do("GET", "/api/v1/sync/pull?since=0", nil)
	if recs := p.body["records"].([]any); len(recs) != 2 || p.body["cursor"].(float64) != 2 {
		t.Fatalf("pull = %v", p.body)
	}

	// Device B updates id1 from seq 1; device A then pushes from the stale seq 1.
	res = results(t, b.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id1, 1, 300, false)}}))
	if res[0]["seq"].(float64) != 3 {
		t.Fatalf("B's update = %v", res)
	}
	res = results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id1, 1, 300, false)}}))
	if res[0]["conflict"] != true || res[0]["seq"].(float64) != 3 {
		t.Fatalf("stale write should conflict at seq 3: %v", res)
	}
	// Creating a record that already exists is also a conflict.
	res = results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id2, 0, 300, false)}}))
	if res[0]["conflict"] != true {
		t.Fatalf("blind create should conflict: %v", res)
	}

	// Incremental pull sees only the change.
	p = a.c.do("GET", "/api/v1/sync/pull?since=2", nil)
	if recs := p.body["records"].([]any); len(recs) != 1 || recs[0].(map[string]any)["id"] != id1 {
		t.Fatalf("incremental pull = %v", p.body)
	}
}

func TestPullPagesAndUserIsolation(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("pages@example.com")
	var batch []any
	for range 501 {
		batch = append(batch, rec(uuid.NewString(), 0, 32, false))
	}
	if r := a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": batch[:500]}); r.code != 200 {
		t.Fatalf("push 500 = %d", r.code)
	}
	if r := a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": batch}); r.code != 400 {
		t.Fatalf("push 501 should be refused, got %d", r.code)
	}
	a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": batch[500:]})
	p := a.c.do("GET", "/api/v1/sync/pull?since=0", nil)
	if len(p.body["records"].([]any)) != 500 || p.body["hasMore"] != true {
		t.Fatalf("first page = %d hasMore=%v", len(p.body["records"].([]any)), p.body["hasMore"])
	}
	p = a.c.do("GET", fmt.Sprintf("/api/v1/sync/pull?since=%d", int(p.body["cursor"].(float64))), nil)
	if len(p.body["records"].([]any)) != 1 || p.body["hasMore"] != false {
		t.Fatalf("second page = %v", p.body["hasMore"])
	}

	other := hs.signUp("other@example.com")
	if p := other.c.do("GET", "/api/v1/sync/pull?since=0", nil); len(p.body["records"].([]any)) != 0 {
		t.Fatal("another user's records leaked")
	}
	if r := (&client{hs: hs}).do("GET", "/api/v1/sync/head", nil); r.code != 401 {
		t.Fatalf("sync without a session = %d", r.code)
	}
}

func TestQuotasAndTombstones(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("quota@example.com")
	res := results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(uuid.NewString(), 0, store.MaxRecordBytes+1, false)}}))
	if res[0]["error"] != "too_large" {
		t.Fatalf("oversized record = %v", res)
	}

	// Fill close to the byte quota directly, then a normal push is refused
	// but a tombstone (which frees space) is accepted.
	id := uuid.NewString()
	results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id, 0, 1000, false)}}))
	if _, err := hs.store.Pool.Exec(context.Background(), `UPDATE users SET stored_bytes = $1 WHERE email = $2`,
		store.MaxStoredBytes-500, a.email); err != nil {
		t.Fatal(err)
	}
	res = results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(uuid.NewString(), 0, 1000, false)}}))
	if res[0]["error"] != "quota" {
		t.Fatalf("over quota = %v", res)
	}
	res = results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(id, 1, 40, true)}}))
	if res[0]["error"] != nil || res[0]["conflict"] != nil {
		t.Fatalf("tombstone should be accepted: %v", res)
	}
}

func TestGCPurgesOldTombstonesAndForcesResync(t *testing.T) {
	hs := newHarness(t)
	a := hs.signUp("gc@example.com")
	keep, gone := uuid.NewString(), uuid.NewString()
	results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(keep, 0, 64, false), rec(gone, 0, 64, false)}}))
	results(t, a.c.do("POST", "/api/v1/sync/push", map[string]any{"records": []any{rec(gone, 2, 32, true)}}))

	req := httptest.NewRequest("GET", "/api/internal/gc", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("gc with a wrong secret = %d", rec.Code)
	}

	hs.now = hs.now.Add(91 * 24 * time.Hour)
	if _, err := hs.store.Pool.Exec(context.Background(), `UPDATE records SET updated_at = now() - interval '91 days' WHERE tombstone`); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/api/internal/gc", nil)
	req.Header.Set("Authorization", "Bearer cron-test-secret")
	rec = httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("gc = %d %s", rec.Code, rec.Body.String())
	}

	// 91 days on, the old session has expired; sign in again.
	a.c.do("POST", "/api/v1/auth/login", map[string]string{"email": a.email, "authKey": a.authKey})

	// A device last synced before the purge must resync; a fresh one is fine.
	if r := a.c.do("GET", "/api/v1/sync/pull?since=1", nil); r.code != 410 || r.body["code"] != "resync" {
		t.Fatalf("stale cursor = %d %v", r.code, r.body)
	}
	if r := a.c.do("GET", "/api/v1/sync/pull?since=0", nil); r.code != 200 || len(r.body["records"].([]any)) != 1 {
		t.Fatalf("full pull = %d %v", r.code, r.body)
	}
	if r := a.c.do("GET", "/api/v1/sync/pull?since=1&full=1", nil); r.code != 200 {
		t.Fatalf("paging a full download = %d %v", r.code, r.body)
	}
}
