//go:build !linux

package services

// readPlatformMetrics is a no-op on platforms without the /sys and statfs
// sources the Linux build reads; the related SystemInfo fields stay zero.
func readPlatformMetrics(info *SystemInfo) {}
