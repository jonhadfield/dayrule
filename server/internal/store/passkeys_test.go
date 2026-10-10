package store_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jonhadfield/dayrule/server/internal/store"
	"github.com/jonhadfield/dayrule/server/internal/testdb"
)

func newUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash,
		auth_salt, wrapped_ak_pw, wrapped_ak_recovery, recovery_proof_hash)
		VALUES ($1, $2, '\x00', '{}'::jsonb, '\x00', '\x00', '{}'::jsonb, '{}'::jsonb, '\x00')`,
		id, id.String()+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func passkey(n int) store.Passkey {
	return store.Passkey{
		CredentialID: []byte(fmt.Sprintf("cred-%d", n)),
		RPID:         "dayrule.app",
		PublicKey:    []byte("cose-public-key"),
		SignCount:    1,
		Flags:        0x01 | store.FlagBackupEligible,
		AAGUID:       bytes.Repeat([]byte{0xad}, 16),
		Transports:   []string{"internal", "hybrid"},
		Label:        "Chrome on macOS",
	}
}

func TestPasskeys(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	p := store.Passkeys{Accounts: store.Accounts{Pool: pool}}
	alice, bob := newUser(t, pool), newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

	if err := p.Add(ctx, alice, passkey(1), now); err != nil {
		t.Fatal(err)
	}
	k := passkey(2)
	k.Transports, k.AAGUID = nil, nil
	if err := p.Add(ctx, alice, k, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}

	t.Run("a credential id belongs to one account", func(t *testing.T) {
		if err := p.Add(ctx, bob, passkey(1), now); !errors.Is(err, store.ErrConflict) {
			t.Fatalf("Add = %v, want ErrConflict", err)
		}
	})

	t.Run("lists the account's own, oldest first", func(t *testing.T) {
		got, err := p.List(ctx, alice)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d passkeys, want 2", len(got))
		}
		first := got[0]
		if string(first.CredentialID) != "cred-1" || string(first.PublicKey) != "cose-public-key" ||
			first.SignCount != 1 || len(first.AAGUID) != 16 || first.Flags != 0x01|store.FlagBackupEligible ||
			first.RPID != "dayrule.app" ||
			fmt.Sprint(first.Transports) != "[internal hybrid]" || first.Label != "Chrome on macOS" ||
			!first.CreatedAt.Equal(now) || first.LastUsedAt != nil {
			t.Errorf("first = %+v", first)
		}
		if got[1].AAGUID != nil || len(got[1].Transports) != 0 {
			t.Errorf("second = %+v, want no AAGUID or transports", got[1])
		}
		none, err := p.List(ctx, bob)
		if err != nil || len(none) != 0 {
			t.Errorf("bob's list = %v, %v; want none", none, err)
		}
	})

	t.Run("records a sign-in", func(t *testing.T) {
		at := now.Add(time.Hour)
		flags := uint8(0x01 | store.FlagBackupEligible | store.FlagBackupState)
		if err := p.Used(ctx, alice, []byte("cred-1"), 7, false, flags, at); err != nil {
			t.Fatal(err)
		}
		got, _ := p.List(ctx, alice)
		if got[0].SignCount != 7 || got[0].Flags != flags || got[0].LastUsedAt == nil || !got[0].LastUsedAt.Equal(at) {
			t.Errorf("after Used = %+v", got[0])
		}
		var backedUp bool
		if err := pool.QueryRow(ctx, `SELECT backup_state FROM webauthn_credentials WHERE credential_id = $1`,
			[]byte("cred-1")).Scan(&backedUp); err != nil || !backedUp {
			t.Errorf("backup_state = %v, %v; want true", backedUp, err)
		}
		if err := p.Used(ctx, bob, []byte("cred-1"), 8, false, flags, at); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("Used on another account's passkey = %v, want ErrNotFound", err)
		}
	})

	t.Run("deletes only the account's own", func(t *testing.T) {
		if _, err := p.Delete(ctx, bob, []byte("cred-2")); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("Delete by bob = %v; want ErrNotFound", err)
		}
		if lbl, err := p.Delete(ctx, alice, []byte("cred-2")); lbl != "Chrome on macOS" || err != nil {
			t.Errorf("Delete by alice = %q, %v; want its label", lbl, err)
		}
	})

	t.Run("caps passkeys per account", func(t *testing.T) {
		for i := range store.MaxPasskeys {
			if err := p.Add(ctx, bob, passkey(100+i), now); err != nil {
				t.Fatal(err)
			}
		}
		if err := p.Add(ctx, bob, passkey(200), now); !errors.Is(err, store.ErrTooMany) {
			t.Errorf("Add past the cap = %v, want ErrTooMany", err)
		}
	})

	t.Run("go with the account", func(t *testing.T) {
		if err := (store.Accounts{Pool: pool}).DeleteUser(ctx, alice); err != nil {
			t.Fatal(err)
		}
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM webauthn_credentials WHERE user_id = $1`, alice).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%d passkeys left after deleting the account", n)
		}
	})
}

func TestHandle(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	p := store.Passkeys{Accounts: store.Accounts{Pool: pool}}
	alice, bob := newUser(t, pool), newUser(t, pool)
	h1, err := p.Handle(ctx, alice)
	if err != nil || len(h1) != 32 {
		t.Fatalf("Handle = %x, %v", h1, err)
	}
	if h2, _ := p.Handle(ctx, alice); !bytes.Equal(h1, h2) {
		t.Error("the handle changed on the second call")
	}
	if hb, _ := p.Handle(ctx, bob); bytes.Equal(h1, hb) {
		t.Error("two users share a handle")
	}
	if _, err := p.Handle(ctx, uuid.New()); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("Handle for no user = %v, want ErrNotFound", err)
	}
}

func TestCeremonies(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	p := store.Passkeys{Accounts: store.Accounts{Pool: pool}}
	alice := newUser(t, pool)
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)
	login := store.Ceremony{UserID: alice, Purpose: store.CeremonyLogin, DeviceLabel: "Firefox"}
	token := []byte("login-token-hash")
	if err := p.StartCeremony(ctx, token, login, nil, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}

	t.Run("no challenge until one is issued", func(t *testing.T) {
		if _, err := p.TakeChallenge(ctx, token, store.CeremonyLogin, now); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("TakeChallenge = %v, want ErrNotFound", err)
		}
	})

	t.Run("a challenge is answered once", func(t *testing.T) {
		if id, err := p.CeremonyUser(ctx, token, store.CeremonyLogin, now, 5); id != alice || err != nil {
			t.Fatalf("CeremonyUser = %v, %v", id, err)
		}
		if err := p.IssueChallenge(ctx, token, store.CeremonyLogin, []byte(`{"challenge":"abc"}`), now, 5); err != nil {
			t.Fatal(err)
		}
		c, err := p.TakeChallenge(ctx, token, store.CeremonyLogin, now)
		if err != nil {
			t.Fatal(err)
		}
		if c.UserID != alice || c.DeviceLabel != "Firefox" || string(c.Data) != `{"challenge": "abc"}` {
			t.Errorf("ceremony = %+v (data %s)", c, c.Data)
		}
		if _, err := p.TakeChallenge(ctx, token, store.CeremonyLogin, now); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("second TakeChallenge = %v, want ErrNotFound", err)
		}
	})

	t.Run("the purpose must match", func(t *testing.T) {
		if err := p.IssueChallenge(ctx, token, store.CeremonyRegister, []byte(`{}`), now, 5); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("IssueChallenge for register = %v, want ErrNotFound", err)
		}
	})

	t.Run("challenges run out", func(t *testing.T) {
		for range 4 { // one was issued above
			if err := p.IssueChallenge(ctx, token, store.CeremonyLogin, []byte(`{}`), now, 5); err != nil {
				t.Fatal(err)
			}
		}
		if err := p.IssueChallenge(ctx, token, store.CeremonyLogin, []byte(`{}`), now, 5); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("sixth IssueChallenge = %v, want ErrNotFound", err)
		}
		if _, err := p.CeremonyUser(ctx, token, store.CeremonyLogin, now, 5); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("CeremonyUser after the cap = %v, want ErrNotFound", err)
		}
	})

	t.Run("expires", func(t *testing.T) {
		other := []byte("register-token-hash")
		reg := store.Ceremony{UserID: alice, Purpose: store.CeremonyRegister}
		if err := p.StartCeremony(ctx, other, reg, []byte(`{"challenge":"x"}`), now.Add(5*time.Minute)); err != nil {
			t.Fatal(err)
		}
		if _, err := p.TakeChallenge(ctx, other, store.CeremonyRegister, now.Add(6*time.Minute)); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("TakeChallenge after expiry = %v, want ErrNotFound", err)
		}
		if _, err := p.TakeChallenge(ctx, other, store.CeremonyRegister, now); err != nil {
			t.Errorf("TakeChallenge before expiry = %v", err)
		}
	})

	t.Run("ends", func(t *testing.T) {
		if err := p.EndCeremony(ctx, token); err != nil {
			t.Fatal(err)
		}
		if _, err := p.CeremonyUser(ctx, token, store.CeremonyLogin, now, 100); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("CeremonyUser after EndCeremony = %v, want ErrNotFound", err)
		}
	})
}
