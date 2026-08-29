// Realistic, framework-aware build log generator for the terminal experience.

function t(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `[${String(m).padStart(2, "0")}:${s}]`;
}

export function generateBuildLog(framework = "node", status = "ready", repo = "acme/repo") {
  const lines = [];
  let s = 1;
  const add = (level, text, step = 1) => {
    lines.push({ time: t(s), level, text });
    s += step;
  };

  add("dim", "Resolving repository configuration...");
  add("command", `$ git clone --depth=1 --branch main https://github.com/${repo}`);
  add("info", `HEAD is now at a1b2c3d`, 2);
  add("dim", "remote: Enumerating objects: 1284, done.");
  add("info", "Receiving objects: 100% (1284/1284), 2.4 MiB | 12 MiB/s, done.", 2);
  add("info", "Installing dependencies...");
  add("command", "$ pnpm install --frozen-lockfile");
  add("dim", "Lockfile is up to date, resolution is fast");
  add("success", "✓ Installed 1248 packages in 7.4s", 3);

  switch (framework) {
    case "nextjs":
      add("info", "Running build command...");
      add("command", "$ next build");
      add("dim", "  ▲ Next.js 14.2.3", 1);
      add("info", "  Creating an optimized production build...");
      add("dim", "  Compiled successfully", 6);
      add("info", "  Collecting page data...");
      add("dim", "  Generating static pages (42/42)", 3);
      add("info", "  Finalizing page optimization...");
      add("success", "  Route (app)                              Size      First Load JS", 1);
      add("dim", "  ┌ ○ /                                   1.2 kB         88 kB", 1);
      add("dim", "  ├ ● /dashboard                          3.4 kB        142 kB", 1);
      add("dim", "  └ ● /api/health                        0 B             0 B", 1);
      add("dim", "  + First Load JS shared by all           87.1 kB", 1);
      break;
    case "vite":
      add("info", "Running build command...");
      add("command", "$ vite build");
      add("info", "  vite v5.4.2 building for production...", 1);
      add("dim", "  transforming 240 modules...", 3);
      add("success", "  ✓ built in 4.21s", 1);
      add("info", "  rendering chunks...", 1);
      add("dim", "  dist/assets/index-a8f2c1.js   142.3 kB │ gzip: 46.1 kB", 1);
      add("dim", "  dist/assets/index-9d3e44.css    8.4 kB │ gzip:  2.1 kB", 1);
      break;
    case "python":
      add("info", "Setting up Python runtime...");
      add("command", "$ pip install -r requirements.txt");
      add("dim", "  Collecting flask==3.0.0", 1);
      add("dim", "  Collecting gunicorn==21.2.0", 2);
      add("success", "  Successfully installed 18 packages", 2);
      add("info", "Running build command...");
      add("command", "$ gunicorn app:app --bind 0.0.0.0:8000");
      add("dim", "  Starting gunicorn 21.2.0", 1);
      break;
    case "docker":
      add("info", "Detecting Dockerfile...");
      add("command", "$ docker build -t app:latest .");
      add("dim", "  Step 1/12 : FROM node:20-alpine", 1);
      add("dim", "  Step 2/12 : WORKDIR /app", 1);
      add("dim", "  Step 6/12 : COPY . .", 4);
      add("dim", "  Step 12/12 : CMD [\"node\", \"server.js\"]", 3);
      add("success", "  ✓ Successfully built 9f2a1c4e", 1);
      break;
    default:
      add("info", "Running build command...");
      add("command", "$ npm run build");
      add("dim", "  > app@1.0.0 build", 1);
      add("dim", "  > tsc && node build.js", 4);
      add("success", "  Build complete", 2);
  }

  if (status === "error") {
    add("error", "✗ Build failed", 1);
    add("error", "  Error: Cannot find module './utils/helpers'", 1);
    add("dim", "  at Object.<anonymous> (src/index.ts:3:1)", 1);
    add("dim", "  at Module._compile (node:internal/modules/cjs:527:23)", 1);
    add("error", "Build process exited with code 1", 1);
    add("error", "Deployment failed — see logs above for details.");
    return lines;
  }

  if (status === "canceled") {
    add("warn", "Build canceled by user", 1);
    add("dim", "Resources released.");
    return lines;
  }

  if (status === "queued") {
    add("dim", "Waiting for available build capacity...", 1);
    add("dim", "Position in queue: 3");
    return lines;
  }

  add("info", "Building container image...");
  add("dim", "  Layer 1/8 : base image (cached)", 1);
  add("dim", "  Layer 8/8 : application bundle", 4);
  add("success", "✓ Image built in 18.2s", 1);
  add("info", "Pushing image to registry...");
  add("dim", "  sha256:9f2a…e1c4   42.1 MB", 3);
  add("info", "Allocating runtime instance...");
  add("dim", "  Starting container on fra1-7a...", 2);
  add("success", "✓ Health check passed (200 OK)", 2);
  add("success", "Deployment ready", 1);
  return lines;
}

export function levelClass(level) {
  switch (level) {
    case "command":
      return "text-info";
    case "success":
      return "text-success";
    case "error":
      return "text-destructive";
    case "warn":
      return "text-warning";
    case "dim":
      return "text-muted-foreground/50";
    default:
      return "text-foreground/80";
  }
}