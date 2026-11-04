package deviceclient

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Todo is the decrypted subset the CLI/MCP needs.
type Todo struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Notes     string `json:"notes,omitempty"`
	Status    string `json:"status"`
	Start     string `json:"start"`
	StartDate string `json:"startDate,omitempty"`
	Deadline  string `json:"deadline,omitempty"`
	Order     string `json:"order"`
	Seq       int64  `json:"-"`
	EntityKey string `json:"-"`
	Raw       json.RawMessage `json:"-"`
}

// Vault is a decrypted snapshot of sync records (to-dos only for now).
type Vault struct {
	Todos map[string]*Todo // local id → todo
	Seq   map[string]int64 // entity key → last seen server seq
}

// PullVault downloads every record, decrypts, and keeps open to-dos.
func (s *Session) PullVault(ctx context.Context) (*Vault, error) {
	v := &Vault{Todos: map[string]*Todo{}, Seq: map[string]int64{}}
	since := int64(0)
	for {
		var page struct {
			Records []struct {
				ID         string `json:"id"`
				Seq        int64  `json:"seq"`
				Alg        int    `json:"alg"`
				KeyID      int    `json:"keyId"`
				Nonce      string `json:"nonce"`
				Ciphertext string `json:"ciphertext"`
				Tombstone  bool   `json:"tombstone"`
			} `json:"records"`
			Cursor  int64 `json:"cursor"`
			HasMore bool  `json:"hasMore"`
		}
		if err := s.getJSON(ctx, queryPull(since, since == 0), &page); err != nil {
			return nil, fmt.Errorf("pull: %w", err)
		}
		for _, r := range page.Records {
			if r.Tombstone || r.Alg != alg {
				continue
			}
			key, raw, err := s.openRecord(r.ID, r.Nonce, r.Ciphertext)
			if err != nil {
				return nil, fmt.Errorf("decrypt %s: %w", r.ID, err)
			}
			if key == "" {
				continue
			}
			v.Seq[key] = r.Seq
			if raw == nil {
				if id, ok := strings.CutPrefix(key, "todos/"); ok {
					delete(v.Todos, id)
				}
				continue
			}
			if !strings.HasPrefix(key, "todos/") {
				continue
			}
			var t struct {
				ID        string `json:"id"`
				Type      string `json:"type"`
				Title     string `json:"title"`
				Notes     string `json:"notes"`
				Status    string `json:"status"`
				Start     string `json:"start"`
				StartDate string `json:"startDate"`
				Deadline  string `json:"deadline"`
				Order     string `json:"order"`
				DeletedAt string `json:"deletedAt"`
				TrashedAt string `json:"trashedAt"`
			}
			if err := json.Unmarshal(raw, &t); err != nil {
				return nil, err
			}
			if t.Type != "todo" || t.DeletedAt != "" || t.TrashedAt != "" {
				delete(v.Todos, t.ID)
				continue
			}
			v.Todos[t.ID] = &Todo{
				ID: t.ID, Title: t.Title, Notes: t.Notes, Status: t.Status,
				Start: t.Start, StartDate: t.StartDate, Deadline: t.Deadline,
				Order: t.Order, Seq: r.Seq, EntityKey: key, Raw: raw,
			}
		}
		if !page.HasMore {
			break
		}
		since = page.Cursor
	}
	return v, nil
}

// Inbox returns open inbox to-dos (PLAN vocabulary).
func (v *Vault) Inbox() []*Todo {
	var out []*Todo
	for _, t := range v.Todos {
		if t.Status == "open" && t.Start == "inbox" {
			out = append(out, t)
		}
	}
	sortTodos(out)
	return out
}

// Today returns open to-dos due today or earlier (startDate/deadline), excluding Not now.
func (v *Vault) Today(today string) []*Todo {
	if today == "" {
		today = time.Now().Format("2006-01-02")
	}
	var out []*Todo
	for _, t := range v.Todos {
		if t.Status != "open" || t.Start == "later" {
			continue
		}
		due := (t.StartDate != "" && t.StartDate <= today) ||
			(t.Deadline != "" && t.Deadline <= today)
		if due {
			out = append(out, t)
		}
	}
	sortTodos(out)
	return out
}

func sortTodos(ts []*Todo) {
	for i := 0; i < len(ts); i++ {
		for j := i + 1; j < len(ts); j++ {
			if ts[j].Order < ts[i].Order || (ts[j].Order == ts[i].Order && ts[j].ID < ts[i].ID) {
				ts[i], ts[j] = ts[j], ts[i]
			}
		}
	}
}
