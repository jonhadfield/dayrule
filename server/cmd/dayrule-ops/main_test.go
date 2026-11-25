package main

import "testing"

func TestFlagEmail(t *testing.T) {
	got, err := flagEmail([]string{"--email=Alice@Example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "alice@example.com" {
		t.Fatalf("got %q", got)
	}
	if _, err := flagEmail(nil); err == nil {
		t.Fatal("expected error")
	}
	if _, err := flagEmail([]string{"--email="}); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunUsage(t *testing.T) {
	if err := run(t.Context(), nil); err == nil {
		t.Fatal("expected usage error")
	}
}
