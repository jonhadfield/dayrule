package main

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/jonhadfield/dayrule/server/internal/testdb"
)

func TestContains(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString([]byte("note: Water the plants"))
	for _, tc := range []struct {
		name  string
		value string
		want  bool
	}{
		{"plain", "Water the plants", true},
		{"other case", "WATER THE PLANTS", true},
		{"inside text", `{"title":"Water the plants"}`, true},
		{"inside base64", `{"ciphertext":"` + b64 + `"}`, true},
		{"inside url base64", base64.RawURLEncoding.EncodeToString([]byte("Water the plants!")), true},
		{"absent", "Feed the cat", false},
		{"ciphertext-like", "x9Qe0vZ2mN7pL4kR8sT1uW3yA6bC5dF0", false},
	} {
		if got := contains([]byte(tc.value), "Water the plants"); got != tc.want {
			t.Errorf("%s: contains = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestScan proves the scan reaches text, JSONB and bytea columns, so a pass
// in the end-to-end test means something.
func TestScan(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE TABLE plaintext_check_probe (t TEXT, j JSONB, b BYTEA)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DROP TABLE plaintext_check_probe`) })
	if _, err := pool.Exec(ctx, `INSERT INTO plaintext_check_probe VALUES ($1, $2, $3)`,
		"alpha marker", `{"x":"`+base64.StdEncoding.EncodeToString([]byte("bravo marker"))+`"}`,
		[]byte("charlie marker")); err != nil {
		t.Fatal(err)
	}

	found, err := scan(ctx, pool, []string{"alpha marker", "bravo marker", "charlie marker", "delta marker"})
	if err != nil {
		t.Fatal(err)
	}
	want := []Finding{
		{"plaintext_check_probe.b", "charlie marker"},
		{"plaintext_check_probe.j", "bravo marker"},
		{"plaintext_check_probe.t", "alpha marker"},
	}
	if len(found) != len(want) {
		t.Fatalf("found %v, want %v", found, want)
	}
	for i := range want {
		if found[i] != want[i] {
			t.Errorf("found[%d] = %v, want %v", i, found[i], want[i])
		}
	}
}
