// Command invite creates single-use invite codes for sign-up while Dayrule
// is invite-only (decision 2). Codes are printed once; only their SHA-256 is
// stored.
//
//	DATABASE_URL_UNPOOLED=… go run ./cmd/invite 3
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/jonhadfield/dayrule/server/internal/auth"
	"github.com/jonhadfield/dayrule/server/internal/store"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "invite:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	n := 1
	if len(args) > 0 {
		v, err := strconv.Atoi(args[0])
		if err != nil || v < 1 || v > 100 {
			return errors.New("usage: invite [count 1-100]")
		}
		n = v
	}
	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		return errors.New("DATABASE_URL_UNPOOLED is not set")
	}
	if strings.Contains(url, "[SENSITIVE]") {
		// vercel env pull writes this placeholder for Sensitive variables.
		return errors.New("DATABASE_URL_UNPOOLED is Vercel's [SENSITIVE] placeholder, not a URL: copy the unpooled connection string from the Neon console")
	}
	pool, err := store.Open(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()

	codes := make([]string, n)
	hashes := make([][]byte, n)
	for i := range n {
		if codes[i], err = auth.NewInviteCode(); err != nil {
			return err
		}
		hashes[i] = auth.InviteHash(codes[i])
	}
	if err := (store.Accounts{Pool: pool}).CreateInvites(ctx, hashes); err != nil {
		return err
	}
	for _, c := range codes {
		fmt.Println(c)
	}
	return nil
}
