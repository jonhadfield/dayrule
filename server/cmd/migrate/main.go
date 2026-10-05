// Command migrate applies the embedded goose migrations.
//
// It connects with DATABASE_URL_UNPOOLED: migrations need a direct
// connection, not Neon's transaction-mode pooler.
//
//	go run ./cmd/migrate [up|status|down]
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/jonhadfield/dayrule/server/migrations"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(context.Background(), os.Args[1:]); err != nil {
		logger.Error("migrate failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	command := "up"
	if len(args) > 0 {
		command = args[0]
	}

	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		return errors.New("DATABASE_URL_UNPOOLED is not set")
	}

	db, err := sql.Open("pgx", url)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = db.Close() }()

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}

	switch command {
	case "up":
		results, err := provider.Up(ctx)
		for _, r := range results {
			fmt.Printf("applied %s (%s)\n", r.Source.Path, r.Duration)
		}
		return err
	case "status":
		statuses, err := provider.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range statuses {
			fmt.Printf("%-10s %s\n", s.State, s.Source.Path)
		}
		return nil
	case "down":
		r, err := provider.Down(ctx)
		if r != nil {
			fmt.Printf("rolled back %s\n", r.Source.Path)
		}
		return err
	default:
		return fmt.Errorf("unknown command %q (want up, status or down)", command)
	}
}
