package etapredict

// ETA notification message formatting — the pure port of formatEtaSms /
// formatEtaEmail (and their fmtLocalTime helper) from
// src/lib/logistics/eta-notifier.ts. These build the customer-facing SMS and
// email copy from a prediction; the transport (Twilio / SendGrid) lives in the
// separate notify package, and the decision (whether to send) is DecideNotify.
//
// Times render in GST (UTC+4) — the operating region — without a timezone
// library, exactly as the TS does: shift the instant +4h and read the UTC
// clock fields.

import (
	"fmt"
	"time"
)

// fmtLocalTime renders an instant as "02 Jan, 15:04 GST" in Gulf Standard Time.
func fmtLocalTime(t time.Time) string {
	g := t.UTC().Add(4 * time.Hour)
	return fmt.Sprintf("%s, %02d:%02d GST", g.Format("02 Jan"), g.Hour(), g.Minute())
}

// FormatEtaSMS builds the one-line SMS body. deltaMinutes nil → no direction
// hint; >0 → "(delayed)"; ≤0 → "(earlier)" (matching the TS `> 0` test, so a
// zero delta reads as earlier). destination nil/empty → omitted.
func FormatEtaSMS(shipmentNo string, destination *string, etaAt time.Time, deltaMinutes *int) string {
	when := fmtLocalTime(etaAt)
	dir := ""
	if deltaMinutes != nil {
		if *deltaMinutes > 0 {
			dir = " (delayed)"
		} else {
			dir = " (earlier)"
		}
	}
	dest := ""
	if destination != nil && *destination != "" {
		dest = " to " + *destination
	}
	return fmt.Sprintf("Fleet360: Shipment %s%s is now estimated to arrive %s%s.", shipmentNo, dest, when, dir)
}

// FormatEtaEmail builds the subject + plain-text + HTML bodies. deltaMinutes
// nil → "estimated"; >0 → "delayed by N min"; ≤0 → "arriving |N| min earlier".
func FormatEtaEmail(shipmentNo string, customerName, destination *string, etaAt time.Time, deltaMinutes *int) (subject, text, html string) {
	when := fmtLocalTime(etaAt)
	dir := "estimated"
	if deltaMinutes != nil {
		if *deltaMinutes > 0 {
			dir = fmt.Sprintf("delayed by %d min", *deltaMinutes)
		} else {
			d := *deltaMinutes
			if d < 0 {
				d = -d
			}
			dir = fmt.Sprintf("arriving %d min earlier", d)
		}
	}
	dest := ""
	if destination != nil && *destination != "" {
		dest = " to " + *destination
	}
	greeting := "Hello,"
	if customerName != nil && *customerName != "" {
		greeting = "Hi " + *customerName + ","
	}

	subject = fmt.Sprintf("Updated ETA for shipment %s — %s", shipmentNo, when)
	text = greeting + "\n\n" +
		fmt.Sprintf("The estimated arrival for your shipment %s%s has updated.\n", shipmentNo, dest) +
		fmt.Sprintf("New ETA: %s (%s).\n\n", when, dir) +
		"You can track it live in your Fleet360 portal.\n\n— Fleet360"
	html = fmt.Sprintf("<p>%s</p>", greeting) +
		fmt.Sprintf("<p>The estimated arrival for your shipment <strong>%s</strong>%s has updated.</p>", shipmentNo, dest) +
		fmt.Sprintf("<p><strong>New ETA: %s</strong> (%s).</p>", when, dir) +
		"<p>You can track it live in your Fleet360 portal.</p><p>— Fleet360</p>"
	return subject, text, html
}
