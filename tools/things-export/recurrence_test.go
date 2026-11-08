package main

import "testing"

func TestParseRecurrenceWeeklyMonWed(t *testing.T) {
	// Things Sunday=0: Monday=1, Wednesday=3 → Dayrule Mon=0, Wed=2
	blob := recurrencePlistForTest(256, 2, 0, []int{1, 3})
	got, ok := parseRecurrenceRule(blob)
	if !ok {
		t.Fatal("expected decode")
	}
	if got.Freq != "week" || got.Every != 2 || got.After {
		t.Fatalf("got %+v", got)
	}
	if len(got.Weekdays) != 2 || got.Weekdays[0] != 0 || got.Weekdays[1] != 2 {
		t.Fatalf("weekdays = %v, want [0 2]", got.Weekdays)
	}
}

func TestParseRecurrenceDailyAfterCompletion(t *testing.T) {
	blob := recurrencePlistForTest(16, 1, 1, nil)
	got, ok := parseRecurrenceRule(blob)
	if !ok {
		t.Fatal("expected decode")
	}
	if got.Freq != "day" || got.Every != 1 || !got.After {
		t.Fatalf("got %+v", got)
	}
}

func TestParseRecurrenceMonthlyYearly(t *testing.T) {
	month, ok := parseRecurrenceRule(recurrencePlistForTest(8, 3, 0, nil))
	if !ok || month.Freq != "month" || month.Every != 3 {
		t.Fatalf("month = %+v ok=%v", month, ok)
	}
	year, ok := parseRecurrenceRule(recurrencePlistForTest(4, 1, 0, nil))
	if !ok || year.Freq != "year" || year.Every != 1 {
		t.Fatalf("year = %+v ok=%v", year, ok)
	}
}

func TestParseRecurrenceRejectsUnknown(t *testing.T) {
	if _, ok := parseRecurrenceRule(nil); ok {
		t.Fatal("nil should fail")
	}
	if _, ok := parseRecurrenceRule([]byte("not a plist")); ok {
		t.Fatal("garbage should fail")
	}
	if _, ok := parseRecurrenceRule(recurrencePlistForTest(99, 1, 0, nil)); ok {
		t.Fatal("unknown fu should fail")
	}
}
