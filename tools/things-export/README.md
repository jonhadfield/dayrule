# things-export

Read-only export of a [Things 3](https://culturedcode.com/things/) Mac
database into JSON that Dayrule can import.

The tool never writes to the Things database. Mapping to Dayrule entities and
encryption happen in the browser when you use **Account → Your data → Import
JSON**.

## Usage

```bash
# From tools/things-export (Go 1.27+):
go run . -o things.json

# Or point at a specific Things main.sqlite:
go run . -db "/path/to/main.sqlite" -o things.json
```

`things.json` is gitignored — it holds plaintext to-do titles and notes.
Keep it outside the repo or delete it after importing.

Default discovery looks under:

`~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite`

(and an older `Containers/com.culturedcode.ThingsMac/…/Things.sqlite*` path).

**macOS privacy:** that Group Container is protected. If discovery fails with
“operation not permitted” or “no Things database found”, run the command in
**Terminal.app** (not a sandboxed IDE terminal), or grant the terminal **Full
Disk Access**, or pass `-db` explicitly:

```bash
find ~/Library/Group\ Containers/JLMPQHK86H.com.culturedcode.ThingsMac \
  -name 'main.sqlite' 2>/dev/null
go run . -db "/path/from/find/main.sqlite" -o things.json
```

Then in Dayrule (web): Account → Your data → Import JSON… and choose
`things.json`.

## What is mapped

Areas, projects, headings, to-dos, checklists, tags, When / Deadline, Inbox /
Anytime / Someday, and Logbook (completed / canceled). Repeating templates
decode Things’ `rt1_recurrenceRule` plist into Dayrule day / week / month /
year rules (including weekly weekdays and after-completion). Unsupported
shapes still fall back to a daily template you can edit.

## Schema versions

Supports Things `databaseVersion` **18–30**. Outside that range the tool
fails with a clear message so a Things update cannot silently mis-read data.

## Tests

```bash
cd tools/things-export && go test ./...
```
