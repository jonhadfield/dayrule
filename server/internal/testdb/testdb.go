// Package testdb gives integration tests a migrated, empty Postgres.
//
// Tests need TEST_DATABASE_URL (CI provides a Postgres service; locally run
// `docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test
// -e POSTGRES_DB=dayrule_test postgres:18`).
package testdb

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/jonhadfield/dayrule/server/internal/store"
	"github.com/jonhadfield/dayrule/server/migrations"
)

var migrateOnce sync.Once

// New returns a pool on a freshly truncated, fully migrated database.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is not set (see internal/testdb for a local Postgres command)")
	}
	ctx := context.Background()

	var migrateErr error
	migrateOnce.Do(func() {
		db, err := sql.Open("pgx", url)
		if err != nil {
			migrateErr = err
			return
		}
		defer func() { _ = db.Close() }()
		provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
		if err != nil {
			migrateErr = err
			return
		}
		_, migrateErr = provider.Up(ctx)
	})
	if migrateErr != nil {
		t.Fatalf("migrate: %v", migrateErr)
	}

	pool, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `TRUNCATE users, sessions, email_codes, invite_codes CASCADE`); err != nil {
		t.Fatal(err)
	}
	return pool
}
