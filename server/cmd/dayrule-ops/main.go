// Command dayrule-ops is local operator tooling against one Neon environment.
// Metadata only — no ciphertext is read or printed. Needs that environment's
// unpooled URL (same as invite / error-reports).
//
//	DATABASE_URL_UNPOOLED=… go run ./cmd/dayrule-ops users
//	DATABASE_URL_UNPOOLED=… go run ./cmd/dayrule-ops stats
//	DATABASE_URL_UNPOOLED=… go run ./cmd/dayrule-ops delete --email=user@example.com
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "dayrule-ops:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: dayrule-ops users|stats|delete --email=…")
	}
	pool, err := openPool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()

	now := time.Now().UTC()
	switch args[0] {
	case "users":
		return cmdUsers(ctx, pool, now)
	case "stats":
		return cmdStats(ctx, pool, now)
	case "delete":
		return cmdDelete(ctx, pool, args[1:])
	default:
		return fmt.Errorf("unknown command %q (users|stats|delete)", args[0])
	}
}

func openPool(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		return nil, errors.New("DATABASE_URL_UNPOOLED is not set")
	}
	if strings.Contains(url, "[SENSITIVE]") {
		return nil, errors.New("DATABASE_URL_UNPOOLED is Vercel's [SENSITIVE] placeholder, not a URL: copy the unpooled connection string from the Neon console")
	}
	return store.Open(ctx, url)
}

func cmdUsers(ctx context.Context, pool *pgxpool.Pool, now time.Time) error {
	rows, err := (store.Ops{Pool: pool}).ListUsers(ctx, now)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		fmt.Println("(no users)")
		return nil
	}
	for _, u := range rows {
		seen := "-"
		if u.LastSeenAt != nil {
			seen = u.LastSeenAt.UTC().Format(time.RFC3339)
		}
		locked := ""
		if u.LockedUntil != nil && u.LockedUntil.After(now) {
			locked = fmt.Sprintf("  locked_until=%s", u.LockedUntil.UTC().Format(time.RFC3339))
		}
		fmt.Printf("%s  %s  created=%s  last_seen=%s  sessions=%d  records=%d  bytes=%d%s\n",
			u.Email, u.ID, u.CreatedAt.UTC().Format(time.RFC3339),
			seen, u.SessionCount, u.RecordCount, u.StoredBytes, locked)
	}
	return nil
}

func cmdStats(ctx context.Context, pool *pgxpool.Pool, now time.Time) error {
	s, err := (store.Ops{Pool: pool}).Stats(ctx, now)
	if err != nil {
		return err
	}
	fmt.Printf("users:              %d\n", s.Users)
	fmt.Printf("users_last_7d:      %d\n", s.UsersLast7Days)
	fmt.Printf("users_last_30d:     %d\n", s.UsersLast30Days)
	fmt.Printf("active_users_7d:    %d\n", s.ActiveUsers7Days)
	fmt.Printf("active_users_30d:   %d\n", s.ActiveUsers30Days)
	fmt.Printf("live_sessions:      %d\n", s.LiveSessions)
	fmt.Printf("record_count:       %d\n", s.RecordCount)
	fmt.Printf("stored_bytes:       %d\n", s.StoredBytes)
	fmt.Printf("unused_invites:     %d\n", s.UnusedInvites)
	fmt.Printf("pending_reminders:  %d\n", s.PendingReminders)
	fmt.Printf("error_reports:      %d\n", s.ErrorReports)
	return nil
}

func cmdDelete(ctx context.Context, pool *pgxpool.Pool, args []string) error {
	email, err := flagEmail(args)
	if err != nil {
		return err
	}
	accounts := store.Accounts{Pool: pool}
	u, err := accounts.UserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return fmt.Errorf("no account for %s", email)
		}
		return err
	}
	fmt.Fprintf(os.Stderr, "Delete %s (%s)? Type the email to confirm: ", u.Email, u.ID)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return err
	}
	if strings.TrimSpace(line) != u.Email {
		return errors.New("confirmation did not match; nothing deleted")
	}
	if err := accounts.DeleteUser(ctx, u.ID); err != nil {
		return err
	}
	fmt.Printf("deleted %s (%s)\n", u.Email, u.ID)
	return nil
}

func flagEmail(args []string) (string, error) {
	const prefix = "--email="
	for _, a := range args {
		if strings.HasPrefix(a, prefix) {
			email := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(a, prefix)))
			if email == "" || !strings.Contains(email, "@") {
				return "", errors.New("usage: dayrule-ops delete --email=user@example.com")
			}
			return email, nil
		}
	}
	return "", errors.New("usage: dayrule-ops delete --email=user@example.com")
}
