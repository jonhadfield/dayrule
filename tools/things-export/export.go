package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Intermediate format for the browser mapper (PLAN §8.3).
const (
	thingsExportFormat  = "dayrule-things-export"
	thingsExportVersion = 1
	minSchemaVersion    = 18
	maxSchemaVersion    = 30
)

type thingsExport struct {
	Format                string            `json:"format"`
	Version               int               `json:"version"`
	ThingsDatabaseVersion int               `json:"thingsDatabaseVersion"`
	ExportedAt            string            `json:"exportedAt"`
	Areas                 []thingsArea      `json:"areas"`
	Tags                  []thingsTag       `json:"tags"`
	Projects              []thingsProject   `json:"projects"`
	Headings              []thingsHeading   `json:"headings"`
	Todos                 []thingsTodo      `json:"todos"`
	ChecklistItems        []thingsChecklist `json:"checklistItems"`
}

type thingsArea struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Order   int      `json:"order"`
	Trashed bool     `json:"trashed,omitempty"`
	TagIDs  []string `json:"tagIds,omitempty"`
}

type thingsTag struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	ParentID *string `json:"parentId,omitempty"`
	Order    int     `json:"order"`
}

type thingsProject struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Notes       string   `json:"notes"`
	AreaID      *string  `json:"areaId,omitempty"`
	Status      string   `json:"status"`
	Start       string   `json:"start"` // ready | later
	StartDate   *string  `json:"startDate,omitempty"`
	Deadline    *string  `json:"deadline,omitempty"`
	Order       int      `json:"order"`
	TodayOrder  *int     `json:"todayOrder,omitempty"`
	CompletedAt *string  `json:"completedAt,omitempty"`
	TrashedAt   *string  `json:"trashedAt,omitempty"`
	TagIDs      []string `json:"tagIds,omitempty"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type thingsHeading struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Title     string `json:"title"`
	Order     int    `json:"order"`
	Archived  bool   `json:"archived,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type thingsTodo struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Notes           string   `json:"notes"`
	ProjectID       *string  `json:"projectId,omitempty"`
	HeadingID       *string  `json:"headingId,omitempty"`
	AreaID          *string  `json:"areaId,omitempty"`
	Status          string   `json:"status"`
	Start           string   `json:"start"` // inbox | ready | later
	StartDate       *string  `json:"startDate,omitempty"`
	Deadline        *string  `json:"deadline,omitempty"`
	Order           int      `json:"order"`
	TodayOrder      *int     `json:"todayOrder,omitempty"`
	CompletedAt     *string  `json:"completedAt,omitempty"`
	TrashedAt       *string  `json:"trashedAt,omitempty"`
	ReminderAt      *string  `json:"reminderAt,omitempty"`
	TagIDs          []string `json:"tagIds,omitempty"`
	RepeatTemplate  bool     `json:"repeatTemplate,omitempty"`
	RepeatNext      *string  `json:"repeatNext,omitempty"`
	AfterCompletion bool     `json:"afterCompletion,omitempty"`
	// Decoded from rt1_recurrenceRule when the blob is a known Things plist.
	RepeatFreq     string `json:"repeatFreq,omitempty"`     // day|week|month|year
	RepeatEvery    int    `json:"repeatEvery,omitempty"`    // every N units (≥1)
	RepeatWeekdays []int  `json:"repeatWeekdays,omitempty"` // Dayrule Mon=0…Sun=6
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

type thingsChecklist struct {
	ID        string `json:"id"`
	TodoID    string `json:"todoId"`
	Title     string `json:"title"`
	Done      bool   `json:"done"`
	Order     int    `json:"order"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func openThingsDB(path string) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// Read-only URI; never write to the Things database (PLAN §8.3).
	dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=query_only(1)", filepath.ToSlash(abs))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open Things database: %w", err)
	}
	return db, nil
}

func readSchemaVersion(db *sql.DB) (int, error) {
	var raw string
	err := db.QueryRow(`SELECT value FROM Meta WHERE key = 'databaseVersion'`).Scan(&raw)
	if err != nil {
		return 0, fmt.Errorf("read databaseVersion: %w (is this a Things 3 database?)", err)
	}
	raw = strings.TrimSpace(raw)
	if n, err := strconv.Atoi(raw); err == nil {
		return n, nil
	}
	// things.py: value is often a plist-encoded integer.
	if i := strings.Index(raw, "<integer>"); i >= 0 {
		rest := raw[i+len("<integer>"):]
		if j := strings.Index(rest, "</integer>"); j >= 0 {
			if n, err := strconv.Atoi(strings.TrimSpace(rest[:j])); err == nil {
				return n, nil
			}
		}
	}
	return 0, fmt.Errorf("unrecognised databaseVersion %q", raw)
}

func exportThings(db *sql.DB, now time.Time) (*thingsExport, error) {
	ver, err := readSchemaVersion(db)
	if err != nil {
		return nil, err
	}
	if ver < minSchemaVersion || ver > maxSchemaVersion {
		return nil, fmt.Errorf(
			"Things database schema version %d is outside the supported range %d–%d; update things-export or Things",
			ver, minSchemaVersion, maxSchemaVersion,
		)
	}

	taskTags, err := loadTaskTags(db)
	if err != nil {
		return nil, err
	}
	areaTags, err := loadAreaTags(db)
	if err != nil {
		return nil, err
	}

	out := &thingsExport{
		Format:                thingsExportFormat,
		Version:               thingsExportVersion,
		ThingsDatabaseVersion: ver,
		ExportedAt:            now.UTC().Format(time.RFC3339Nano),
	}

	if out.Tags, err = loadTags(db); err != nil {
		return nil, err
	}
	if out.Areas, err = loadAreas(db, areaTags); err != nil {
		return nil, err
	}

	projects, headings, todos, err := loadTasks(db, taskTags)
	if err != nil {
		return nil, err
	}
	out.Projects = projects
	out.Headings = headings
	out.Todos = todos

	if out.ChecklistItems, err = loadChecklist(db); err != nil {
		return nil, err
	}
	return out, nil
}

func loadTags(db *sql.DB) ([]thingsTag, error) {
	rows, err := db.Query(`
		SELECT uuid, IFNULL(title, ''), IFNULL("index", 0), parent
		FROM TMTag
		ORDER BY "index", title
	`)
	if err != nil {
		return nil, fmt.Errorf("TMTag: %w", err)
	}
	defer rows.Close()
	var out []thingsTag
	for rows.Next() {
		var t thingsTag
		var parent sql.NullString
		if err := rows.Scan(&t.ID, &t.Title, &t.Order, &parent); err != nil {
			return nil, err
		}
		if parent.Valid && parent.String != "" {
			t.ParentID = &parent.String
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func loadAreas(db *sql.DB, areaTags map[string][]string) ([]thingsArea, error) {
	cols, err := tableColumns(db, "TMArea")
	if err != nil {
		return nil, fmt.Errorf("TMArea: %w", err)
	}
	tombExpr := "0"
	if cols["leavestombstone"] {
		tombExpr = `IFNULL(leavesTombstone, 0)`
	}
	rows, err := db.Query(fmt.Sprintf(`
		SELECT uuid, IFNULL(title, ''), IFNULL("index", 0), %s
		FROM TMArea
		ORDER BY "index", title
	`, tombExpr))
	if err != nil {
		return nil, fmt.Errorf("TMArea: %w", err)
	}
	defer rows.Close()
	var out []thingsArea
	for rows.Next() {
		var a thingsArea
		var tomb int
		if err := rows.Scan(&a.ID, &a.Title, &a.Order, &tomb); err != nil {
			return nil, err
		}
		a.Trashed = tomb != 0
		a.TagIDs = areaTags[a.ID]
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadTaskTags(db *sql.DB) (map[string][]string, error) {
	rows, err := db.Query(`SELECT tasks, tags FROM TMTaskTag`)
	if err != nil {
		// Older empties may lack the table; treat as no tags.
		if isMissingTable(err) {
			return map[string][]string{}, nil
		}
		return nil, fmt.Errorf("TMTaskTag: %w", err)
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var task, tag string
		if err := rows.Scan(&task, &tag); err != nil {
			return nil, err
		}
		out[task] = append(out[task], tag)
	}
	return out, rows.Err()
}

func loadAreaTags(db *sql.DB) (map[string][]string, error) {
	rows, err := db.Query(`SELECT areas, tags FROM TMAreaTag`)
	if err != nil {
		if isMissingTable(err) {
			return map[string][]string{}, nil
		}
		return nil, fmt.Errorf("TMAreaTag: %w", err)
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var area, tag string
		if err := rows.Scan(&area, &tag); err != nil {
			return nil, err
		}
		out[area] = append(out[area], tag)
	}
	return out, rows.Err()
}

func loadTasks(db *sql.DB, taskTags map[string][]string) ([]thingsProject, []thingsHeading, []thingsTodo, error) {
	cols, err := tableColumns(db, "TMTask")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("TMTask: %w", err)
	}
	where := "1=1"
	if cols["leavestombstone"] {
		where = `IFNULL(leavesTombstone, 0) = 0`
	}
	ruleExpr := "NULL"
	nextExpr := "NULL"
	afterExpr := "0"
	if cols["rt1_recurrencerule"] {
		ruleExpr = `rt1_recurrenceRule`
	}
	if cols["rt1_nextinstancestartdate"] {
		nextExpr = `rt1_nextInstanceStartDate`
	}
	if cols["rt1_aftercompletionreferencedate"] {
		afterExpr = `CASE WHEN rt1_afterCompletionReferenceDate IS NOT NULL THEN 1 ELSE 0 END`
	}
	reminderExpr := "NULL"
	if cols["remindertime"] {
		reminderExpr = `reminderTime`
	}
	rows, err := db.Query(fmt.Sprintf(`
		SELECT
			uuid,
			IFNULL(type, 0),
			IFNULL(status, 0),
			IFNULL(trashed, 0),
			IFNULL(title, ''),
			IFNULL(notes, ''),
			IFNULL(start, 0),
			startDate,
			deadline,
			IFNULL("index", 0),
			todayIndex,
			area,
			project,
			heading,
			IFNULL(creationDate, 0),
			IFNULL(userModificationDate, 0),
			stopDate,
			%s,
			%s,
			%s,
			%s
		FROM TMTask
		WHERE %s
		ORDER BY "index", title
	`, reminderExpr, ruleExpr, nextExpr, afterExpr, where))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("TMTask: %w", err)
	}
	defer rows.Close()

	var projects []thingsProject
	var headings []thingsHeading
	var todos []thingsTodo

	for rows.Next() {
		var (
			id, title, notes                   string
			typ, status, trashed, start, index int
			startDate, deadline, todayIndex    sql.NullInt64
			area, project, heading             sql.NullString
			created, modified                  float64
			stopDate, reminderTime             sql.NullFloat64
			ruleBlob                           []byte
			afterCompletion                    int
			nextInstance                       sql.NullInt64
		)
		if err := rows.Scan(
			&id, &typ, &status, &trashed, &title, &notes, &start,
			&startDate, &deadline, &index, &todayIndex,
			&area, &project, &heading,
			&created, &modified, &stopDate, &reminderTime,
			&ruleBlob, &nextInstance, &afterCompletion,
		); err != nil {
			return nil, nil, nil, err
		}
		isRepeat := len(ruleBlob) > 0

		createdAt := unixToRFC3339(created)
		updatedAt := unixToRFC3339(modified)
		tags := taskTags[id]

		switch typ {
		case 1: // project
			p := thingsProject{
				ID:        id,
				Title:     title,
				Notes:     notes,
				Status:    mapStatus(status),
				Start:     mapProjectStart(start),
				Order:     index,
				TagIDs:    tags,
				CreatedAt: createdAt,
				UpdatedAt: updatedAt,
			}
			if area.Valid && area.String != "" {
				p.AreaID = &area.String
			}
			if d, ok := nullThingsDate(startDate); ok {
				p.StartDate = &d
			}
			if d, ok := nullThingsDate(deadline); ok {
				p.Deadline = &d
			}
			if todayIndex.Valid {
				v := int(todayIndex.Int64)
				p.TodayOrder = &v
			}
			if trashed != 0 {
				t := updatedAt
				p.TrashedAt = &t
			}
			if status == 3 || status == 2 {
				if stopDate.Valid {
					t := unixToRFC3339(stopDate.Float64)
					p.CompletedAt = &t
				} else {
					p.CompletedAt = &updatedAt
				}
			}
			projects = append(projects, p)

		case 2: // heading
			if !project.Valid || project.String == "" {
				continue
			}
			h := thingsHeading{
				ID:        id,
				ProjectID: project.String,
				Title:     title,
				Order:     index,
				Archived:  status == 3 || status == 2,
				CreatedAt: createdAt,
				UpdatedAt: updatedAt,
			}
			headings = append(headings, h)

		default: // to-do
			t := thingsTodo{
				ID:              id,
				Title:           title,
				Notes:           notes,
				Status:          mapStatus(status),
				Start:           mapTodoStart(start),
				Order:           index,
				TagIDs:          tags,
				RepeatTemplate:  isRepeat,
				AfterCompletion: afterCompletion != 0,
				CreatedAt:       createdAt,
				UpdatedAt:       updatedAt,
			}
			if decoded, ok := parseRecurrenceRule(ruleBlob); ok {
				t.RepeatFreq = decoded.Freq
				t.RepeatEvery = decoded.Every
				t.RepeatWeekdays = decoded.Weekdays
				if decoded.After {
					t.AfterCompletion = true
				}
			}
			if project.Valid && project.String != "" {
				t.ProjectID = &project.String
			}
			if heading.Valid && heading.String != "" {
				t.HeadingID = &heading.String
			}
			if area.Valid && area.String != "" && t.ProjectID == nil {
				t.AreaID = &area.String
			}
			if d, ok := nullThingsDate(startDate); ok {
				t.StartDate = &d
			}
			if d, ok := nullThingsDate(deadline); ok {
				t.Deadline = &d
			}
			if d, ok := nullThingsDate(nextInstance); ok {
				t.RepeatNext = &d
			}
			if todayIndex.Valid {
				v := int(todayIndex.Int64)
				t.TodayOrder = &v
			}
			if trashed != 0 {
				tr := updatedAt
				t.TrashedAt = &tr
			}
			if status == 3 || status == 2 {
				if stopDate.Valid {
					c := unixToRFC3339(stopDate.Float64)
					t.CompletedAt = &c
				} else {
					t.CompletedAt = &updatedAt
				}
			}
			if reminderTime.Valid {
				if hhmm, ok := thingsTimeToHHMM(int64(reminderTime.Float64)); ok {
					day := ""
					if t.StartDate != nil {
						day = *t.StartDate
					} else if t.RepeatNext != nil {
						day = *t.RepeatNext
					} else {
						day = time.Now().Format("2006-01-02")
					}
					r := day + "T" + hhmm
					t.ReminderAt = &r
				}
			}
			todos = append(todos, t)
		}
	}
	return projects, headings, todos, rows.Err()
}

func loadChecklist(db *sql.DB) ([]thingsChecklist, error) {
	cols, err := tableColumns(db, "TMChecklistItem")
	if err != nil {
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("TMChecklistItem: %w", err)
	}
	where := "1=1"
	if cols["leavestombstone"] {
		where = `IFNULL(leavesTombstone, 0) = 0`
	}
	rows, err := db.Query(fmt.Sprintf(`
		SELECT
			uuid,
			IFNULL(task, ''),
			IFNULL(title, ''),
			IFNULL(status, 0),
			IFNULL("index", 0),
			IFNULL(creationDate, 0),
			IFNULL(userModificationDate, 0)
		FROM TMChecklistItem
		WHERE %s
		ORDER BY "index", title
	`, where))
	if err != nil {
		if isMissingTable(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("TMChecklistItem: %w", err)
	}
	defer rows.Close()
	var out []thingsChecklist
	for rows.Next() {
		var c thingsChecklist
		var status int
		var created, modified float64
		if err := rows.Scan(&c.ID, &c.TodoID, &c.Title, &status, &c.Order, &created, &modified); err != nil {
			return nil, err
		}
		if c.TodoID == "" {
			continue
		}
		c.Done = status != 0
		c.CreatedAt = unixToRFC3339(created)
		c.UpdatedAt = unixToRFC3339(modified)
		out = append(out, c)
	}
	return out, rows.Err()
}

func mapStatus(status int) string {
	switch status {
	case 3:
		return "completed"
	case 2:
		return "canceled"
	default:
		return "open"
	}
}

func mapTodoStart(start int) string {
	switch start {
	case 0:
		return "inbox"
	case 2:
		return "later"
	default:
		return "ready"
	}
}

func mapProjectStart(start int) string {
	if start == 2 {
		return "later"
	}
	return "ready"
}

func nullThingsDate(v sql.NullInt64) (string, bool) {
	if !v.Valid {
		return "", false
	}
	return thingsDateToISO(v.Int64)
}

func isMissingTable(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no such table")
}

// tableColumns returns lowercased column names for table (empty map if missing).
func tableColumns(db *sql.DB, table string) (map[string]bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + quoteIdent(table) + `)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		out[strings.ToLower(name)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no such table: %s", table)
	}
	return out, nil
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func writeExport(path string, doc *thingsExport) error {
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if path == "-" {
		_, err = os.Stdout.Write(data)
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func defaultThingsDBPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	group := filepath.Join(
		home, "Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac",
	)
	patterns := []string{
		// Things 3.17.4+ (things.py DEFAULT_FILEPATH_31704015).
		filepath.Join(group, "ThingsData-*", "Things Database.thingsdatabase", "main.sqlite"),
		// Things 3.15–3.17.3 (no ThingsData-* wrapper).
		filepath.Join(group, "Things Database.thingsdatabase", "main.sqlite"),
		// Alternate package spelling inside ThingsData-*.
		filepath.Join(group, "ThingsData-*", "Things Database.thingsdatabase", "ThingsDatabase.sqlite*"),
		// Older sandboxed layout.
		filepath.Join(
			home,
			"Library/Containers/com.culturedcode.ThingsMac/Data/Library/Application Support/Cultured Code",
			"Things*",
			"Things.sqlite*",
		),
	}

	var found []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return "", err
		}
		found = append(found, matches...)
	}
	if len(found) > 0 {
		// Prefer the lexicographically last path (newest ThingsData-* etc.).
		return found[len(found)-1], nil
	}

	groupDir := filepath.Join(home, "Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac")
	if _, err := os.Stat(groupDir); err != nil {
		if os.IsPermission(err) || strings.Contains(err.Error(), "operation not permitted") {
			return "", fmt.Errorf(
				"macOS blocked reading %s (Full Disk Access). Run this in Terminal.app, or grant FDA to your terminal, or pass -db PATH to main.sqlite",
				groupDir,
			)
		}
	} else if entries, err := os.ReadDir(groupDir); err != nil {
		if os.IsPermission(err) || strings.Contains(err.Error(), "operation not permitted") {
			return "", fmt.Errorf(
				"macOS blocked reading %s (Full Disk Access). Run this in Terminal.app, or grant FDA to your terminal, or pass -db PATH to main.sqlite",
				groupDir,
			)
		}
	} else if len(entries) == 0 {
		return "", fmt.Errorf(
			"Things group container is empty at %s — open Things once so it creates ThingsData-*, or pass -db PATH",
			groupDir,
		)
	}

	return "", fmt.Errorf(
		"no Things database found (tried group-container and Containers paths). Find it with:\n  find ~/Library/Group\\ Containers/JLMPQHK86H.com.culturedcode.ThingsMac -name 'main.sqlite' 2>/dev/null\nthen: go run . -db \"/path/to/main.sqlite\" -o things.json",
	)
}
