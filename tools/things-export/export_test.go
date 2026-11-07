package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestExportMinimalFixture(t *testing.T) {
	path := filepath.Join(t.TempDir(), "main.sqlite")
	mustCreateFixture(t, path)

	db, err := openThingsDB(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	doc, err := exportThings(db, time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if doc.Format != thingsExportFormat || doc.Version != thingsExportVersion {
		t.Fatalf("format/version: %+v", doc)
	}
	if doc.ThingsDatabaseVersion != 21 {
		t.Fatalf("schema %d", doc.ThingsDatabaseVersion)
	}
	if len(doc.Areas) != 1 || doc.Areas[0].Title != "Personal" {
		t.Fatalf("areas: %+v", doc.Areas)
	}
	if len(doc.Tags) != 1 || doc.Tags[0].Title != "Errand" {
		t.Fatalf("tags: %+v", doc.Tags)
	}
	if len(doc.Projects) != 1 || doc.Projects[0].Title != "Kitchen" {
		t.Fatalf("projects: %+v", doc.Projects)
	}
	if len(doc.Headings) != 1 || doc.Headings[0].Title != "Morning" {
		t.Fatalf("headings: %+v", doc.Headings)
	}
	if len(doc.Todos) != 4 {
		t.Fatalf("todos: %d %+v", len(doc.Todos), doc.Todos)
	}
	byID := map[string]thingsTodo{}
	for _, td := range doc.Todos {
		byID[td.ID] = td
	}
	inbox := byID["todo-inbox"]
	if inbox.Start != "inbox" || inbox.Status != "open" {
		t.Fatalf("inbox: %+v", inbox)
	}
	sched := byID["todo-sched"]
	if sched.StartDate == nil || *sched.StartDate != "2020-01-01" {
		t.Fatalf("scheduled: %+v", sched)
	}
	done := byID["todo-done"]
	if done.Status != "completed" || done.CompletedAt == nil {
		t.Fatalf("logbook: %+v", done)
	}
	someday := byID["todo-later"]
	if someday.Start != "later" {
		t.Fatalf("someday: %+v", someday)
	}
	if len(doc.ChecklistItems) != 1 || !doc.ChecklistItems[0].Done {
		t.Fatalf("checklist: %+v", doc.ChecklistItems)
	}
}

func TestRejectUnsupportedSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "main.sqlite")
	db := mustOpenRW(t, path)
	mustExec(t, db, `CREATE TABLE Meta (key TEXT PRIMARY KEY, value TEXT)`)
	mustExec(t, db, `INSERT INTO Meta(key, value) VALUES ('databaseVersion', '3')`)
	_ = db.Close()

	ro, err := openThingsDB(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ro.Close() })
	if _, err := exportThings(ro, time.Now()); err == nil {
		t.Fatal("expected schema error")
	}
}

func mustCreateFixture(t *testing.T, path string) {
	t.Helper()
	db := mustOpenRW(t, path)
	defer db.Close()

	mustExec(t, db, `
		CREATE TABLE Meta (key TEXT PRIMARY KEY, value TEXT);
		CREATE TABLE TMArea (
			uuid TEXT PRIMARY KEY,
			title TEXT,
			"index" INTEGER,
			leavesTombstone INTEGER
		);
		CREATE TABLE TMTag (
			uuid TEXT PRIMARY KEY,
			title TEXT,
			"index" INTEGER,
			parent TEXT
		);
		CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
		CREATE TABLE TMAreaTag (areas TEXT, tags TEXT);
		CREATE TABLE TMChecklistItem (
			uuid TEXT PRIMARY KEY,
			task TEXT,
			title TEXT,
			status INTEGER,
			"index" INTEGER,
			creationDate REAL,
			userModificationDate REAL,
			leavesTombstone INTEGER
		);
		CREATE TABLE TMTask (
			uuid TEXT PRIMARY KEY,
			leavesTombstone INTEGER,
			creationDate REAL,
			userModificationDate REAL,
			type INTEGER,
			status INTEGER,
			stopDate REAL,
			trashed INTEGER,
			title TEXT,
			notes TEXT,
			start INTEGER,
			startDate INTEGER,
			deadline INTEGER,
			"index" INTEGER,
			todayIndex INTEGER,
			area TEXT,
			project TEXT,
			heading TEXT,
			reminderTime INTEGER,
			rt1_recurrenceRule BLOB,
			rt1_nextInstanceStartDate INTEGER,
			rt1_afterCompletionReferenceDate INTEGER
		);
	`)
	mustExec(t, db, `INSERT INTO Meta(key, value) VALUES ('databaseVersion', '21')`)
	mustExec(t, db, `INSERT INTO TMArea(uuid, title, "index", leavesTombstone) VALUES ('area-1', 'Personal', 0, 0)`)
	mustExec(t, db, `INSERT INTO TMTag(uuid, title, "index", parent) VALUES ('tag-1', 'Errand', 0, NULL)`)
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, trashed, title, notes, start, "index", area
		) VALUES (
			'proj-1', 0, 1715000000, 1715000100,
			1, 0, 0, 'Kitchen', '', 1, 0, 'area-1'
		)
	`)
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, trashed, title, notes, start, "index", project
		) VALUES (
			'head-1', 0, 1715000000, 1715000100,
			2, 0, 0, 'Morning', '', 1, 0, 'proj-1'
		)
	`)
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, trashed, title, notes, start, "index"
		) VALUES (
			'todo-inbox', 0, 1715000000, 1715000100,
			0, 0, 0, 'Buy milk', '', 0, 0
		)
	`)
	// startDate = pack(2020,1,1) = 132386944
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, trashed, title, notes, start, startDate, "index",
			project, heading
		) VALUES (
			'todo-sched', 0, 1715000000, 1715000100,
			0, 0, 0, 'Scheduled chore', '', 1, 132386944, 1,
			'proj-1', 'head-1'
		)
	`)
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, stopDate, trashed, title, notes, start, "index"
		) VALUES (
			'todo-done', 0, 1713000000, 1714000000,
			0, 3, 1714000000, 0, 'Old completed', '', 1, 2
		)
	`)
	mustExec(t, db, `
		INSERT INTO TMTask(
			uuid, leavesTombstone, creationDate, userModificationDate,
			type, status, trashed, title, notes, start, "index", area
		) VALUES (
			'todo-later', 0, 1715000000, 1715000100,
			0, 0, 0, 'Someday read', '', 2, 3, 'area-1'
		)
	`)
	mustExec(t, db, `INSERT INTO TMTaskTag(tasks, tags) VALUES ('todo-inbox', 'tag-1')`)
	mustExec(t, db, `
		INSERT INTO TMChecklistItem(
			uuid, task, title, status, "index", creationDate, userModificationDate, leavesTombstone
		) VALUES (
			'check-1', 'todo-sched', 'Sub-step', 1, 0, 1715000000, 1715000100, 0
		)
	`)
}

func mustOpenRW(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatalf("%v\n%s", err, q)
	}
}
