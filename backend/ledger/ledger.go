// Package ledger holds the pure, deterministic finance logic behind the
// logistics money layer (Phase L3): how a carrier-payable or driver-payout
// journal entry is constructed, the chart-of-accounts codes those entries hit,
// the commission / payout / margin arithmetic, and the invoice / journal number
// formats.
//
// It is dependency-free (no DB, no gin) so the rules can be unit-tested in
// isolation — the same split used by rateengine, etapredict and geofence. The
// impure parts (sequence COUNT lookups, the random invoice hex suffix, reading
// the shipment's stored commission override, and the actual INSERTs into the
// shared core-finance ledger) stay in the caller.
//
// Parity source: src/lib/logistics/domain.ts —
// prepareFreightFinancialSettlement (5153), createFinanceJournalEntry (5563),
// nextFinanceInvoiceNo (5454), nextFinanceJournalNo (5470), and the account
// codes used by postFreightSettlementToFinance (5773).
//
// WHY THIS IS A PURE PACKAGE AND NOT A LIVE ENDPOINT (yet): the write flow that
// uses this logic posts into Finance's own tables (finance_invoices,
// finance_journal_entries, finance_journal_lines) and is triggered solely by
// awardCarrierBid, which still lives in Next.js during the strangler dual-run.
// Wiring a Go endpoint that writes the shared ledger now would be a dormant,
// cross-module, double-write path with no caller. The arithmetic and entry
// construction are migrated and tested here so that L4 — when awardCarrierBid
// moves to Go and there is exactly one writer — only has to wire the DB plumbing.
package ledger

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Chart-of-accounts codes and the logistics cost centre — verbatim from
// postFreightSettlementToFinance. Carrier freight cost is debited against the
// carrier-payable liability; driver payout cost against the driver-payable
// liability. Both lines book to the LOGISTICS cost centre.
const (
	CostCentreLogistics = "LOGISTICS"

	AccCarrierFreightCostCode = "5200-LOG"
	AccCarrierFreightCostName = "Logistics Carrier Freight Cost"
	AccCarrierPayableCode     = "2200-LOG"
	AccCarrierPayableName     = "Carrier Payables"

	AccDriverPayoutCostCode = "5250-LOG"
	AccDriverPayoutCostName = "Logistics Driver Payout Cost"
	AccDriverPayableCode    = "2210-LOG"
	AccDriverPayableName    = "Driver Payables"
)

// Journal-entry constants mirroring createFinanceJournalEntry: logistics
// settlement entries are auto-posted (not left DRAFT) with two balanced lines.
const (
	SourceTypeLogisticsSettlement = "LOGISTICS_SETTLEMENT"
	StatusPosted                  = "POSTED"
	NormalDebit                   = "DEBIT"
	NormalCredit                  = "CREDIT"

	// DriverPayoutShare is the fraction of the carrier amount paid to the
	// driver (carrierAmount * 0.7 in prepareFreightFinancialSettlement).
	DriverPayoutShare = 0.7
)

// PostingKind enumerates the GL postings the logistics settlement produces that
// require a journal entry. (CUSTOMER_INVOICE books an invoice, not a JE, and
// PLATFORM_COMMISSION is a bare bridge posting with no JE — neither goes through
// BuildJournalEntry.)
type PostingKind string

const (
	CarrierPayable PostingKind = "CARRIER_PAYABLE"
	DriverPayout   PostingKind = "DRIVER_PAYOUT"
)

// Round2 rounds to 2 decimal places (half away from zero), matching the
// pervasive `Number(x.toFixed(2))` in the TS finance code.
func Round2(v float64) float64 { return math.Round(v*100) / 100 }

// ── Money math (prepareFreightFinancialSettlement) ───────────────────────────

// FallbackCommission is carrierAmount * commissionRate% — the floor used when a
// shipment has no explicitly stored platform commission.
func FallbackCommission(carrierAmount, commissionRatePct float64) float64 {
	return Round2(carrierAmount * commissionRatePct / 100)
}

// DefaultCustomerAmount is what the customer is billed when the shipment carries
// no stored customer rate: carrier cost plus the fallback commission.
func DefaultCustomerAmount(carrierAmount, fallbackCommission float64) float64 {
	return Round2(carrierAmount + fallbackCommission)
}

// SettlementCommission is the commission booked at settlement-prep time:
// max(margin, fallback). Used when the shipment has no stored commission.
// (prepareFreightFinancialSettlement)
func SettlementCommission(customerAmount, carrierAmount, fallbackCommission float64) float64 {
	return Round2(math.Max(customerAmount-carrierAmount, fallbackCommission))
}

// PostingCommission is the commission booked at ledger-post time: a non-negative
// margin. Used when the shipment has no stored commission.
// (postFreightSettlementToFinance)
func PostingCommission(customerAmount, carrierAmount float64) float64 {
	return Round2(math.Max(customerAmount-carrierAmount, 0))
}

// DriverPayoutGross is the driver's gross earning: a fixed share of the carrier
// amount.
func DriverPayoutGross(carrierAmount float64) float64 {
	return Round2(carrierAmount * DriverPayoutShare)
}

// Margin is customer revenue minus carrier cost (may be negative).
func Margin(customerAmount, carrierAmount float64) float64 {
	return Round2(customerAmount - carrierAmount)
}

// ── Number formats ───────────────────────────────────────────────────────────

// InvoiceNumber formats a logistics finance invoice number:
// INV-LOG-<yy><5-digit seq>-<HEX>, e.g. INV-LOG-2600042-9AF3. The hex suffix is
// generated by the caller (randomBytes(2) in nextFinanceInvoiceNo); it is upper-
// cased here. seq is the caller's COUNT(*)+1 over the same prefix.
func InvoiceNumber(t time.Time, seq int, hexSuffix string) string {
	return fmt.Sprintf("INV-LOG-%02d%05d-%s", t.Year()%100, seq, strings.ToUpper(hexSuffix))
}

// JournalNumber formats a journal-entry number: JE-<YYYY><MM>-<5-digit seq>,
// e.g. JE-202606-00001. seq is the caller's COUNT(*)+1 over the same month.
func JournalNumber(t time.Time, seq int) string {
	return fmt.Sprintf("JE-%04d%02d-%05d", t.Year(), int(t.Month()), seq)
}

// SettlementNoPrefix / DriverPayoutNoPrefix return the year-stamped prefixes the
// marketplace number generator extends with a zero-padded sequence
// (SET-LOG-26-00001, DPO-LOG-26-00001). The sequence itself is the marketplace
// generator's concern (nextMarketplaceNo, Phase L1), not this package's.
func SettlementNoPrefix(t time.Time) string   { return fmt.Sprintf("SET-LOG-%02d", t.Year()%100) }
func DriverPayoutNoPrefix(t time.Time) string { return fmt.Sprintf("DPO-LOG-%02d", t.Year()%100) }

// ── Customer invoice line items ──────────────────────────────────────────────

// InvoiceLineItem is one line of the customer freight invoice's line_items
// JSONB. The shape matches the object pushed in postFreightSettlementToFinance.
type InvoiceLineItem struct {
	Description     string  `json:"description"`
	Qty             int     `json:"qty"`
	UnitPrice       float64 `json:"unitPrice"`
	Amount          float64 `json:"amount"`
	SourceModule    string  `json:"sourceModule"`
	ShipmentOrderID string  `json:"shipmentOrderId"`
}

// CustomerInvoiceLineItems builds the single-line item array for a freight
// invoice (qty 1, unit price = amount, sourced from LOGISTICS).
func CustomerInvoiceLineItems(description string, amount float64, shipmentOrderID string) []InvoiceLineItem {
	return []InvoiceLineItem{{
		Description:     description,
		Qty:             1,
		UnitPrice:       amount,
		Amount:          amount,
		SourceModule:    "LOGISTICS",
		ShipmentOrderID: shipmentOrderID,
	}}
}

// ── Journal entry construction (createFinanceJournalEntry) ───────────────────

// Line is one row of finance_journal_lines.
type Line struct {
	LineNumber    int     `json:"lineNumber"`
	AccountCode   string  `json:"accountCode"`
	AccountName   string  `json:"accountName"`
	Description   string  `json:"description"`
	DebitAmount   float64 `json:"debitAmount"`
	CreditAmount  float64 `json:"creditAmount"`
	NormalBalance string  `json:"normalBalance"`
	CostCentre    string  `json:"costCentre"`
	Currency      string  `json:"currency"`
}

// JournalEntry is a finance_journal_entries row plus its two lines, ready for
// the caller to INSERT. Entries are produced already balanced and POSTED.
type JournalEntry struct {
	Narration   string  `json:"narration"`
	Reference   string  `json:"reference"`
	SourceType  string  `json:"sourceType"`
	SourceID    string  `json:"sourceId"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Status      string  `json:"status"`
	TotalDebit  float64 `json:"totalDebit"`
	TotalCredit float64 `json:"totalCredit"`
	IsBalanced  bool    `json:"isBalanced"`
	Lines       []Line  `json:"lines"`
}

// JournalInput carries the contextual, per-shipment text and the amount for a
// journal entry. The account codes/names are selected from the PostingKind.
type JournalInput struct {
	Narration         string
	Reference         string
	SourceID          string
	Amount            float64
	Currency          string
	DebitDescription  string
	CreditDescription string
}

type accountPair struct {
	debitCode, debitName, creditCode, creditName string
}

var journalAccounts = map[PostingKind]accountPair{
	CarrierPayable: {AccCarrierFreightCostCode, AccCarrierFreightCostName, AccCarrierPayableCode, AccCarrierPayableName},
	DriverPayout:   {AccDriverPayoutCostCode, AccDriverPayoutCostName, AccDriverPayableCode, AccDriverPayableName},
}

// BuildJournalEntry constructs the balanced two-line entry for a carrier-payable
// or driver-payout posting: line 1 debits the cost account for the full amount,
// line 2 credits the payable account for the full amount. Mirrors
// createFinanceJournalEntry exactly (status POSTED, both lines on the LOGISTICS
// cost centre, total_debit == total_credit == amount). An empty currency
// defaults to AED, consistent with the rest of the finance code.
func BuildJournalEntry(kind PostingKind, in JournalInput) (JournalEntry, error) {
	acc, ok := journalAccounts[kind]
	if !ok {
		return JournalEntry{}, fmt.Errorf("ledger: no journal account mapping for posting kind %q", kind)
	}
	amount := Round2(in.Amount)
	currency := in.Currency
	if currency == "" {
		currency = "AED"
	}
	lines := []Line{
		{
			LineNumber:    1,
			AccountCode:   acc.debitCode,
			AccountName:   acc.debitName,
			Description:   in.DebitDescription,
			DebitAmount:   amount,
			CreditAmount:  0,
			NormalBalance: NormalDebit,
			CostCentre:    CostCentreLogistics,
			Currency:      currency,
		},
		{
			LineNumber:    2,
			AccountCode:   acc.creditCode,
			AccountName:   acc.creditName,
			Description:   in.CreditDescription,
			DebitAmount:   0,
			CreditAmount:  amount,
			NormalBalance: NormalCredit,
			CostCentre:    CostCentreLogistics,
			Currency:      currency,
		},
	}
	return JournalEntry{
		Narration:   in.Narration,
		Reference:   in.Reference,
		SourceType:  SourceTypeLogisticsSettlement,
		SourceID:    in.SourceID,
		Amount:      amount,
		Currency:    currency,
		Status:      StatusPosted,
		TotalDebit:  amount,
		TotalCredit: amount,
		IsBalanced:  Round2(amount) == Round2(amount),
		Lines:       lines,
	}, nil
}
