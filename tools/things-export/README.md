# things-export

Read-only export of a [Things 3](https://culturedcode.com/things/) Mac
database into JSON that Dayrule can import (PLAN.md §8.3).

The tool never writes to the Things database. Mapping to Dayrule entities and
encryption happen in the browser when you use **Account → Your data → Import
JSON**.

## Usage

```bash
# From tools/things-export (Go 1.26+):
go run . -o things.json

# Or point at a specific Things main.sqlite:
go run . -db "/path/to/main.sqlite" -o things.json
```

Default discovery looks under:

`~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite`

Then in Dayrule (web): Account → Your data → Import JSON… and choose
`things.json`.

## What is mapped

Areas, projects, headings, to-dos, checklists, tags, When / Deadline, Inbox /
Anytime / Someday, and Logbook (completed / canceled). Repeating templates
become a simple daily Dayrule repeat you can edit; Things’ opaque recurrence
blob is not fully decoded.

## Schema versions

Supports Things `databaseVersion` **18–30**. Outside that range the tool
fails with a clear message so a Things update cannot silently mis-read data.

## Tests

```bash
cd tools/things-export && go test ./...
```
