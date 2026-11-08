package deviceclient

import "testing"

func TestInboxAndTodayFilters(t *testing.T) {
	v := &Vault{Todos: map[string]*Todo{
		"1": {ID: "1", Title: "A", Status: "open", Start: "inbox", Order: "a1"},
		"2": {ID: "2", Title: "B", Status: "open", Start: "ready", StartDate: "2026-11-04", Order: "a0"},
		"3": {ID: "3", Title: "C", Status: "open", Start: "later", StartDate: "2026-11-01", Order: "a0"},
		"4": {ID: "4", Title: "D", Status: "completed", Start: "inbox", Order: "a0"},
		"5": {ID: "5", Title: "E", Status: "open", Start: "ready", StartDate: "2026-11-10", Order: "a2"},
		"6": {ID: "6", Title: "F", Status: "open", Start: "ready", Order: "a3"},
	}}
	inbox := v.Inbox()
	if len(inbox) != 1 || inbox[0].ID != "1" {
		t.Fatalf("inbox = %+v", inbox)
	}
	today := v.Today("2026-11-04")
	if len(today) != 1 || today[0].ID != "2" {
		t.Fatalf("today = %+v", today)
	}
	backlog := v.Backlog("2026-11-04")
	if len(backlog) != 3 || backlog[0].ID != "2" || backlog[1].ID != "3" || backlog[2].ID != "6" {
		t.Fatalf("backlog = %+v", backlog)
	}
	scheduled := v.Scheduled("2026-11-04")
	if len(scheduled) != 1 || scheduled[0].ID != "5" {
		t.Fatalf("scheduled = %+v", scheduled)
	}
}
