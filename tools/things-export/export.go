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
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
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
	rows, err := db.Query(`
		SELECT uuid, IFNULL(title, ''), IFNULL("index", 0), IFNULL(leavesTombstone, 0)
		FROM TMArea
		ORDER BY "index", title
	`)
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
	rows, err := db.Query(`
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
			reminderTime,
			CASE WHEN rt1_recurrenceRule IS NOT NULL THEN 1 ELSE 0 END,
			rt1_nextInstanceStartDate,
			CASE WHEN rt1_afterCompletionReferenceDate IS NOT NULL THEN 1 ELSE 0 END
		FROM TMTask
		WHERE IFNULL(leavesTombstone, 0) = 0
		ORDER BY "index", title
	`)
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
			isRepeat, afterCompletion          int
			nextInstance                       sql.NullInt64
		)
		if err := rows.Scan(
			&id, &typ, &status, &trashed, &title, &notes, &start,
			&startDate, &deadline, &index, &todayIndex,
			&area, &project, &heading,
			&created, &modified, &stopDate, &reminderTime,
			&isRepeat, &nextInstance, &afterCompletion,
		); err != nil {
			return nil, nil, nil, err
		}

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
				RepeatTemplate:  isRepeat != 0,
				AfterCompletion: afterCompletion != 0,
				CreatedAt:       createdAt,
				UpdatedAt:       updatedAt,
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
	rows, err := db.Query(`
		SELECT
			uuid,
			IFNULL(task, ''),
			IFNULL(title, ''),
			IFNULL(status, 0),
			IFNULL("index", 0),
			IFNULL(creationDate, 0),
			IFNULL(userModificationDate, 0)
		FROM TMChecklistItem
		WHERE IFNULL(leavesTombstone, 0) = 0
		ORDER BY "index", title
	`)
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
	pattern := filepath.Join(
		home,
		"Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac",
		"ThingsData-*",
		"Things Database.thingsdatabase",
		"main.sqlite",
	)
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no Things database found under %s (pass -db PATH)", pattern)
	}
	// Prefer the lexicographically last ThingsData-* folder.
	return matches[len(matches)-1], nil
}
