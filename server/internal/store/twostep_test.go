package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/store"
	"github.com/jonhadfield/dayrule/server/internal/testdb"
)

func TestTOTPSecrets(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	ts := store.TwoStep{Accounts: store.Accounts{Pool: pool}}
	alice := newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

	if _, err := ts.TOTP(ctx, alice); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("no secret = %v", err)
	}
	if err := ts.StartTOTP(ctx, alice, []byte("first"), now); err != nil {
		t.Fatal(err)
	}
	if err := ts.SetupFailed(ctx, alice); err != nil {
		t.Fatal(err)
	}
	// Starting again replaces an unfinished set-up and its attempts.
	if err := ts.StartTOTP(ctx, alice, []byte("second"), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	s, err := ts.TOTP(ctx, alice)
	if err != nil || string(s.Sealed) != "second" || s.Attempts != 0 || s.ConfirmedAt != nil {
		t.Fatalf("pending = %+v %v", s, err)
	}
	if m, _ := ts.Methods(ctx, alice); m.TOTP {
		t.Error("an unfinished set-up counts as a second step")
	}

	if err := ts.ConfirmTOTP(ctx, alice, 100, now); err != nil {
		t.Fatal(err)
	}
	if err := ts.StartTOTP(ctx, alice, []byte("third"), now); !errors.Is(err, store.ErrConflict) {
		t.Errorf("start while on = %v", err)
	}
	if m, _ := ts.Methods(ctx, alice); !m.TOTP {
		t.Error("confirmed TOTP not counted")
	}

	t.Run("no step is used twice", func(t *testing.T) {
		if err := ts.UseTOTP(ctx, alice, 100, now); !errors.Is(err, store.ErrConflict) {
			t.Errorf("the confirming step again = %v", err)
		}
		if err := ts.UseTOTP(ctx, alice, 101, now); err != nil {
			t.Errorf("next step = %v", err)
		}
		if err := ts.UseTOTP(ctx, alice, 101, now); !errors.Is(err, store.ErrConflict) {
			t.Errorf("same step = %v", err)
		}
		if s, _ := ts.TOTP(ctx, alice); s.LastStep != 101 || s.LastUsedAt == nil {
			t.Errorf("after use = %+v", s)
		}
	})

	if on, err := ts.DeleteTOTP(ctx, alice); err != nil || !on {
		t.Errorf("delete = %v %v", on, err)
	}
	if on, err := ts.DeleteTOTP(ctx, alice); err != nil || on {
		t.Errorf("delete again = %v %v", on, err)
	}
}

func TestBackupCodes(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	ts := store.TwoStep{Accounts: store.Accounts{Pool: pool}}
	p := store.Passkeys(ts)
	alice, bob := newUser(t, pool), newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

	if err := ts.ReplaceBackupCodes(ctx, alice, [][]byte{[]byte("a1"), []byte("a2"), []byte("a3")}); err != nil {
		t.Fatal(err)
	}
	if err := ts.ReplaceBackupCodes(ctx, bob, [][]byte{[]byte("b1")}); err != nil {
		t.Fatal(err)
	}
	if left, err := ts.UseBackupCode(ctx, alice, []byte("a2")); err != nil || left != 2 {
		t.Errorf("use = %d %v", left, err)
	}
	if _, err := ts.UseBackupCode(ctx, alice, []byte("a2")); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("used twice = %v", err)
	}
	if _, err := ts.UseBackupCode(ctx, alice, []byte("b1")); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("another account's code = %v", err)
	}
	// New codes replace every old one.
	if err := ts.ReplaceBackupCodes(ctx, alice, [][]byte{[]byte("a4")}); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.UseBackupCode(ctx, alice, []byte("a1")); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("an old code = %v", err)
	}

	t.Run("dropped once no second step is left", func(t *testing.T) {
		if err := p.Add(ctx, alice, passkey(1), now); err != nil {
			t.Fatal(err)
		}
		if dropped, _ := ts.DropUnneededBackupCodes(ctx, alice); dropped {
			t.Error("dropped while a passkey is on")
		}
		if _, err := p.Delete(ctx, alice, passkey(1).CredentialID); err != nil {
			t.Fatal(err)
		}
		if dropped, err := ts.DropUnneededBackupCodes(ctx, alice); err != nil || !dropped {
			t.Errorf("drop = %v %v", dropped, err)
		}
		if m, _ := ts.Methods(ctx, alice); m.BackupCodes != 0 || m.Passkeys != 0 {
			t.Errorf("methods = %+v", m)
		}
		if m, _ := ts.Methods(ctx, bob); m.BackupCodes != 1 {
			t.Errorf("bob's methods = %+v", m)
		}
	})
}

func TestSecondStepLockout(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	ts := store.TwoStep{Accounts: store.Accounts{Pool: pool}}
	alice := newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

	for range 4 {
		if err := ts.SecondStepFailed(ctx, alice, now); err != nil {
			t.Fatal(err)
		}
	}
	if locked, _ := ts.SecondStepLocked(ctx, alice, now); locked {
		t.Error("locked after 4")
	}
	_ = ts.SecondStepFailed(ctx, alice, now)
	if locked, _ := ts.SecondStepLocked(ctx, alice, now); !locked {
		t.Error("not locked after 5")
	}
	if locked, _ := ts.SecondStepLocked(ctx, alice, now.Add(61*time.Second)); locked {
		t.Error("still locked after a minute")
	}
	_ = ts.SecondStepFailed(ctx, alice, now)
	if locked, _ := ts.SecondStepLocked(ctx, alice, now.Add(61*time.Second)); !locked {
		t.Error("the sixth failure should lock for two minutes")
	}
	if err := ts.SecondStepPassed(ctx, alice); err != nil {
		t.Fatal(err)
	}
	if locked, _ := ts.SecondStepLocked(ctx, alice, now); locked {
		t.Error("still locked after a pass")
	}
}

func TestTwoStepReset(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	ts := store.TwoStep{Accounts: store.Accounts{Pool: pool}}
	p := store.Passkeys(ts)
	alice := newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)
	week := now.Add(7 * 24 * time.Hour)

	if err := p.Add(ctx, alice, passkey(1), now); err != nil {
		t.Fatal(err)
	}
	if err := ts.StartTOTP(ctx, alice, []byte("sealed"), now); err != nil {
		t.Fatal(err)
	}
	if err := ts.ConfirmTOTP(ctx, alice, 1, now); err != nil {
		t.Fatal(err)
	}
	if err := ts.ReplaceBackupCodes(ctx, alice, [][]byte{[]byte("c1")}); err != nil {
		t.Fatal(err)
	}

	due, created, err := ts.RequestReset(ctx, alice, now, week)
	if err != nil || !created || !due.Equal(week) {
		t.Fatalf("request = %v %v %v", due, created, err)
	}
	// Asking again keeps the first date.
	if due, created, _ := ts.RequestReset(ctx, alice, now.Add(time.Hour), week.Add(time.Hour)); created || !due.Equal(week) {
		t.Errorf("again = %v %v", due, created)
	}
	if at, _ := ts.PendingReset(ctx, alice); at == nil || !at.Equal(week) {
		t.Errorf("pending = %v", at)
	}

	if n, _ := ts.ResetsDueSoon(ctx, week.Add(-25*time.Hour), 24*time.Hour); len(n) != 0 {
		t.Errorf("warned two days early: %v", n)
	}
	if n, err := ts.ResetsDueSoon(ctx, week.Add(-time.Hour), 24*time.Hour); err != nil || len(n) != 1 || !n[0].DueAt.Equal(week) {
		t.Errorf("warnings = %v %v", n, err)
	}
	if n, _ := ts.ResetsDueSoon(ctx, week.Add(-time.Minute), 24*time.Hour); len(n) != 0 {
		t.Errorf("warned twice: %v", n)
	}

	if done, err := ts.CompleteReset(ctx, alice, week.Add(-time.Second)); err != nil || done {
		t.Errorf("early = %v %v", done, err)
	}
	if done, err := ts.CompleteReset(ctx, alice, week); err != nil || !done {
		t.Fatalf("due = %v %v", done, err)
	}
	if m, _ := ts.Methods(ctx, alice); m != (store.Methods{}) {
		t.Errorf("methods after = %+v", m)
	}
	if at, _ := ts.PendingReset(ctx, alice); at != nil {
		t.Errorf("still pending: %v", at)
	}

	t.Run("cancel", func(t *testing.T) {
		_, _, _ = ts.RequestReset(ctx, alice, now, week)
		if ok, err := ts.CancelReset(ctx, alice); err != nil || !ok {
			t.Errorf("cancel = %v %v", ok, err)
		}
		if ok, _ := ts.CancelReset(ctx, alice); ok {
			t.Error("cancelled twice")
		}
	})
}
