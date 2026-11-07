// Command things-export reads a Things 3 SQLite database read-only and writes
// a dayrule-things-export JSON file for Account → Your data → Import
// (PLAN.md §8.3). The Dayrule web app maps and encrypts the result; the
// server never sees plaintext.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	dbPath := flag.String("db", "", "path to Things main.sqlite (default: discover on this Mac)")
	outPath := flag.String("o", "-", "output path (`-` = stdout)")
	flag.Parse()

	path := *dbPath
	if path == "" {
		var err error
		path, err = defaultThingsDBPath()
		if err != nil {
			fatal(err)
		}
	}

	db, err := openThingsDB(path)
	if err != nil {
		fatal(err)
	}
	defer db.Close()

	doc, err := exportThings(db, time.Now())
	if err != nil {
		fatal(err)
	}
	if err := writeExport(*outPath, doc); err != nil {
		fatal(err)
	}
	if *outPath != "-" {
		fmt.Fprintf(os.Stderr, "Wrote %s (%d to-dos, %d projects, schema %d)\n",
			*outPath, len(doc.Todos), len(doc.Projects), doc.ThingsDatabaseVersion)
	}
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "things-export: %v\n", err)
	os.Exit(1)
}
