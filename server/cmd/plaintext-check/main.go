// Command plaintext-check searches every column of every table for given
// strings, for the end-to-end test that the server database holds no
// plaintext user content (PLAN.md §16). It prints one "table.column<TAB>needle"
// line per match and exits 0; the test decides what a match means.
//
// Values are searched as stored (bytea as raw bytes, everything else as
// text), case-insensitively, and inside any base64 they contain (JSONB
// fields such as wrapped_ak_pw hold base64).
//
//	DATABASE_URL_UNPOOLED=… go run ./cmd/plaintext-check "Water the plants"
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jonhadfield/dayrule/server/internal/store"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "plaintext-check:", err)
		os.Exit(2)
	}
}

func run(ctx context.Context, needles []string) error {
	if len(needles) == 0 {
		return errors.New("usage: plaintext-check needle [needle ...]")
	}
	url := os.Getenv("DATABASE_URL_UNPOOLED")
	if url == "" {
		return errors.New("DATABASE_URL_UNPOOLED is not set")
	}
	pool, err := store.Open(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()
	found, err := scan(ctx, pool, needles)
	if err != nil {
		return err
	}
	for _, f := range found {
		fmt.Printf("%s\t%s\n", f.Column, f.Needle)
	}
	return nil
}

// A Finding is a needle seen in a column ("table.column").
type Finding struct{ Column, Needle string }

// scan searches every column of every table in the public schema.
func scan(ctx context.Context, pool *pgxpool.Pool, needles []string) ([]Finding, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.table_name, c.column_name, c.data_type
		FROM information_schema.columns c
		JOIN information_schema.tables t USING (table_schema, table_name)
		WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
		ORDER BY c.table_name, c.ordinal_position`)
	if err != nil {
		return nil, err
	}
	type column struct{ table, name, typ string }
	cols, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (column, error) {
		var c column
		return c, r.Scan(&c.table, &c.name, &c.typ)
	})
	if err != nil {
		return nil, err
	}
	if len(cols) == 0 {
		return nil, errors.New("no tables found: is the database migrated?")
	}

	seen := map[Finding]bool{}
	for _, c := range cols {
		expr := pgx.Identifier{c.name}.Sanitize()
		if c.typ != "bytea" {
			expr += "::text"
		}
		q := fmt.Sprintf("SELECT %s FROM %s", expr, pgx.Identifier{c.table}.Sanitize())
		rows, err := pool.Query(ctx, q)
		if err != nil {
			return nil, fmt.Errorf("%s.%s: %w", c.table, c.name, err)
		}
		values, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
		if err != nil {
			return nil, fmt.Errorf("%s.%s: %w", c.table, c.name, err)
		}
		for _, v := range values {
			for _, n := range needles {
				if contains(v, n) {
					seen[Finding{c.table + "." + c.name, n}] = true
				}
			}
		}
	}
	found := make([]Finding, 0, len(seen))
	for f := range seen {
		found = append(found, f)
	}
	sort.Slice(found, func(i, j int) bool {
		if found[i].Column != found[j].Column {
			return found[i].Column < found[j].Column
		}
		return found[i].Needle < found[j].Needle
	})
	return found, nil
}

var base64Run = regexp.MustCompile(`[A-Za-z0-9+/_-]{8,}={0,2}`)

var encodings = []*base64.Encoding{
	base64.StdEncoding, base64.RawStdEncoding,
	base64.URLEncoding, base64.RawURLEncoding,
}

// contains reports whether needle appears in value, ignoring case, either
// directly or inside base64 that value contains.
func contains(value []byte, needle string) bool {
	n := bytes.ToLower([]byte(needle))
	if bytes.Contains(bytes.ToLower(value), n) {
		return true
	}
	for _, run := range base64Run.FindAll(value, -1) {
		for _, enc := range encodings {
			if d, err := enc.DecodeString(string(run)); err == nil && bytes.Contains(bytes.ToLower(d), n) {
				return true
			}
		}
	}
	return false
}
