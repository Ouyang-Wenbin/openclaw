---
summary: "Windows (WSL2) support + companion app status"
read_when:
  - Installing OpenClaw on Windows
  - Looking for Windows companion app status
title: "Windows (WSL2)"
---

# Windows (WSL2)

OpenClaw on Windows is recommended **via WSL2** (Ubuntu recommended). The
CLI + Gateway run inside Linux, which keeps the runtime consistent and makes
tooling far more compatible (Node/Bun/pnpm, Linux binaries, skills). Native
Windows might be trickier. WSL2 gives you the full Linux experience — one command
to install: `wsl --install`.

Native Windows companion apps are planned.

## Install (WSL2)

- [Getting Started](/start/getting-started) (use inside WSL)
- [Install & updates](/install/updating)
- Official WSL2 guide (Microsoft): [https://learn.microsoft.com/windows/wsl/install](https://learn.microsoft.com/windows/wsl/install)

## Gateway

- [Gateway runbook](/gateway)
- [Configuration](/gateway/configuration)

## Gateway service install (CLI)

Inside WSL2:

```
openclaw onboard --install-daemon
```

Or:

```
openclaw gateway install
```

Or:

```
openclaw configure
```

Select **Gateway service** when prompted.

Repair/migrate:

```
openclaw doctor
```

## Advanced: expose WSL services over LAN (portproxy)

WSL has its own virtual network. If another machine needs to reach a service
running **inside WSL** (SSH, a local TTS server, or the Gateway), you must
forward a Windows port to the current WSL IP. The WSL IP changes after restarts,
so you may need to refresh the forwarding rule.

Example (PowerShell **as Administrator**):

```powershell
$Distro = "Ubuntu-24.04"
$ListenPort = 2222
$TargetPort = 22

$WslIp = (wsl -d $Distro -- hostname -I).Trim().Split(" ")[0]
if (-not $WslIp) { throw "WSL IP not found." }

netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort `
  connectaddress=$WslIp connectport=$TargetPort
```

Allow the port through Windows Firewall (one-time):

```powershell
New-NetFirewallRule -DisplayName "WSL SSH $ListenPort" -Direction Inbound `
  -Protocol TCP -LocalPort $ListenPort -Action Allow
```

Refresh the portproxy after WSL restarts:

```powershell
netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 `
  connectaddress=$WslIp connectport=$TargetPort | Out-Null
```

Notes:

- SSH from another machine targets the **Windows host IP** (example: `ssh user@windows-host -p 2222`).
- Remote nodes must point at a **reachable** Gateway URL (not `127.0.0.1`); use
  `openclaw status --all` to confirm.
- Use `listenaddress=0.0.0.0` for LAN access; `127.0.0.1` keeps it local only.
- If you want this automatic, register a Scheduled Task to run the refresh
  step at login.

## Step-by-step WSL2 install

### 1) Install WSL2 + Ubuntu

Open PowerShell (Admin):

```powershell
wsl --install
# Or pick a distro explicitly:
wsl --list --online
wsl --install -d Ubuntu-24.04
```

Reboot if Windows asks.

### 2) Enable systemd (required for gateway install)

In your WSL terminal:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then from PowerShell:

```powershell
wsl --shutdown
```

Re-open Ubuntu, then verify:

```bash
systemctl --user status
```

### 3) Install OpenClaw (inside WSL)

Follow the Linux Getting Started flow inside WSL:

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
openclaw onboard
```

Full guide: [Getting Started](/start/getting-started)

## Portable Windows package (x64 / x86)

You can build a **portable package** that runs on native Windows (x64 or x86) without
WSL. The package includes Node.js and the CLI; no separate Node install is required
on the target machine.

### Build from macOS (CI)

You can produce the Windows package **from your Mac** using GitHub Actions (no Windows
machine needed):

1. Push your branch and open **Actions** → **Package Windows portable**.
2. Click **Run workflow**, choose branch (e.g. `main`), optionally set **Target architecture** (`x64` or `x86`), then **Run workflow**.
3. When the job finishes, open the run and download the **openclaw-win32-portable** artifact (contains **OpenClaw-&lt;version&gt;-setup.exe** and optional zip).
4. Copy the setup exe to a Windows PC and run it to install; or use the zip for a portable folder and run `openclaw.cmd` from the extracted folder.

The workflow also runs automatically on push to `main` when relevant files change (see
`.github/workflows/package-windows.yml`). The Windows build runs on a Windows runner
so native dependencies (e.g. `sharp`, `node-pty`) are built for Windows.

### Build (on Windows)

From the repo root, install [NSIS](https://nsis.sourceforge.io/) (e.g. `choco install nsis`), then run:

```bash
pnpm windows:installer
```

This runs `scripts/package-windows.mjs`: installs dependencies, builds the app, assembles a portable folder (with embedded Node), and runs **makensis** to produce **`dist/OpenClaw-<version>-setup.exe`**.

Options (pass after the command):

- `--arch x64` (default) or `--arch x86` — target architecture.
- `--zip` — also create `dist/openclaw-win32-<arch>-<version>.zip`.
- `--skip-node-bundle` — do not embed Node; `openclaw.cmd` will use `node` from PATH (smaller package, requires Node 22+ on the target machine).

Examples:

```bash
pnpm windows:installer --zip
pnpm windows:installer --arch x86 --zip
pnpm windows:installer --skip-node-bundle
```

Output: **`dist/OpenClaw-<version>-setup.exe`** (NSIS installer). The portable folder is `dist/openclaw-win32-<arch>-<version>-node-<nodever>/` (or `-portable` if `--skip-node-bundle`), containing `openclaw.cmd`, `openclaw.mjs`, `dist/`, `node_modules/`, `extensions/`, `skills/`, and (when not using `--skip-node-bundle`) embedded `node/`. The installer copies that folder to Program Files, creates a desktop shortcut and Start menu entries, and registers an uninstaller.

### Use on the target machine

**Option A: Run the installer (recommended)**

1. Copy **`OpenClaw-<version>-setup.exe`** to the Windows PC and run it.
2. Choose install location (default: `C:\Program Files\OpenClaw`), complete the wizard.
3. A desktop shortcut **OpenClaw** and Start menu **OpenClaw** folder are created. Double-click the shortcut or run `openclaw.cmd` from the install folder.
4. Uninstall via **Settings → Apps → OpenClaw → Uninstall** or run **Uninstall OpenClaw** from the Start menu.

**Option B: Portable folder or zip**

1. Copy the folder (or unzip the package) to the Windows PC (x64 or x86 as built).
2. Run **`openclaw.cmd`** (double-click or from a terminal: `openclaw.cmd --help`, `openclaw.cmd onboard`, `openclaw.cmd gateway run`).
3. Config and data are stored under `%USERPROFILE%\.openclaw`.

## Windows companion app

We do not have a Windows companion app yet. Contributions are welcome if you want
contributions to make it happen.
