package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jonhadfield/dayrule/server/internal/deviceclient"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func runMCP(ctx context.Context) error {
	s, err := sessionFromCreds(ctx)
	if err != nil {
		return err
	}
	defer s.Close()

	server := mcp.NewServer(&mcp.Implementation{Name: "dayrule", Version: "0.1.0"}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_inbox",
		Description: "List open to-dos in the Dayrule Inbox",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listOut, error) {
		v, err := s.PullVault(ctx)
		if err != nil {
			return nil, listOut{}, err
		}
		return nil, toListOut(v.Inbox()), nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_today",
		Description: "List open to-dos on Dayrule Today (due today or earlier)",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, listOut, error) {
		v, err := s.PullVault(ctx)
		if err != nil {
			return nil, listOut{}, err
		}
		return nil, toListOut(v.Today(time.Now().Format("2006-01-02"))), nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "add_todo",
		Description: "Create an open to-do in the Dayrule Inbox",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in addIn) (*mcp.CallToolResult, addOut, error) {
		t, err := s.AddInbox(ctx, in.Title)
		if err != nil {
			return nil, addOut{}, err
		}
		return nil, addOut{ID: t.ID, Title: t.Title, List: "Inbox"}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "complete_todo",
		Description: "Mark an open Dayrule to-do complete by id or exact title",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in completeIn) (*mcp.CallToolResult, addOut, error) {
		q := todoQuery(in.ID, in.Title)
		if q == "" {
			return nil, addOut{}, fmt.Errorf("id or title is required")
		}
		t, err := s.Complete(ctx, q)
		if err != nil {
			return nil, addOut{}, err
		}
		return nil, addOut{ID: t.ID, Title: t.Title, List: "Done"}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "schedule_todo",
		Description: "Schedule an open Dayrule to-do onto Today by id or exact title",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in completeIn) (*mcp.CallToolResult, addOut, error) {
		q := todoQuery(in.ID, in.Title)
		if q == "" {
			return nil, addOut{}, fmt.Errorf("id or title is required")
		}
		t, err := s.ScheduleToday(ctx, q)
		if err != nil {
			return nil, addOut{}, err
		}
		return nil, addOut{ID: t.ID, Title: t.Title, List: "Today"}, nil
	})

	return server.Run(ctx, &mcp.StdioTransport{})
}

func todoQuery(id, title string) string {
	q := strings.TrimSpace(id)
	if q == "" {
		q = strings.TrimSpace(title)
	}
	return q
}

type listOut struct {
	Todos []todoRow `json:"todos" jsonschema:"open to-dos"`
}

type todoRow struct {
	ID    string `json:"id" jsonschema:"to-do id"`
	Title string `json:"title" jsonschema:"title"`
}

type addIn struct {
	Title string `json:"title" jsonschema:"title of the new to-do"`
}

type completeIn struct {
	ID    string `json:"id,omitempty" jsonschema:"to-do id if known"`
	Title string `json:"title,omitempty" jsonschema:"exact title if id is unknown"`
}

type addOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	List  string `json:"list"`
}

func toListOut(ts []*deviceclient.Todo) listOut {
	out := listOut{Todos: make([]todoRow, 0, len(ts))}
	for _, t := range ts {
		out.Todos = append(out.Todos, todoRow{ID: t.ID, Title: t.Title})
	}
	return out
}
