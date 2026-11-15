// Command error-reports lists recent client crash reports (PLAN.md decision 10).
// Message and stack only — no task content. Needs the environment's unpooled URL.
//
//	DATABASE_URL_UNPOOLED=… go run ./cmd/error-reports [limit]
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error-reports:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	limit := 20
	if len(args) > 0 {
		v, err := strconv.Atoi(args[0])
		if err != nil || v < 1 || v > 200 {
			return errors.New("usage: error-reports [limit 1-200]")
		}
		limit = v
	}
	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		return errors.New("DATABASE_URL_UNPOOLED is not set")
	}
	if strings.Contains(url, "[SENSITIVE]") {
		return errors.New("DATABASE_URL_UNPOOLED is Vercel's [SENSITIVE] placeholder, not a URL: copy the unpooled connection string from the Neon console")
	}
	pool, err := store.Open(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()

	rows, err := (store.ErrorReports{Pool: pool}).Recent(ctx, limit)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		fmt.Println("(no error reports)")
		return nil
	}
	for _, r := range rows {
		fmt.Printf("%s  id=%d  release=%q\n",
			r.CreatedAt.UTC().Format(time.RFC3339), r.ID, r.Release)
		fmt.Printf("  message: %s\n", oneLine(r.Message))
		if r.UserAgent != "" {
			fmt.Printf("  ua: %s\n", oneLine(r.UserAgent))
		}
		if r.Stack != "" {
			fmt.Printf("  stack:\n%s\n", indent(r.Stack, "    "))
		}
		fmt.Println()
	}
	return nil
}

func oneLine(s string) string {
	return strings.ReplaceAll(strings.TrimSpace(s), "\n", " / ")
}

func indent(s, prefix string) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}
