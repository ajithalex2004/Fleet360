package notify

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// mockResponse builds an *http.Response with the given status + body.
func mockResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestFormatSMSTo(t *testing.T) {
	cases := map[string]string{
		"+971 50 123 4567":  "+971501234567",
		"0501234567":        "+0501234567",
		"(415) 555-0172":    "+4155550172",
		"":                  "",
		"   ":               "",
		"not-a-phone":       "",
		"+12":               "", // too short (< 7 digits)
		"12345678901234567": "", // too long (> 15 digits)
	}
	for in, want := range cases {
		if got := FormatSMSTo(in); got != want {
			t.Errorf("FormatSMSTo(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSendSMSNotConfigured(t *testing.T) {
	t.Setenv("TWILIO_ACCOUNT_SID", "")
	t.Setenv("TWILIO_AUTH_TOKEN", "")
	t.Setenv("TWILIO_SMS_NUMBER", "")
	t.Setenv("TWILIO_FROM_NUMBER", "")
	r := SendSMS(context.Background(), "+971501234567", "hi")
	if r.Sent || r.Reason != "not_configured" {
		t.Fatalf("got %+v, want not_configured no-op", r)
	}
}

func TestSendSMSSends(t *testing.T) {
	t.Setenv("TWILIO_ACCOUNT_SID", "AC_test_sid")
	t.Setenv("TWILIO_AUTH_TOKEN", "tok_secret")
	t.Setenv("TWILIO_SMS_NUMBER", "+1000000000")

	var got *http.Request
	var rawBody string
	SetTransportForTests(func(r *http.Request) (*http.Response, error) {
		if r.Body != nil {
			b, _ := io.ReadAll(r.Body)
			rawBody = string(b)
		}
		got = r
		return mockResponse(201, `{"sid":"SM123"}`), nil
	})
	t.Cleanup(ResetTransportForTests)

	r := SendSMS(context.Background(), "+971 50 123 4567", "Your shipment is on the way")
	if !r.Sent || r.SID != "SM123" {
		t.Fatalf("got %+v, want sent SM123", r)
	}
	if got == nil {
		t.Fatal("transport not invoked")
	}
	if !strings.Contains(got.URL.String(), "AC_test_sid/Messages.json") {
		t.Errorf("URL = %s, want the account Messages.json endpoint", got.URL.String())
	}
	if auth := got.Header.Get("Authorization"); !strings.HasPrefix(auth, "Basic ") {
		t.Errorf("Authorization = %q, want Basic auth", auth)
	}
	// Credentials must never appear in plaintext in the request line/headers.
	if strings.Contains(got.URL.RawQuery, "tok_secret") {
		t.Error("auth token leaked into the URL")
	}
	for _, want := range []string{"From=", "To=%2B971501234567", "Body="} {
		if !strings.Contains(rawBody, want) {
			t.Errorf("form body %q missing %q", rawBody, want)
		}
	}
}

func TestSendSMSNoPhone(t *testing.T) {
	t.Setenv("TWILIO_ACCOUNT_SID", "AC_test_sid")
	t.Setenv("TWILIO_AUTH_TOKEN", "tok")
	t.Setenv("TWILIO_SMS_NUMBER", "+1000000000")
	r := SendSMS(context.Background(), "not-a-number", "hi")
	if r.Sent || r.Reason != "no_phone" {
		t.Fatalf("got %+v, want no_phone", r)
	}
}

func TestSendSMSTwilioError(t *testing.T) {
	t.Setenv("TWILIO_ACCOUNT_SID", "AC_test_sid")
	t.Setenv("TWILIO_AUTH_TOKEN", "tok")
	t.Setenv("TWILIO_SMS_NUMBER", "+1000000000")
	SetTransportForTests(func(r *http.Request) (*http.Response, error) {
		return mockResponse(401, "auth failed"), nil
	})
	t.Cleanup(ResetTransportForTests)
	r := SendSMS(context.Background(), "+971501234567", "hi")
	if r.Sent || r.Reason != "twilio_error" || !strings.Contains(r.Error, "401") {
		t.Fatalf("got %+v, want twilio_error with status", r)
	}
}

func TestSendEmailNotConfigured(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "")
	t.Setenv("EMAIL_FROM", "")
	t.Setenv("SMTP_FROM", "")
	r := SendEmail(context.Background(), "a@b.com", "s", "t", "<p>h</p>")
	if r.Sent || r.Reason != "not_configured" {
		t.Fatalf("got %+v, want not_configured", r)
	}
}

func TestSendEmailSends(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.key")
	t.Setenv("EMAIL_FROM", "Fleet360 <ops@fleet360.test>")

	var rawBody string
	var got *http.Request
	SetTransportForTests(func(r *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(r.Body)
		rawBody = string(b)
		got = r
		return mockResponse(202, ""), nil
	})
	t.Cleanup(ResetTransportForTests)

	r := SendEmail(context.Background(), "cust@x.com", "Updated ETA", "plain", "<p>html</p>")
	if !r.Sent || r.Status != 202 {
		t.Fatalf("got %+v, want sent 202", r)
	}
	if got.Header.Get("Authorization") != "Bearer SG.key" {
		t.Errorf("Authorization = %q, want Bearer SG.key", got.Header.Get("Authorization"))
	}
	for _, want := range []string{`"cust@x.com"`, `"ops@fleet360.test"`, `"name":"Fleet360"`, `"Updated ETA"`, "text/plain", "text/html"} {
		if !strings.Contains(rawBody, want) {
			t.Errorf("payload %s missing %q", rawBody, want)
		}
	}
}

func TestSendEmailNoRecipient(t *testing.T) {
	t.Setenv("SENDGRID_API_KEY", "SG.key")
	t.Setenv("EMAIL_FROM", "ops@x.com")
	r := SendEmail(context.Background(), "  ", "s", "t", "")
	if r.Sent || r.Reason != "no_recipient" {
		t.Fatalf("got %+v, want no_recipient", r)
	}
}

func TestParseFrom(t *testing.T) {
	cases := []struct{ in, email, name string }{
		{"Fleet360 <ops@x.com>", "ops@x.com", "Fleet360"},
		{`"Fleet 360" <ops@x.com>`, "ops@x.com", "Fleet 360"},
		{"ops@x.com", "ops@x.com", ""},
	}
	for _, c := range cases {
		e, n := parseFrom(c.in)
		if e != c.email || n != c.name {
			t.Errorf("parseFrom(%q) = (%q,%q), want (%q,%q)", c.in, e, n, c.email, c.name)
		}
	}
}
