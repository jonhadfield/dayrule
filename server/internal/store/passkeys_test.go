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
		CredentialID:   []byte(fmt.Sprintf("cred-%d", n)),
		PublicKey:      []byte("cose-public-key"),
		SignCount:      1,
		AAGUID:         bytes.Repeat([]byte{0xad}, 16),
		Transports:     []string{"internal", "hybrid"},
		BackupEligible: true,
		Label:          "Chrome on macOS",
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
			first.SignCount != 1 || len(first.AAGUID) != 16 || !first.BackupEligible ||
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
		if err := p.Used(ctx, alice, []byte("cred-1"), 7, true, at); err != nil {
			t.Fatal(err)
		}
		got, _ := p.List(ctx, alice)
		if got[0].SignCount != 7 || !got[0].BackupState || got[0].LastUsedAt == nil || !got[0].LastUsedAt.Equal(at) {
			t.Errorf("after Used = %+v", got[0])
		}
		if err := p.Used(ctx, bob, []byte("cred-1"), 8, true, at); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("Used on another account's passkey = %v, want ErrNotFound", err)
		}
	})

	t.Run("deletes only the account's own", func(t *testing.T) {
		if ok, err := p.Delete(ctx, bob, []byte("cred-2")); ok || err != nil {
			t.Errorf("Delete by bob = %v, %v; want false, nil", ok, err)
		}
		if ok, err := p.Delete(ctx, alice, []byte("cred-2")); !ok || err != nil {
			t.Errorf("Delete by alice = %v, %v; want true, nil", ok, err)
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
