// Package notify is the Go-native SMS (Twilio) + email (SendGrid) sender — the
// port of src/lib/sms.ts and src/lib/email.ts. Both providers are called via
// their plain REST APIs (no SDK), read credentials from the SAME env vars the
// TS uses, no-op cleanly when unconfigured, and are best-effort: they return a
// structured result and never panic, so a failed send never breaks the caller
// (e.g. the tracking ingest fans SMS → email regardless).
//
// SECURITY: the Twilio auth token and SendGrid API key are read from the
// environment and used only to build the provider Authorization header. They are
// NEVER logged and NEVER placed in a result — error strings carry only the
// provider's HTTP status plus a truncated response body.
//
// An injectable HTTP transport (httpDo) makes both senders unit-testable without
// touching the network, mirroring the _setFetchForTests seam in the TS modules.
package notify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// httpDo is the injectable transport seam (default: a 10s-timeout client). Tests
// swap it via SetTransportForTests.
var httpDo = (&http.Client{Timeout: 10 * time.Second}).Do

// SetTransportForTests overrides the HTTP transport used by SendSMS/SendEmail.
func SetTransportForTests(do func(*http.Request) (*http.Response, error)) { httpDo = do }

// ResetTransportForTests restores the default network transport.
func ResetTransportForTests() { httpDo = (&http.Client{Timeout: 10 * time.Second}).Do }

// SMSResult mirrors SmsSendResult in sms.ts. Reason is one of
// not_configured | no_phone | twilio_error | network_error (empty on success).
type SMSResult struct {
	Sent   bool
	SID    string
	Reason string
	Error  string
}

// EmailResult mirrors EmailSendResult in email.ts. Reason is one of
// not_configured | no_recipient | sendgrid_error | network_error.
type EmailResult struct {
	Sent   bool
	Status int
	Reason string
	Error  string
}

var (
	phoneRe    = regexp.MustCompile(`^\+?\d{7,15}$`)
	phoneStrip = regexp.MustCompile(`[\s()-]`)
)

// FormatSMSTo normalises a phone to E.164-ish — keep a leading +, strip spaces /
// dashes / parens — or returns "" when it isn't a plausible 7–15 digit number.
// Port of formatSmsTo in sms.ts.
func FormatSMSTo(raw string) string {
	t := strings.TrimSpace(raw)
	if t == "" {
		return ""
	}
	cleaned := phoneStrip.ReplaceAllString(t, "")
	if !phoneRe.MatchString(cleaned) {
		return ""
	}
	if strings.HasPrefix(cleaned, "+") {
		return cleaned
	}
	return "+" + cleaned
}

// SendSMS sends a plain SMS via Twilio's Messages API. No-op (not_configured)
// unless TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_NUMBER (falling
// back to TWILIO_FROM_NUMBER) are all set. Best-effort — never panics.
func SendSMS(ctx context.Context, to, body string) SMSResult {
	sid := os.Getenv("TWILIO_ACCOUNT_SID")
	token := os.Getenv("TWILIO_AUTH_TOKEN")
	from := os.Getenv("TWILIO_SMS_NUMBER")
	if from == "" {
		from = os.Getenv("TWILIO_FROM_NUMBER")
	}
	if sid == "" || token == "" || from == "" {
		return SMSResult{Reason: "not_configured"}
	}
	toNum := FormatSMSTo(to)
	if toNum == "" {
		return SMSResult{Reason: "no_phone"}
	}

	form := url.Values{"From": {from}, "To": {toNum}, "Body": {body}}
	endpoint := "https://api.twilio.com/2010-04-01/Accounts/" + url.PathEscape(sid) + "/Messages.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return SMSResult{Reason: "network_error", Error: err.Error()}
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(sid+":"+token)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := httpDo(req)
	if err != nil {
		return SMSResult{Reason: "network_error", Error: err.Error()}
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return SMSResult{Reason: "twilio_error", Error: fmt.Sprintf("Twilio %d: %s", res.StatusCode, truncBody(res.Body, 200))}
	}
	var parsed struct {
		SID string `json:"sid"`
	}
	_ = json.NewDecoder(res.Body).Decode(&parsed)
	return SMSResult{Sent: true, SID: parsed.SID}
}

// SendEmail sends an email via SendGrid's v3 mail/send API. No-op
// (not_configured) unless SENDGRID_API_KEY and EMAIL_FROM (falling back to
// SMTP_FROM) are set. Best-effort. A "Name <email>" from value is split into the
// SendGrid name/email pair. Port of sendEmail in email.ts.
func SendEmail(ctx context.Context, to, subject, text, html string) EmailResult {
	apiKey := os.Getenv("SENDGRID_API_KEY")
	from := os.Getenv("EMAIL_FROM")
	if from == "" {
		from = os.Getenv("SMTP_FROM")
	}
	if apiKey == "" || from == "" {
		return EmailResult{Reason: "not_configured"}
	}
	if strings.TrimSpace(to) == "" {
		return EmailResult{Reason: "no_recipient"}
	}

	fromEmail, fromName := parseFrom(from)
	fromObj := map[string]any{"email": fromEmail}
	if fromName != "" {
		fromObj["name"] = fromName
	}
	content := make([]map[string]string, 0, 2)
	if text != "" {
		content = append(content, map[string]string{"type": "text/plain", "value": text})
	}
	if html != "" {
		content = append(content, map[string]string{"type": "text/html", "value": html})
	}
	if len(content) == 0 {
		content = append(content, map[string]string{"type": "text/plain", "value": subject})
	}

	payload := map[string]any{
		"personalizations": []map[string]any{{"to": []map[string]string{{"email": to}}}},
		"from":             fromObj,
		"subject":          subject,
		"content":          content,
	}
	buf, err := json.Marshal(payload)
	if err != nil {
		return EmailResult{Reason: "network_error", Error: err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.sendgrid.com/v3/mail/send", strings.NewReader(string(buf)))
	if err != nil {
		return EmailResult{Reason: "network_error", Error: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := httpDo(req)
	if err != nil {
		return EmailResult{Reason: "network_error", Error: err.Error()}
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return EmailResult{Sent: true, Status: res.StatusCode}
	}
	return EmailResult{Reason: "sendgrid_error", Status: res.StatusCode,
		Error: fmt.Sprintf("SendGrid %d: %s", res.StatusCode, truncBody(res.Body, 300))}
}

// parseFrom splits "Name <email@x>" into ("email@x", "Name"); a bare address
// returns ("email@x", "").
func parseFrom(from string) (email, name string) {
	i := strings.Index(from, "<")
	if i >= 0 {
		if j := strings.Index(from[i:], ">"); j >= 0 {
			email = strings.TrimSpace(from[i+1 : i+j])
			name = strings.Trim(strings.TrimSpace(from[:i]), `"`)
			return email, name
		}
	}
	return strings.TrimSpace(from), ""
}

// truncBody reads at most n bytes of a provider response body for an error
// message. Never returns the request credentials — only the provider's reply.
func truncBody(r io.Reader, n int) string {
	b, _ := io.ReadAll(io.LimitReader(r, int64(n)))
	return string(b)
}
