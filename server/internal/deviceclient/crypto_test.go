package deviceclient

import (
	"crypto/sha256"
	"testing"
	"time"
)

func TestSyncIDStableUUIDv4Shape(t *testing.T) {
	key := sha256.Sum256([]byte("test-sync-id-key"))
	id := syncID(key[:], "todos/01900000-0000-7000-8000-000000000001")
	if len(id) != 36 {
		t.Fatalf("len = %d, want 36: %s", len(id), id)
	}
	if id[14] != '4' {
		t.Fatalf("version nibble: %s", id)
	}
	if id2 := syncID(key[:], "todos/01900000-0000-7000-8000-000000000001"); id2 != id {
		t.Fatalf("not stable: %s vs %s", id, id2)
	}
}

func TestPadBuckets(t *testing.T) {
	p := pad([]byte("hi"))
	if len(p) != 256 || p[2] != 0x80 {
		t.Fatalf("pad short: len=%d", len(p))
	}
}

func TestHLCTickFormat(t *testing.T) {
	tick := hlcTick(time.UnixMilli(0), 0, "dev")
	if tick != "000000000-0000-dev" {
		t.Fatalf("tick = %q", tick)
	}
}
