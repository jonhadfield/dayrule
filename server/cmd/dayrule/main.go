// Command dayrule is a local Dayrule client: CLI commands and an MCP server
// (stdio) that manage to-dos via the same encrypted sync API as the apps.
//
// Auth: DAYRULE_EMAIL + DAYRULE_PASSWORD (optional DAYRULE_API, default
// https://dayrule.app). Two-step sign-in is not supported yet.
//
//	go run ./cmd/dayrule inbox
//	go run ./cmd/dayrule today
//	go run ./cmd/dayrule add "Buy milk"
//	go run ./cmd/dayrule complete "Buy milk"
//	go run ./cmd/dayrule mcp
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/deviceclient"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]
	args := os.Args[2:]
	ctx := context.Background()

	switch cmd {
	case "help", "-h", "--help":
		usage()
		return
	case "doctor":
		if err := runDoctor(ctx); err != nil {
			fatal(err)
		}
		return
	case "mcp":
		if err := runMCP(ctx); err != nil {
			fatal(err)
		}
		return
	}

	s, err := sessionFromCreds(ctx)
	if err != nil {
		fatal(err)
	}
	defer s.Close()

	switch cmd {
	case "inbox":
		v, err := s.PullVault(ctx)
		if err != nil {
			fatal(err)
		}
		printTodos(v.Inbox())
	case "today":
		v, err := s.PullVault(ctx)
		if err != nil {
			fatal(err)
		}
		printTodos(v.Today(time.Now().Format("2006-01-02")))
	case "add":
		title := strings.TrimSpace(strings.Join(args, " "))
		t, err := s.AddInbox(ctx, title)
		if err != nil {
			fatal(err)
		}
		fmt.Printf("Added to Inbox: %s (%s)\n", t.Title, t.ID)
	case "complete":
		q := strings.TrimSpace(strings.Join(args, " "))
		t, err := s.Complete(ctx, q)
		if err != nil {
			fatal(err)
		}
		fmt.Printf("Completed: %s (%s)\n", t.Title, t.ID)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", cmd)
		usage()
		os.Exit(2)
	}
}

func sessionFromCreds(ctx context.Context) (*deviceclient.Session, error) {
	api, email, password, err := resolveCreds()
	if err != nil {
		return nil, err
	}
	return deviceclient.Login(ctx, api, email, password)
}

func printTodos(ts []*deviceclient.Todo) {
	if len(ts) == 0 {
		fmt.Println("(none)")
		return
	}
	for _, t := range ts {
		fmt.Printf("%s\t%s\n", t.ID, t.Title)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `dayrule — local CLI / MCP for Dayrule (E2E encrypted sync)

Usage:
  dayrule doctor
  dayrule inbox
  dayrule today
  dayrule add <title>
  dayrule complete <id-or-title>
  dayrule mcp

Environment:
  DAYRULE_EMAIL      account email
  DAYRULE_PASSWORD   password (account must not require a second step yet)
  DAYRULE_CREDS      path to a file: email on line 1, password on line 2
                     (preferred — avoids shell escaping)
  DAYRULE_API        origin (default https://dayrule.app)

`)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "dayrule:", err)
	os.Exit(1)
}
