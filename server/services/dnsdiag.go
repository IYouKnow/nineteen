package services

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

// dnsFailureHints are the substrings git/curl and the C library emit when name
// resolution fails. They are matched case-insensitively against captured output.
var dnsFailureHints = []string{
	"could not resolve host",
	"temporary failure in name resolution",
	"name or service not known",
	"nodename nor servname provided",
}

// IsDNSFailure reports whether text looks like a name-resolution failure.
func IsDNSFailure(text string) bool {
	lower := strings.ToLower(text)
	for _, h := range dnsFailureHints {
		if strings.Contains(lower, h) {
			return true
		}
	}
	return false
}

// resolveHint is the actionable message shown when the container cannot resolve
// the clone host, which is the failure mode that breaks GitHub/Gitea clones with
// "Could not resolve host".
func resolveHint(host string) string {
	if host == "" {
		return "the nineteen container could not resolve the repository host — check its DNS servers (dns: / NINETEEN_DNS) or the host's /etc/resolv.conf"
	}
	return fmt.Sprintf("the nineteen container could not resolve %q — check its DNS servers (dns: / NINETEEN_DNS) or the host's /etc/resolv.conf", host)
}

// cloneHost returns the hostname of a clone URL, or "" when it cannot be parsed.
func cloneHost(cloneURL string) string {
	u, err := url.Parse(cloneURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// lastNonEmptyLine returns the last non-blank line of s, used to carry git's
// own "fatal: …" line into an otherwise opaque "exit status 128" error.
func lastNonEmptyLine(s string) string {
	lines := strings.Split(s, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); l != "" {
			return l
		}
	}
	return ""
}

// proxyConfigured reports whether git may be reaching the network through a
// proxy. In that case the target host need not resolve locally, so a preflight
// DNS check would produce a false failure and is skipped.
func proxyConfigured() bool {
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if strings.TrimSpace(os.Getenv(k)) != "" {
			return true
		}
	}
	return false
}

// PreflightCloneHost resolves a clone URL's host before a clone starts so a
// name-resolution failure is reported clearly up front instead of surfacing as
// an opaque git exit. It returns nil when the host resolves, when the URL has no
// host (a local path needs no DNS), when the host is a literal IP, or when a
// proxy is configured (the resolution happens at the proxy instead).
func PreflightCloneHost(ctx context.Context, cloneURL string) error {
	host := cloneHost(cloneURL)
	if host == "" || net.ParseIP(host) != nil || proxyConfigured() {
		return nil
	}
	rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := net.DefaultResolver.LookupHost(rctx, host); err != nil {
		return fmt.Errorf("%s", resolveHint(host))
	}
	return nil
}
