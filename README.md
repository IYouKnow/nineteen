# Nineteen

Nineteen is a self-hosted project & deployment manager. Deploy and manage your
own projects from a clean web UI, with everything running on your own server
using Docker — no external platform required.

## Quick start

Install Nineteen on a fresh Debian server with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/IYouKnow/nineteen/main/install.sh | sudo bash
```

The installer installs Docker (if needed), clones the latest release, generates
`.env`, builds and starts the container, then prints the URL and invite code.
Open the URL and register the first admin using the invite code.

## Features

- **Deploy projects** from a Dockerfile or a Docker Compose file
- **Live logs** — stream a project's real-time container output
- **Resource monitoring** — live CPU and memory usage per project
- **Deployment history** — see past deploys and their status
- **Environment variables** per project, including secret values
- **Build-file overrides** — edit the Dockerfile/Compose file used for a deploy
- **GitHub integration** — connect your account, scan repositories, and pick
  the build file
- **Self-update** — update Nineteen itself from the UI (see below)
- **Access control** — invite-code registration, JWT auth, and API keys

## How it works

Nineteen runs as a single container (Go server + React UI) that talks to the
host Docker daemon through `/var/run/docker.sock`. When you deploy a project it
clones the repository, builds the image, and runs it as a container — no need to
install anything else on the host.

Each project is isolated in its own container/Compose stack. Nineteen only
manages the containers it creates, so your other workloads are untouched.

## Configuration

The installer generates `.env` for you, but you can edit it. Copy
`.env.example` to `.env` and set:

| Variable          | Required | Description                                            |
| ----------------- | -------- | ------------------------------------------------------ |
| `JWT_SECRET`      | yes      | Secret for signing auth tokens (`openssl rand -hex 32`)|
| `INVITE_CODE`     | yes      | Code needed to register the first admin                |
| `NINETEEN_REPO`   | yes      | Public GitHub repo (owner/name) hosting Nineteen       |
| `APP_PORT`        | no       | Host port to publish (default `8080`)                  |

## Self-update

Go to **Settings → Updates**. Nineteen shows its current version and checks
GitHub for new releases. When a newer version is available, click **Update
Nineteen**.

Nineteen then clones that release, rebuilds its own image, and swaps only the
`nineteen` container. Hosted projects, their volumes, networks, and data — and
`/opt/nineteen/data` — are never touched. If the new container fails its health
check, Nineteen automatically rolls back to the previous image.

To update manually, re-run the installer or run:

```bash
cd /opt/nineteen && docker compose up -d --build
```
