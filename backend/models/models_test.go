package models

import (
	"encoding/json"
	"testing"
)

func TestDecimalFixedPointNoFloatDrift(t *testing.T) {
	a, err := ParseDecimal("0.10")
	if err != nil {
		t.Fatalf("ParseDecimal(0.10): %v", err)
	}
	b, err := ParseDecimal("0.20")
	if err != nil {
		t.Fatalf("ParseDecimal(0.20): %v", err)
	}
	sum := a.Add(b)
	if sum.String() != "0.30" {
		t.Fatalf("expected 0.30, got %s", sum.String())
	}

	// Accumulate 100 x 0.10 = 10.00
	acc := FromFils(0)
	for i := 0; i < 100; i++ {
		acc = acc.Add(a)
	}
	if acc.String() != "10.00" {
		t.Fatalf("expected 10.00, got %s", acc.String())
	}

	// JSON round-trip
	raw, err := json.Marshal(PartUsage{UnitCost: a, TotalCost: sum})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var out PartUsage
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if out.UnitCost.String() != "0.10" || out.TotalCost.String() != "0.30" {
		t.Fatalf("unexpected JSON round-trip: %+v", out)
	}
}

func TestDecimalMonetaryStructsJSONAndScanValue(t *testing.T) {
	// Cmp helper
	if FromFils(100).Cmp(FromFils(200)) >= 0 {
		t.Fatalf("expected 1.00 < 2.00")
	}
	if FromFils(200).Cmp(FromFils(200)) != 0 {
		t.Fatalf("expected 2.00 == 2.00")
	}
	if FromFils(300).Cmp(FromFils(200)) <= 0 {
		t.Fatalf("expected 3.00 > 2.00")
	}

	// Scan & Value across types including large float64 (no scientific notation failure)
	var d Decimal
	if err := d.Scan([]byte("1234.56")); err != nil {
		t.Fatalf("Scan([]byte): %v", err)
	}
	if d.ToFils() != 123456 {
		t.Fatalf("expected 123456 fils, got %d", d.ToFils())
	}
	val, err := d.Value()
	if err != nil || val != "1234.56" {
		t.Fatalf("Value(): %v, %v", val, err)
	}

	if err := d.Scan(float64(1234567.89)); err != nil {
		t.Fatalf("Scan(large float64): %v", err)
	}
	if d.String() != "1234567.89" {
		t.Fatalf("expected 1234567.89, got %s", d.String())
	}

	if err := d.Scan(int64(42)); err != nil {
		t.Fatalf("Scan(int64): %v", err)
	}
	if d.String() != "42.00" {
		t.Fatalf("expected 42.00, got %s", d.String())
	}

	if err := d.Scan(nil); err != nil {
		t.Fatalf("Scan(nil): %v", err)
	}
	if d.String() != "0.00" {
		t.Fatalf("expected 0.00, got %s", d.String())
	}

	// JSON round-trips on migrated monetary structs
	qIn := Quotation{
		LaborCost:       FromFils(15050),
		PartsCost:       FromFils(29999),
		ConsumablesCost: FromFils(2500),
		VatAmount:       FromFils(2377),
		TotalCost:       FromFils(47549),
		GrandTotal:      FromFils(49926),
		Parts:           []QuotationPart{{Name: "Filter", Quantity: 2, UnitPrice: FromFils(10000), TotalPrice: FromFils(20000)}},
		Labor:           []QuotationLabor{{Description: "Install", Hours: 1.5, RatePerHour: FromFils(10000), TotalPrice: FromFils(15000)}},
	}
	qRaw, err := json.Marshal(qIn)
	if err != nil {
		t.Fatalf("Marshal Quotation: %v", err)
	}
	var qOut Quotation
	if err := json.Unmarshal(qRaw, &qOut); err != nil {
		t.Fatalf("Unmarshal Quotation: %v", err)
	}
	if qOut.GrandTotal.String() != "499.26" || qOut.Parts[0].TotalPrice.String() != "200.00" || qOut.Labor[0].Hours != 1.5 {
		t.Fatalf("Quotation round-trip mismatch: %+v", qOut)
	}

	invIn := Invoice{
		InvoiceNumber: "INV-100",
		TotalAmount:   FromFils(105000),
		PaidAmount:    FromFils(52500),
		LineItems:     []InvoiceLineItem{{Description: "Service", Quantity: 1, UnitPrice: FromFils(100000), TotalPrice: FromFils(100000)}},
	}
	invRaw, err := json.Marshal(invIn)
	if err != nil {
		t.Fatalf("Marshal Invoice: %v", err)
	}
	var invOut Invoice
	if err := json.Unmarshal(invRaw, &invOut); err != nil {
		t.Fatalf("Unmarshal Invoice: %v", err)
	}
	if invOut.TotalAmount.String() != "1050.00" || invOut.PaidAmount.String() != "525.00" || invOut.LineItems[0].UnitPrice.String() != "1000.00" {
		t.Fatalf("Invoice round-trip mismatch: %+v", invOut)
	}

	mrIn := MaintenanceRequest{
		EstimatedCost:   FromFils(50000),
		ActualCost:      FromFils(48525),
		ActualPartsCost: FromFils(30000),
		ActualLaborCost: FromFils(15000),
		ActualOtherCost: FromFils(3525),
		ActualCostsData: ActualCosts{Parts: FromFils(30000), Labor: FromFils(15000), Other: FromFils(3525), Total: FromFils(48525)},
	}
	mrRaw, err := json.Marshal(mrIn)
	if err != nil {
		t.Fatalf("Marshal MaintenanceRequest: %v", err)
	}
	var mrOut MaintenanceRequest
	if err := json.Unmarshal(mrRaw, &mrOut); err != nil {
		t.Fatalf("Unmarshal MaintenanceRequest: %v", err)
	}
	if mrOut.ActualCost.String() != "485.25" || mrOut.ActualCostsData.Total.String() != "485.25" {
		t.Fatalf("MaintenanceRequest round-trip mismatch: %+v", mrOut)
	}

	cfIn := CostForecast{
		CurrentMonth: FromFils(45000),
		NextMonth:    FromFils(80000),
		Next3Months:  FromFils(125000),
		Next6Months:  FromFils(150000),
		Trend:        "increasing",
	}
	cfRaw, err := json.Marshal(cfIn)
	if err != nil {
		t.Fatalf("Marshal CostForecast: %v", err)
	}
	var cfOut CostForecast
	if err := json.Unmarshal(cfRaw, &cfOut); err != nil {
		t.Fatalf("Unmarshal CostForecast: %v", err)
	}
	if cfOut.Next6Months.String() != "1500.00" || cfOut.Trend != "increasing" {
		t.Fatalf("CostForecast round-trip mismatch: %+v", cfOut)
	}
}
