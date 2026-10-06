//go:build linux

package services

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// readPlatformMetrics fills in the Linux-only host metrics: usage of the root
// filesystem and any thermal sensors exposed through /sys/class/thermal.
func readPlatformMetrics(info *SystemInfo) {
	info.DiskPath = "/"
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err == nil {
		total := st.Blocks * uint64(st.Bsize)
		free := st.Bavail * uint64(st.Bsize)
		if total > 0 {
			info.DiskTotal = total
			if free <= total {
				info.DiskUsed = total - free
			}
		}
	}
	info.Temperatures = readThermalZones()
}

// readThermalZones reads every /sys/class/thermal/thermal_zone* that exposes a
// temperature. The kernel publishes these in millidegrees Celsius.
func readThermalZones() []Temperature {
	zones, err := filepath.Glob("/sys/class/thermal/thermal_zone*")
	if err != nil {
		return []Temperature{}
	}
	out := []Temperature{}
	for _, zone := range zones {
		raw, err := os.ReadFile(filepath.Join(zone, "temp"))
		if err != nil {
			continue
		}
		milli, err := strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 64)
		if err != nil || milli <= 0 {
			continue
		}
		label := ""
		if b, err := os.ReadFile(filepath.Join(zone, "type")); err == nil {
			label = strings.TrimSpace(string(b))
		}
		if label == "" {
			label = filepath.Base(zone)
		}
		out = append(out, Temperature{Label: label, Celsius: float64(milli) / 1000})
	}
	return out
}
