package main

import "testing"

func TestThingsDateToISO(t *testing.T) {
	// pack_things_date(2020, 1, 1) = (2020<<16)|(1<<12)|(1<<7) = 132386944
	got, ok := thingsDateToISO(132386944)
	if !ok || got != "2020-01-01" {
		t.Fatalf("got %q ok=%v", got, ok)
	}
	if _, ok := thingsDateToISO(0); ok {
		t.Fatal("expected false for 0")
	}
}

func TestThingsTimeToHHMM(t *testing.T) {
	// 09:30 → (9<<26)|(30<<20)
	packed := int64((9 << 26) | (30 << 20))
	got, ok := thingsTimeToHHMM(packed)
	if !ok || got != "09:30" {
		t.Fatalf("got %q ok=%v", got, ok)
	}
}
