package etapredict

import (
	"strings"
	"testing"
	"time"
)

func sp(s string) *string { return &s }
func ip(i int) *int       { return &i }

// 2026-06-24 08:30 UTC → +4h GST = 12:30 on 24 Jun.
var fixedEta = time.Date(2026, time.June, 24, 8, 30, 0, 0, time.UTC)

func TestFmtLocalTimeGST(t *testing.T) {
	if got := fmtLocalTime(fixedEta); got != "24 Jun, 12:30 GST" {
		t.Fatalf("fmtLocalTime = %q, want '24 Jun, 12:30 GST'", got)
	}
}

func TestFormatEtaSMS(t *testing.T) {
	cases := []struct {
		name  string
		dest  *string
		delta *int
		want  string
	}{
		{"first eta (nil delta), with dest", sp("Abu Dhabi"), nil,
			"Fleet360: Shipment SHP-1 to Abu Dhabi is now estimated to arrive 24 Jun, 12:30 GST."},
		{"delayed", sp("Abu Dhabi"), ip(20),
			"Fleet360: Shipment SHP-1 to Abu Dhabi is now estimated to arrive 24 Jun, 12:30 GST (delayed)."},
		{"earlier", nil, ip(-10),
			"Fleet360: Shipment SHP-1 is now estimated to arrive 24 Jun, 12:30 GST (earlier)."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FormatEtaSMS("SHP-1", c.dest, fixedEta, c.delta); got != c.want {
				t.Fatalf("FormatEtaSMS = %q, want %q", got, c.want)
			}
		})
	}
}

func TestFormatEtaEmail(t *testing.T) {
	subject, text, html := FormatEtaEmail("SHP-1", sp("Maya"), sp("Abu Dhabi"), fixedEta, ip(20))
	if subject != "Updated ETA for shipment SHP-1 — 24 Jun, 12:30 GST" {
		t.Fatalf("subject = %q", subject)
	}
	if !strings.HasPrefix(text, "Hi Maya,") {
		t.Errorf("text greeting wrong: %q", text)
	}
	for _, want := range []string{"shipment SHP-1 to Abu Dhabi", "delayed by 20 min", "24 Jun, 12:30 GST"} {
		if !strings.Contains(text, want) {
			t.Errorf("text missing %q", want)
		}
	}
	if !strings.Contains(html, "<strong>SHP-1</strong>") || !strings.Contains(html, "delayed by 20 min") {
		t.Errorf("html missing expected fragments: %q", html)
	}

	// nil customer → "Hello,"; nil delta → "estimated"; earlier → abs minutes.
	_, text2, _ := FormatEtaEmail("SHP-2", nil, nil, fixedEta, nil)
	if !strings.HasPrefix(text2, "Hello,") || !strings.Contains(text2, "(estimated)") {
		t.Errorf("nil-customer/nil-delta email wrong: %q", text2)
	}
	_, text3, _ := FormatEtaEmail("SHP-3", nil, nil, fixedEta, ip(-7))
	if !strings.Contains(text3, "arriving 7 min earlier") {
		t.Errorf("earlier email wrong: %q", text3)
	}
}
