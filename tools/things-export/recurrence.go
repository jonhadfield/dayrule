package main

import (
	"fmt"
	"sort"

	"howett.net/plist"
)

// Decoded Things rt1_recurrenceRule (XML/binary plist). Fields match the
// Cultured Code wire shape used by things3-cloud / things3-cli: fu/fa/tp/of.
type decodedRepeat struct {
	Freq     string // day | week | month | year
	Every    int
	Weekdays []int // Dayrule: 0 = Monday … 6 = Sunday
	After    bool  // tp == 1 (after completion)
}

// parseRecurrenceRule decodes a Things recurrence blob. Unknown or unsupported
// shapes return ok=false so the caller can fall back to a daily rule.
func parseRecurrenceRule(blob []byte) (decodedRepeat, bool) {
	if len(blob) == 0 {
		return decodedRepeat{}, false
	}
	var raw map[string]any
	if _, err := plist.Unmarshal(blob, &raw); err != nil {
		return decodedRepeat{}, false
	}

	fu, ok := plistInt(raw["fu"])
	if !ok {
		return decodedRepeat{}, false
	}
	freq, ok := frequencyUnit(fu)
	if !ok {
		return decodedRepeat{}, false
	}

	every, ok := plistInt(raw["fa"])
	if !ok || every < 1 {
		every = 1
	}

	tp, _ := plistInt(raw["tp"])
	after := tp == 1

	var weekdays []int
	if freq == "week" {
		weekdays = weekdayOffsets(raw["of"])
	}

	return decodedRepeat{
		Freq:     freq,
		Every:    every,
		Weekdays: weekdays,
		After:    after,
	}, true
}

func frequencyUnit(fu int) (string, bool) {
	switch fu {
	case 16:
		return "day", true
	case 256:
		return "week", true
	case 8:
		return "month", true
	case 4:
		return "year", true
	default:
		return "", false
	}
}

// Things stores Sunday=0 … Saturday=6; Dayrule uses Monday=0 … Sunday=6.
func thingsWeekdayToDayrule(wd int) (int, bool) {
	if wd < 0 || wd > 6 {
		return 0, false
	}
	return (wd + 6) % 7, true
}

func weekdayOffsets(of any) []int {
	arr, ok := of.([]any)
	if !ok {
		return nil
	}
	seen := map[int]struct{}{}
	var out []int
	for _, item := range arr {
		dict, ok := item.(map[string]any)
		if !ok {
			continue
		}
		wd, ok := plistInt(dict["wd"])
		if !ok {
			continue
		}
		dayrule, ok := thingsWeekdayToDayrule(wd)
		if !ok {
			continue
		}
		if _, dup := seen[dayrule]; dup {
			continue
		}
		seen[dayrule] = struct{}{}
		out = append(out, dayrule)
	}
	sort.Ints(out)
	return out
}

func plistInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case uint64:
		return int(n), true
	case float64:
		return int(n), true
	default:
		return 0, false
	}
}

// recurrencePlistForTest builds a Things-shaped XML plist for fixtures.
func recurrencePlistForTest(fu, fa, tp int, thingsWeekdays []int) []byte {
	of := make([]map[string]any, 0, len(thingsWeekdays))
	for _, wd := range thingsWeekdays {
		of = append(of, map[string]any{"wd": wd})
	}
	if len(of) == 0 && fu == 16 {
		of = []map[string]any{{"dy": 0}}
	}
	rule := map[string]any{
		"fa":  fa,
		"fu":  fu,
		"tp":  tp,
		"of":  of,
		"rrv": 4,
		"ts":  0,
	}
	encoded, err := plist.Marshal(rule, plist.XMLFormat)
	if err != nil {
		panic(fmt.Sprintf("encode test recurrence: %v", err))
	}
	return encoded
}
