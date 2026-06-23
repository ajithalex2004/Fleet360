package ledger

import (
	"testing"
	"time"
)

// A fixed instant so number formats are deterministic (June 2026).
var refTime = time.Date(2026, time.June, 23, 10, 0, 0, 0, time.UTC)

func TestRound2(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{10.456, 10.46},
		{10.454, 10.45},
		{49.0, 49.0},
		{23.331, 23.33},
		{-200.005, -200.01}, // half away from zero
		{0, 0},
	}
	for _, c := range cases {
		if got := Round2(c.in); got != c.want {
			t.Errorf("Round2(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestCommissionMath(t *testing.T) {
	// FallbackCommission = carrier * rate%
	if got := FallbackCommission(1000, 5); got != 50 {
		t.Errorf("FallbackCommission(1000,5) = %v, want 50", got)
	}
	if got := FallbackCommission(1234.5, 10); got != 123.45 {
		t.Errorf("FallbackCommission(1234.5,10) = %v, want 123.45", got)
	}

	// SettlementCommission = max(margin, fallback)
	if got := SettlementCommission(1000, 800, 50); got != 200 {
		t.Errorf("SettlementCommission(1000,800,50) = %v, want 200 (margin wins)", got)
	}
	if got := SettlementCommission(820, 800, 50); got != 50 {
		t.Errorf("SettlementCommission(820,800,50) = %v, want 50 (fallback wins)", got)
	}

	// PostingCommission = max(margin, 0)
	if got := PostingCommission(1000, 800); got != 200 {
		t.Errorf("PostingCommission(1000,800) = %v, want 200", got)
	}
	if got := PostingCommission(800, 1000); got != 0 {
		t.Errorf("PostingCommission(800,1000) = %v, want 0 (clamped)", got)
	}
}

func TestDefaultCustomerAmountAndMargin(t *testing.T) {
	if got := DefaultCustomerAmount(800, 50); got != 850 {
		t.Errorf("DefaultCustomerAmount(800,50) = %v, want 850", got)
	}
	if got := Margin(1000, 800); got != 200 {
		t.Errorf("Margin(1000,800) = %v, want 200", got)
	}
	if got := Margin(800, 1000); got != -200 {
		t.Errorf("Margin(800,1000) = %v, want -200", got)
	}
}

func TestDriverPayoutGross(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{100, 70},
		{150, 105},
		{33.33, 23.33}, // Round2(23.331)
	}
	for _, c := range cases {
		if got := DriverPayoutGross(c.in); got != c.want {
			t.Errorf("DriverPayoutGross(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestInvoiceNumber(t *testing.T) {
	if got := InvoiceNumber(refTime, 1, "9af3"); got != "INV-LOG-2600001-9AF3" {
		t.Errorf("InvoiceNumber seq 1 = %q, want INV-LOG-2600001-9AF3", got)
	}
	if got := InvoiceNumber(refTime, 42, "abcd"); got != "INV-LOG-2600042-ABCD" {
		t.Errorf("InvoiceNumber seq 42 = %q, want INV-LOG-2600042-ABCD", got)
	}
	// Year 2105 → yy "05" (last two digits, zero-padded).
	if got := InvoiceNumber(time.Date(2105, time.January, 1, 0, 0, 0, 0, time.UTC), 3, "ff00"); got != "INV-LOG-0500003-FF00" {
		t.Errorf("InvoiceNumber 2105 = %q, want INV-LOG-0500003-FF00", got)
	}
}

func TestJournalNumber(t *testing.T) {
	if got := JournalNumber(refTime, 1); got != "JE-202606-00001" {
		t.Errorf("JournalNumber June seq 1 = %q, want JE-202606-00001", got)
	}
	if got := JournalNumber(time.Date(2026, time.December, 5, 0, 0, 0, 0, time.UTC), 7); got != "JE-202612-00007" {
		t.Errorf("JournalNumber Dec seq 7 = %q, want JE-202612-00007", got)
	}
}

func TestNoPrefixes(t *testing.T) {
	if got := SettlementNoPrefix(refTime); got != "SET-LOG-26" {
		t.Errorf("SettlementNoPrefix = %q, want SET-LOG-26", got)
	}
	if got := DriverPayoutNoPrefix(refTime); got != "DPO-LOG-26" {
		t.Errorf("DriverPayoutNoPrefix = %q, want DPO-LOG-26", got)
	}
}

func TestCustomerInvoiceLineItems(t *testing.T) {
	items := CustomerInvoiceLineItems("Freight service for SHP-1", 500, "ship-1")
	if len(items) != 1 {
		t.Fatalf("expected 1 line item, got %d", len(items))
	}
	it := items[0]
	if it.Qty != 1 || it.UnitPrice != 500 || it.Amount != 500 {
		t.Errorf("unexpected qty/price/amount: %+v", it)
	}
	if it.SourceModule != "LOGISTICS" || it.ShipmentOrderID != "ship-1" {
		t.Errorf("unexpected source: %+v", it)
	}
	if it.Description != "Freight service for SHP-1" {
		t.Errorf("unexpected description: %q", it.Description)
	}
}

func TestBuildJournalEntryCarrierPayable(t *testing.T) {
	je, err := BuildJournalEntry(CarrierPayable, JournalInput{
		Narration:         "Carrier payable for SHP-1",
		Reference:         "SET-LOG-26-00001",
		SourceID:          "settle-1",
		Amount:            1500.5,
		Currency:          "AED",
		DebitDescription:  "Freight cost for SHP-1",
		CreditDescription: "Carrier payable SET-LOG-26-00001",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if je.SourceType != "LOGISTICS_SETTLEMENT" || je.Status != "POSTED" {
		t.Errorf("source/status = %s/%s, want LOGISTICS_SETTLEMENT/POSTED", je.SourceType, je.Status)
	}
	if je.TotalDebit != 1500.5 || je.TotalCredit != 1500.5 || !je.IsBalanced {
		t.Errorf("totals/balanced = %v/%v/%v, want 1500.5/1500.5/true", je.TotalDebit, je.TotalCredit, je.IsBalanced)
	}
	if len(je.Lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(je.Lines))
	}
	d, cr := je.Lines[0], je.Lines[1]
	if d.LineNumber != 1 || d.AccountCode != "5200-LOG" || d.DebitAmount != 1500.5 || d.CreditAmount != 0 || d.NormalBalance != "DEBIT" {
		t.Errorf("debit line wrong: %+v", d)
	}
	if cr.LineNumber != 2 || cr.AccountCode != "2200-LOG" || cr.CreditAmount != 1500.5 || cr.DebitAmount != 0 || cr.NormalBalance != "CREDIT" {
		t.Errorf("credit line wrong: %+v", cr)
	}
	if d.CostCentre != "LOGISTICS" || cr.CostCentre != "LOGISTICS" {
		t.Errorf("cost centre not LOGISTICS: %s/%s", d.CostCentre, cr.CostCentre)
	}
}

func TestBuildJournalEntryDriverPayout(t *testing.T) {
	je, err := BuildJournalEntry(DriverPayout, JournalInput{
		Reference: "DPO-LOG-26-00001",
		SourceID:  "payout-1",
		Amount:    700,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if je.Lines[0].AccountCode != "5250-LOG" || je.Lines[1].AccountCode != "2210-LOG" {
		t.Errorf("driver payout accounts wrong: %s / %s", je.Lines[0].AccountCode, je.Lines[1].AccountCode)
	}
	// Empty currency must default to AED on both the entry and its lines.
	if je.Currency != "AED" || je.Lines[0].Currency != "AED" || je.Lines[1].Currency != "AED" {
		t.Errorf("currency not defaulted to AED: %+v", je)
	}
}

func TestBuildJournalEntryUnknownKind(t *testing.T) {
	if _, err := BuildJournalEntry(PostingKind("CUSTOMER_INVOICE"), JournalInput{Amount: 10}); err == nil {
		t.Fatal("expected an error for a posting kind with no journal mapping")
	}
}

func TestBuildJournalEntryRoundsAmount(t *testing.T) {
	je, err := BuildJournalEntry(CarrierPayable, JournalInput{Amount: 99.999})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if je.Amount != 100 || je.Lines[0].DebitAmount != 100 || je.Lines[1].CreditAmount != 100 {
		t.Errorf("amount not rounded to 2dp: %+v", je)
	}
}
