package services

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"

	"nineteen-server/db"
)

// RuntimeLogEvent is a single runtime line broadcast over SSE. ID is the
// persisted row id so clients can de-duplicate against history.
type RuntimeLogEvent struct {
	ID        int64  `json:"id"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Container string `json:"container"`
	Timestamp string `json:"timestamp"`
}

type tailer struct {
	containerID string
	cancel      context.CancelFunc
}

// RuntimeManager owns one `docker logs -f` tail per running container and
// fans lines out to SSE subscribers per project.
type RuntimeManager struct {
	mu      sync.Mutex
	tailers map[string]*tailer                     // by container name
	subs    map[int64]map[chan RuntimeLogEvent]struct{} // by project id
}

var runtimeMgr = &RuntimeManager{
	tailers: map[string]*tailer{},
	subs:    map[int64]map[chan RuntimeLogEvent]struct{}{},
}

// ResolveContainer returns the container name to tail for a project. The
// Dockerfile path always uses nineteen-<slug>. Compose stacks use generated
// names, so we best-match the first running container with that prefix.
func ResolveContainer(slug, buildStrategy string) string {
	name := "nineteen-" + slug
	if buildStrategy != "compose" {
		return name
	}
	out, err := exec.Command("docker", "ps", "--filter", "name="+name, "--format", "{{.Names}}").Output()
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return ""
	}
	return strings.Split(fields[0], ",")[0]
}

// EnsureTailed makes sure a tailer is running for the given container,
// restarting it if a redeploy produced a new container id.
func EnsureTailed(projectID, deploymentID int64, container string) {
	runtimeMgr.ensureTailed(projectID, deploymentID, container)
}

// SubscribeStream registers an SSE subscriber for a project and returns the
// channel plus an unsubscribe function.
func SubscribeStream(projectID int64) (<-chan RuntimeLogEvent, func()) {
	return runtimeMgr.subscribe(projectID)
}

func (m *RuntimeManager) ensureTailed(projectID, deploymentID int64, container string) {
	if container == "" {
		return
	}
	id, err := containerID(container)
	if err != nil || id == "" {
		return // nothing running yet
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if t, ok := m.tailers[container]; ok && t.containerID == id {
		return // already tailing the live container
	}
	if t, ok := m.tailers[container]; ok {
		t.cancel() // stop the old tailer (stale container)
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.tailers[container] = &tailer{containerID: id, cancel: cancel}
	go m.tailLoop(ctx, projectID, deploymentID, container)
}

func (m *RuntimeManager) tailLoop(ctx context.Context, projectID, deploymentID int64, container string) {
	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", "-t", "--tail", "300", container)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}

	var wg sync.WaitGroup
	consume := func(r io.Reader, level string) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			ts, msg := splitDockerLog(sc.Text())
			insertAndBroadcast(m, projectID, deploymentID, container, level, ts, msg)
		}
	}
	wg.Add(2)
	go consume(stdout, "info")
	go consume(stderr, "error")
	wg.Wait()

	_ = cmd.Wait()
	m.markDone(container)
}

func (m *RuntimeManager) markDone(container string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.tailers, container)
}

func (m *RuntimeManager) subscribe(projectID int64) (<-chan RuntimeLogEvent, func()) {
	ch := make(chan RuntimeLogEvent, 512)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.subs[projectID] == nil {
		m.subs[projectID] = map[chan RuntimeLogEvent]struct{}{}
	}
	m.subs[projectID][ch] = struct{}{}

	unsub := func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if set, ok := m.subs[projectID]; ok {
			delete(set, ch)
			if len(set) == 0 {
				delete(m.subs, projectID)
			}
		}
	}
	return ch, unsub
}

func (m *RuntimeManager) broadcast(projectID int64, ev RuntimeLogEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for ch := range m.subs[projectID] {
		select {
		case ch <- ev:
		default:
		}
	}
}

// splitDockerLog parses a `docker logs -t` line ("<RFC3339> <message>") and
// returns the parsed time + message, or now() as a fallback for bare lines.
func splitDockerLog(line string) (time.Time, string) {
	if i := strings.IndexByte(line, ' '); i > 0 {
		if ts, err := time.Parse(time.RFC3339Nano, line[:i]); err == nil {
			return ts, strings.TrimRight(line[i+1:], "\r")
		}
	}
	return time.Now(), strings.TrimRight(line, "\r")
}

func insertAndBroadcast(m *RuntimeManager, projectID, deploymentID int64, container, level string, ts time.Time, msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	stamp := ts.UTC().Format("2006-01-02 15:04:05")
	res, err := db.DB.Exec(
		"INSERT INTO runtime_logs (project_id, deployment_id, container, level, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
		projectID, deploymentID, container, level, msg, stamp,
	)
	if err != nil {
		return
	}
	id, _ := res.LastInsertId()
	m.broadcast(projectID, RuntimeLogEvent{
		ID:        id,
		Level:     level,
		Message:   msg,
		Container: container,
		Timestamp: ts.UTC().Format(time.RFC3339Nano),
	})
}

func containerID(name string) (string, error) {
	out, err := exec.Command("docker", "ps", "--filter", "name=^/"+name+"$", "-q").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
