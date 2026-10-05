// Package migrations embeds the goose SQL migrations.
//
// Migrations must stay backwards-compatible (expand → migrate → contract),
// because the previous deployment keeps serving during a rollout
// (PLAN.md §14.2).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
