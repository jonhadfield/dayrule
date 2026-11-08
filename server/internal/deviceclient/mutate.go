package deviceclient

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const hlcDevice = "dayrulecli"

// AddInbox creates an open Inbox to-do and pushes it.
func (s *Session) AddInbox(ctx context.Context, title string) (*Todo, error) {
	title = trimSpace(title)
	if title == "" {
		return nil, fmt.Errorf("title is required")
	}
	now := time.Now().UTC()
	iso := now.Format("2006-01-02T15:04:05.000Z")
	id := uuid.NewString()
	tick := hlcTick(now, 0, hlcDevice)
	fields := []string{"type", "id", "createdAt", "updatedAt", "title", "notes", "status", "start", "tonight", "tagIds", "order"}
	clock := map[string]string{}
	for _, f := range fields {
		clock[f] = tick
	}
	val := map[string]any{
		"type": "todo", "id": id,
		"createdAt": iso, "updatedAt": iso,
		"title": title, "notes": "", "status": "open",
		"start": "inbox", "tonight": false, "tagIds": []any{}, "order": "a0",
		"clock": clock,
	}
	key := "todos/" + id
	seq, err := s.pushNew(ctx, key, val)
	if err != nil {
		return nil, err
	}
	return &Todo{
		ID: id, Title: title, Status: "open", Start: "inbox", Order: "a0",
		Seq: seq, EntityKey: key,
	}, nil
}

// Complete marks a to-do completed: pull, patch status, push with baseSeq.
func (s *Session) Complete(ctx context.Context, idOrTitle string) (*Todo, error) {
	return s.patchOpenTodo(ctx, idOrTitle, func(val map[string]any, now time.Time, tick string) {
		iso := now.Format("2006-01-02T15:04:05.000Z")
		val["status"] = "completed"
		val["completedAt"] = iso
		val["updatedAt"] = iso
		clock := ensureClock(val)
		clock["status"] = tick
		clock["completedAt"] = tick
		clock["updatedAt"] = tick
	}, func(t *Todo) {
		t.Status = "completed"
	})
}

// ScheduleToday puts an open to-do on Today (start=ready, startDate=today).
func (s *Session) ScheduleToday(ctx context.Context, idOrTitle string) (*Todo, error) {
	today := time.Now().Format("2006-01-02")
	return s.patchOpenTodo(ctx, idOrTitle, func(val map[string]any, now time.Time, tick string) {
		iso := now.Format("2006-01-02T15:04:05.000Z")
		val["start"] = "ready"
		val["startDate"] = today
		val["tonight"] = false
		val["updatedAt"] = iso
		clock := ensureClock(val)
		clock["start"] = tick
		clock["startDate"] = tick
		clock["tonight"] = tick
		clock["updatedAt"] = tick
	}, func(t *Todo) {
		t.Start = "ready"
		t.StartDate = today
	})
}

// Cancel marks a to-do canceled (status=canceled), matching the web app.
func (s *Session) Cancel(ctx context.Context, idOrTitle string) (*Todo, error) {
	return s.patchOpenTodo(ctx, idOrTitle, func(val map[string]any, now time.Time, tick string) {
		iso := now.Format("2006-01-02T15:04:05.000Z")
		val["status"] = "canceled"
		val["completedAt"] = iso
		val["updatedAt"] = iso
		clock := ensureClock(val)
		clock["status"] = tick
		clock["completedAt"] = tick
		clock["updatedAt"] = tick
	}, func(t *Todo) {
		t.Status = "canceled"
	})
}

func (s *Session) patchOpenTodo(
	ctx context.Context,
	idOrTitle string,
	apply func(val map[string]any, now time.Time, tick string),
	after func(t *Todo),
) (*Todo, error) {
	v, err := s.PullVault(ctx)
	if err != nil {
		return nil, err
	}
	t := findTodo(v, idOrTitle)
	if t == nil {
		return nil, fmt.Errorf("no open to-do matching %q", idOrTitle)
	}
	var val map[string]any
	if err := jsonUnmarshal(t.Raw, &val); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	tick := hlcTick(now, 0, hlcDevice)
	apply(val, now, tick)

	seq, err := s.pushExisting(ctx, t.EntityKey, t.Seq, val)
	if err != nil {
		return nil, err
	}
	t.Seq = seq
	after(t)
	return t, nil
}

func (s *Session) pushNew(ctx context.Context, key string, val map[string]any) (int64, error) {
	return s.push(ctx, key, 0, val)
}

func (s *Session) pushExisting(ctx context.Context, key string, baseSeq int64, val map[string]any) (int64, error) {
	return s.push(ctx, key, baseSeq, val)
}

func (s *Session) push(ctx context.Context, key string, baseSeq int64, val map[string]any) (int64, error) {
	wireID := syncID(s.syncIDKey, key)
	nonce, ct, err := s.sealPayload(wireID, map[string]any{"k": key, "v": val})
	if err != nil {
		return 0, err
	}
	var pushResp struct {
		Results []struct {
			ID       string `json:"id"`
			Seq      int64  `json:"seq"`
			Conflict bool   `json:"conflict"`
			Error    string `json:"error"`
		} `json:"results"`
	}
	if err := s.postJSON(ctx, "/api/v1/sync/push", map[string]any{
		"records": []map[string]any{{
			"id": wireID, "baseSeq": baseSeq, "alg": alg, "keyId": keyID,
			"nonce": nonce, "ciphertext": ct,
		}},
	}, &pushResp); err != nil {
		return 0, fmt.Errorf("push: %w", err)
	}
	if len(pushResp.Results) == 0 {
		return 0, fmt.Errorf("empty push response")
	}
	r := pushResp.Results[0]
	if r.Error != "" {
		return 0, fmt.Errorf("push: %s", r.Error)
	}
	if r.Conflict {
		if baseSeq == 0 {
			return 0, fmt.Errorf("push conflict on new to-do (retry)")
		}
		return 0, fmt.Errorf("conflict — pull again and retry")
	}
	return r.Seq, nil
}

func ensureClock(val map[string]any) map[string]any {
	clock, _ := val["clock"].(map[string]any)
	if clock == nil {
		clock = map[string]any{}
		val["clock"] = clock
	}
	return clock
}

func findTodo(v *Vault, idOrTitle string) *Todo {
	if t, ok := v.Todos[idOrTitle]; ok && t.Status == "open" {
		return t
	}
	var match *Todo
	for _, t := range v.Todos {
		if t.Status != "open" {
			continue
		}
		if t.Title == idOrTitle {
			if match != nil {
				return nil // ambiguous
			}
			match = t
		}
	}
	return match
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}

func jsonUnmarshal(raw []byte, v any) error {
	if len(raw) == 0 {
		return fmt.Errorf("empty record")
	}
	return json.Unmarshal(raw, v)
}
