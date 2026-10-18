// Curated "what's new" notes for Admin → Updates, keyed by version (the release
// tag without its leading "v").
//
// The release workflow relies on GitHub's auto-generated notes, which summarise
// merged pull requests. This project pushes commits straight to main, so every
// release body ends up as just a "Full Changelog" compare link and the panel
// would otherwise show "No notes for this release". The release text therefore
// lives here.
//
// Each entry is a list of lines for the Updates panel: a line starting with
// "## " is a section heading, a line starting with "* " is a bullet and any
// other line is a plain paragraph. Keep every item on a single line — the panel
// treats each line as its own item.

export const RELEASE_NOTES = {
  "1.1.2": [
    "## Volumes",
    "* Named volumes are aligned to the container user, so containers can write to them without permission errors",
  ],
  "1.1.1": [
    "## Deployments",
    "* The build context is detected automatically when a Dockerfile lives in a subdirectory of a monorepo",
  ],
  "1.1.0": [
    "## Environments",
    "* Environment variables are validated and reported before a deployment runs",
    "* Added an admin environment panel showing the instance's current configuration",
    "* Instance configuration can be edited and applied, recreating the container with the new settings",
    "## Networking",
    "* Added DNS configuration options so containers can resolve internal hostnames",
    "## Deployments",
    "* Multiple deployments can no longer race each other",
    "* Crash-looping containers are detected, logged and surfaced instead of failing silently",
    "* Git clone failures caused by DNS problems now report a clear, actionable error",
  ],
  "1.0.0": [
    "## Databases",
    "* Support for MySQL and MariaDB alongside PostgreSQL",
    "* Databases can be created with a one-time password, with the connection URI shown once",
    "* Added password reset for existing databases",
    "## Dashboard",
    "* Rebuilt dashboard with project and deployment metrics",
    "* Added charts for deployment activity and build duration",
    "## Integrations",
    "* Improved repository loading and error handling",
    "## Housekeeping",
    "* Reorganised admin routes and permissions",
    "* Dropped legacy region and domain settings in favour of local endpoints",
  ],
  "0.11.0": [
    "## Security",
    "* Hardened file handling against symlink traversal",
    "* Added regression tests for an IDOR issue in bulk connection creation",
    "* Added refresh tokens and improved session management",
    "* Added role assignment and user management",
    "## Volumes",
    "* Added Docker named volumes with migration support",
    "* State directory suggestions now account for image-declared volumes",
    "## Deployments",
    "* Containers can be recreated without rebuilding the image",
  ],
  "0.10.8": [
    "## Integrations",
    "* Added Gitea webhook support",
    "* Improved environment variable handling",
  ],
  "0.10.7": [
    "## Deployments",
    "* Reserved host ports are handled correctly, so deployments no longer fail on a port clash",
  ],
  "0.10.6": [
    "## Fixes",
    "* Corrected container path handling and its placeholder in the project files view",
  ],
  "0.10.5": [
    "## Deployments",
    "* Added support for a custom working directory",
    "* Project environment variables are detected and managed from the UI",
  ],
  "0.10.4": [
    "## Deployments",
    "* The Docker socket is mounted automatically for project deployments",
  ],
  "0.10.3": [
    "## Fixes",
    "* Project file uploads are streamed, so folders with many files no longer fail",
  ],
  "0.10.2": [
    "## Projects",
    "* Folder uploads preserve their relative paths",
  ],
  "0.10.1": [
    "## Projects",
    "* Added project port management",
  ],
};
