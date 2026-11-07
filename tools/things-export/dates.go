package main

import (
	"fmt"
	"time"
)

// Things packs calendar dates as YYYYYYYYYYYMMMMDDDDD0000000 (things.py).
func thingsDateToISO(packed int64) (string, bool) {
	if packed == 0 {
		return "", false
	}
	y := packed >> 16
	m := (packed & 0xF000) >> 12
	d := (packed & 0xF80) >> 7
	if y < 1 || m < 1 || m > 12 || d < 1 || d > 31 {
		return "", false
	}
	t := time.Date(int(y), time.Month(m), int(d), 0, 0, 0, 0, time.UTC)
	if t.Year() != int(y) || t.Month() != time.Month(m) || t.Day() != int(d) {
		return "", false
	}
	return t.Format("2006-01-02"), true
}

// Things packs reminder times as HHHHHMMMMMM… (things.py).
func thingsTimeToHHMM(packed int64) (string, bool) {
	if packed == 0 {
		return "", false
	}
	h := (packed & 0x7C000000) >> 26
	m := (packed & 0x3F00000) >> 20
	if h > 23 || m > 59 {
		return "", false
	}
	return fmt.Sprintf("%02d:%02d", h, m), true
}

func unixToRFC3339(sec float64) string {
	if sec <= 0 {
		return time.Unix(0, 0).UTC().Format(time.RFC3339Nano)
	}
	return time.Unix(int64(sec), int64((sec-float64(int64(sec)))*1e9)).UTC().Format(time.RFC3339Nano)
}
