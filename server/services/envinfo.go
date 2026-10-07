package services

import (
	"context"
	"net"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

// EnvVar is one instance configuration value reported to the admin UI. Secrets
// are never returned in the clear: Value is a fixed mask whenever Set is true,
// so the raw secret never leaves the process.
type EnvVar struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Secret bool   `json:"secret"`
	Set    bool   `json:"set"`
	Note   string `json:"note,omitempty"`
}

// DNSState describes how the container currently resolves names: the raw
// /etc/resolv.conf, the resolvers and search/options Docker wrote into it, and
// the upstream servers Docker forwards to. Upstreams is parsed from the
// "ExtServers" comment Docker records — the effective resolvers whether they
// came from the host's resolv.conf or an explicit dns: configuration. It is the
// line to watch: an empty Upstreams list is exactly the state that makes every
// external lookup SERVFAIL.
type DNSState struct {
	ResolvConf    string   `json:"resolv_conf"`
	Nameservers   []string `json:"nameservers"`
	Upstreams     []string `json:"upstreams"`
	SearchDomains []string `json:"search_domains"`
	Options       []string `json:"options"`
}

// ResolveResult is the outcome of a live DNS lookup from inside the container.
type ResolveResult struct {
	Host       string   `json:"host"`
	OK         bool     `json:"ok"`
	Addresses  []string `json:"addresses"`
	Error      string   `json:"error,omitempty"`
	DurationMS int64    `json:"duration_ms"`
}

// EditableBlock describes the values the UI is allowed to change, together with
// the values they currently hold so the editor can prefill them without the
// client re-deriving defaults.
type EditableBlock struct {
	EnvKeys []string          `json:"env_keys"`
	Values  map[string]string `json:"values"`
	DNS     []string          `json:"dns"`
	// Active reports whether a saved override is in effect (a value was applied
	// from the UI rather than coming straight from the compose environment).
	Active bool `json:"active"`
}

// EnvironmentInfo is the read-only instance configuration report.
type EnvironmentInfo struct {
	Variables []EnvVar      `json:"variables"`
	DNS       DNSState      `json:"dns"`
	Resolve   ResolveResult `json:"resolve"`
	Editable  EditableBlock `json:"editable"`
}

// envSpec is one configuration value to surface. secret marks a value that must
// never be echoed; note is the short "what is this / why care" hint shown in the
// UI. Every key here is read from the process environment — values Compose uses
// only for interpolation (e.g. APP_PORT, NINETEEN_DNS) are not in it and are
// covered by the DNS report instead.
type envSpec struct {
	key    string
	secret bool
	note   string
}

var instanceEnvSpecs = []envSpec{
	{key: "ADDR", note: "Address the server listens on inside the container"},
	{key: "DB_PATH", note: "Path to the SQLite database"},
	{key: "STATIC_DIR", note: "Directory served for the web UI"},
	{key: "NINETEEN_REPO", note: "GitHub repo the self-update feature pulls from"},
	{key: "NINETEEN_PROJECT_BIND", note: "Interface deployed project ports bind to"},
	{key: "NINETEEN_CONTAINER", note: "Name of this container (defaults to nineteen)"},
	{key: "NINETEEN_DATA_DIR", note: "Container path of the mounted data directory"},
	{key: "NINETEEN_UPDATE_HEALTH_TIMEOUT", note: "Seconds to wait for a new container to become healthy"},
	{key: "JWT_SECRET", secret: true, note: "Signs auth tokens — rotating this logs everyone out"},
	{key: "INVITE_CODE", secret: true, note: "Code required to register the first admin"},
}

// secretMask is the placeholder sent for any secret that is set. It is a fixed
// string (never derived from the real value) so its length leaks nothing.
const secretMask = "••••••••"

// GetEnvironmentInfo reports the instance's own configuration — the environment
// variables it was started with and how it currently resolves names — without
// ever leaking secret values. host is the name probed for the live DNS test;
// empty defaults to github.com, the host the self-update clone depends on.
func GetEnvironmentInfo(host string) EnvironmentInfo {
	env := environmentMap()
	dns := readDNSState()
	cfg, active := LoadInstanceConfig(DataDirFromEnv())

	values := make(map[string]string, len(EditableEnvKeys))
	for _, k := range EditableEnvKeys {
		values[k] = env[k]
	}
	// Prefill the resolver editor with the applied override when one exists,
	// otherwise with the resolvers actually in effect.
	editableDNS := dns.Upstreams
	if active && len(cfg.DNS) > 0 {
		editableDNS = cfg.DNS
	}

	return EnvironmentInfo{
		Variables: buildEnvVars(env),
		DNS:       dns,
		Resolve:   resolveHost(host),
		Editable: EditableBlock{
			EnvKeys: EditableEnvKeys,
			Values:  values,
			DNS:     editableDNS,
			Active:  active,
		},
	}
}

// buildEnvVars projects the curated spec list onto a raw environment map,
// masking any secret that is set. It is separated from GetEnvironmentInfo so
// the masking rules are unit-testable without touching the network.
func buildEnvVars(env map[string]string) []EnvVar {
	vars := make([]EnvVar, 0, len(instanceEnvSpecs))
	for _, s := range instanceEnvSpecs {
		value, set := env[s.key]
		if s.secret && set {
			value = secretMask
		}
		vars = append(vars, EnvVar{
			Key:    s.key,
			Value:  value,
			Secret: s.secret,
			Set:    set,
			Note:   s.note,
		})
	}
	return vars
}

// environmentMap flattens os.Environ into a key/value map.
func environmentMap() map[string]string {
	env := make(map[string]string, 32)
	for _, kv := range os.Environ() {
		if i := strings.IndexByte(kv, '='); i >= 0 {
			env[kv[:i]] = kv[i+1:]
		}
	}
	return env
}

// readDNSState reads and parses the container's own /etc/resolv.conf. Docker
// generates this file with the embedded resolver (127.0.0.11) plus a comment
// recording the upstream servers it forwards to.
func readDNSState() DNSState {
	state := DNSState{
		Nameservers:   []string{},
		Upstreams:     []string{},
		SearchDomains: []string{},
		Options:       []string{},
	}
	b, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return state
	}
	state.ResolvConf = string(b)

	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "nameserver"):
			if f := strings.Fields(line); len(f) >= 2 {
				state.Nameservers = append(state.Nameservers, f[1])
			}
		case strings.HasPrefix(line, "search"):
			state.SearchDomains = append(state.SearchDomains, strings.Fields(line)[1:]...)
		case strings.HasPrefix(line, "options"):
			state.Options = append(state.Options, strings.Fields(line)[1:]...)
		case strings.HasPrefix(line, "# ExtServers:"):
			if up := parseExtServers(line); len(up) > 0 {
				state.Upstreams = up
			}
		}
	}
	return state
}

// parseExtServers extracts the hosts inside the brackets of a Docker comment
// line such as "# ExtServers: [192.168.0.1 1.1.1.1]".
func parseExtServers(line string) []string {
	i := strings.IndexByte(line, '[')
	j := strings.IndexByte(line, ']')
	if i < 0 || j <= i {
		return nil
	}
	return strings.Fields(line[i+1 : j])
}

// hostRe accepts a plausible DNS name (letters, digits, dots, hyphens). It is a
// guard against junk input, not a full DNS validator.
var hostRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$`)

// resolveHost performs a live lookup with a bounded timeout, so a hanging
// resolver surfaces as an error rather than blocking the request.
func resolveHost(host string) ResolveResult {
	host = strings.TrimSpace(host)
	if host == "" {
		host = "github.com"
	}
	res := ResolveResult{Host: host, Addresses: []string{}}
	if len(host) > 253 || !hostRe.MatchString(host) {
		res.Error = "invalid hostname"
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	start := time.Now()
	addrs, err := net.DefaultResolver.LookupHost(ctx, host)
	res.DurationMS = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	sort.Strings(addrs)
	res.OK = true
	res.Addresses = addrs
	return res
}
