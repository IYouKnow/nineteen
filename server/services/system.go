package services

import (
	"encoding/json"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

var processStart = time.Now()

// SystemInfo is a best-effort snapshot of the instance and its host. Docker
// values are empty/false when the daemon is unreachable; host memory and load
// are only populated on Linux (where /proc exists).
type SystemInfo struct {
	Version           string  `json:"version"`
	GoVersion         string  `json:"go_version"`
	OS                string  `json:"os"`
	Arch              string  `json:"arch"`
	Hostname          string  `json:"hostname"`
	UptimeSeconds     int64   `json:"uptime_seconds"`
	DockerAvailable   bool    `json:"docker_available"`
	DockerVersion     string  `json:"docker_version"`
	DockerOS          string  `json:"docker_os"`
	CPUs              int     `json:"cpus"`
	MemTotal          uint64  `json:"mem_total"`
	MemUsed           uint64  `json:"mem_used"`
	LoadAvg           float64 `json:"load_avg"`
	ContainersTotal   int     `json:"containers_total"`
	ContainersRunning int     `json:"containers_running"`
	ContainersStopped int     `json:"containers_stopped"`
	Images            int     `json:"images"`
	DiskImages        string  `json:"disk_images"`
	DiskContainers    string  `json:"disk_containers"`
	DiskVolumes       string  `json:"disk_volumes"`
	DiskBuildCache    string  `json:"disk_build_cache"`
}

// GetSystemInfo gathers runtime, Docker and host metrics. version is the
// application build version supplied by main().
func GetSystemInfo(version string) SystemInfo {
	info := SystemInfo{
		Version:       version,
		GoVersion:     runtime.Version(),
		OS:            runtime.GOOS,
		Arch:          runtime.GOARCH,
		UptimeSeconds: int64(time.Since(processStart).Seconds()),
	}
	if h, err := os.Hostname(); err == nil {
		info.Hostname = h
	}
	readDockerInfo(&info)
	readDockerDisk(&info)
	readProcMetrics(&info)
	return info
}

func readDockerInfo(info *SystemInfo) {
	out, err := exec.Command("docker", "info", "--format", "{{json .}}").Output()
	if err != nil {
		return
	}
	var di struct {
		ServerVersion     string
		OperatingSystem   string
		Architecture      string
		NCPU              int
		MemTotal          int64
		Containers        int
		ContainersRunning int
		ContainersStopped int
		Images            int
	}
	if json.Unmarshal(out, &di) != nil {
		return
	}
	info.DockerAvailable = true
	info.DockerVersion = di.ServerVersion
	info.DockerOS = strings.TrimSpace(di.OperatingSystem + " " + di.Architecture)
	info.CPUs = di.NCPU
	if di.MemTotal > 0 && info.MemTotal == 0 {
		info.MemTotal = uint64(di.MemTotal)
	}
	info.ContainersTotal = di.Containers
	info.ContainersRunning = di.ContainersRunning
	info.ContainersStopped = di.ContainersStopped
	info.Images = di.Images
}

func readDockerDisk(info *SystemInfo) {
	out, err := exec.Command("docker", "system", "df", "--format", "{{json .}}").Output()
	if err != nil {
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row struct {
			Type string
			Size string
		}
		if json.Unmarshal([]byte(line), &row) != nil {
			continue
		}
		switch strings.ToLower(row.Type) {
		case "images":
			info.DiskImages = row.Size
		case "containers":
			info.DiskContainers = row.Size
		case "local volumes", "volumes":
			info.DiskVolumes = row.Size
		case "build cache":
			info.DiskBuildCache = row.Size
		}
	}
}

func readProcMetrics(info *SystemInfo) {
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		var total, available uint64
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			val, _ := strconv.ParseUint(fields[1], 10, 64)
			switch fields[0] {
			case "MemTotal:":
				total = val * 1024
			case "MemAvailable:":
				available = val * 1024
			}
		}
		if total > 0 {
			info.MemTotal = total
			if available > 0 {
				info.MemUsed = total - available
			}
		}
	}
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
				info.LoadAvg = v
			}
		}
	}
}
