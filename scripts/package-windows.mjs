import { spawnSync } from "node:child_process";
/**
 * Build portable Windows package and NSIS installer.
 * Run on Windows: pnpm windows:installer
 * Options: --arch x64|x86, --zip (also create portable zip)
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const arch = args.includes("--arch") ? args[args.indexOf("--arch") + 1] : "x64";
const wantZip = args.includes("--zip");
const skipNodeBundle = args.includes("--skip-node-bundle");

const nodeVersion = "22.12.0";
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = pkg.version;
const nodeLabel = skipNodeBundle ? "portable" : `node-${nodeVersion}`;
const outDirName = `openclaw-win32-${arch}-${version}-${nodeLabel}`;
const outPath = path.join(repoRoot, "dist", outDirName);
const nodeDistUrl = `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-${arch}.zip`;

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: repoRoot, shell: true, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed with ${r.status}`);
  }
}

function cpRecursive(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

async function downloadNodeZip() {
  const nodeZipPath = path.join(repoRoot, "dist", `.node-v${nodeVersion}-win-${arch}.zip`);
  if (fs.existsSync(nodeZipPath)) {
    return nodeZipPath;
  }
  console.log("  Downloading Node", nodeVersion, arch + "...");
  const file = fs.createWriteStream(nodeZipPath);
  await new Promise((resolve, reject) => {
    https
      .get(nodeDistUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", reject);
  });
  return nodeZipPath;
}

async function extractNodeZip(zipPath, nodeDir) {
  const buf = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buf);
  const firstKey = Object.keys(zip.files)[0];
  const topDir = firstKey.includes("/") ? firstKey.split("/")[0] : firstKey;
  const prefix = topDir + "/";
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(prefix)) {
      continue;
    }
    const rel = name.slice(prefix.length);
    const dest = path.join(nodeDir, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async("nodebuffer"));
  }
}

function writeOpenclawCmd() {
  const cmd = skipNodeBundle
    ? `@echo off\r\nsetlocal\r\nset "SCRIPT_DIR=%~dp0"\r\nnode "%SCRIPT_DIR%openclaw.mjs" %*\r\n`
    : `@echo off\r\nsetlocal\r\nset "SCRIPT_DIR=%~dp0"\r\n"%SCRIPT_DIR%node\\node.exe" "%SCRIPT_DIR%openclaw.mjs" %*\r\n`;
  fs.writeFileSync(path.join(outPath, "openclaw.cmd"), cmd, "ascii");
}

console.log("OpenClaw Windows package (win32-" + arch + ")");
console.log("  Output:", outPath);
console.log("  Node bundle:", skipNodeBundle ? "no (use PATH)" : nodeDistUrl);

console.log("\n[1/4] Installing dependencies...");
run("pnpm", ["install"]);

console.log("[2/4] Building...");
run("pnpm", ["build"]);
run("pnpm", ["ui:build"]);

console.log("[3/4] Assembling package...");
if (fs.existsSync(outPath)) {
  fs.rmSync(outPath, { recursive: true });
}
fs.mkdirSync(outPath, { recursive: true });

const copyItems = [
  ["openclaw.mjs", "openclaw.mjs"],
  ["dist", "dist"],
  ["node_modules", "node_modules"],
  ["extensions", "extensions"],
  ["skills", "skills"],
];
if (fs.existsSync(path.join(repoRoot, "assets"))) {
  copyItems.push(["assets", "assets"]);
}

for (const [from, to] of copyItems) {
  const src = path.join(repoRoot, from);
  if (!fs.existsSync(src)) {
    console.log("  Skip (missing):", from);
    continue;
  }
  console.log("  Copy", from, "->", to);
  cpRecursive(src, path.join(outPath, to));
}

if (!skipNodeBundle) {
  const zipPath = await downloadNodeZip();
  const nodeDir = path.join(outPath, "node");
  fs.mkdirSync(nodeDir, { recursive: true });
  await extractNodeZip(zipPath, nodeDir);
}

writeOpenclawCmd();

const readme = `OpenClaw ${version} - Windows ${arch} portable package

Run (double-click or from command line):
  openclaw.cmd --help
  openclaw.cmd onboard
  openclaw.cmd gateway run

Config and data: %USERPROFILE%\\.openclaw
`;
fs.writeFileSync(path.join(outPath, "README.txt"), readme, "utf8");

console.log("[4/4] Building NSIS installer...");
const makensisPath =
  process.platform === "win32"
    ? path.join("C:", "Program Files (x86)", "NSIS", "makensis.exe")
    : "makensis";
const sourceDirNsis = outPath.replace(/\\/g, "/");
const nsiPath = path.join(repoRoot, "scripts", "nsis", "openclaw.nsi");
const r = spawnSync(
  fs.existsSync(makensisPath) ? makensisPath : "makensis",
  [`/DSOURCE_DIR=${sourceDirNsis}`, `/DVERSION=${version}`, nsiPath],
  { stdio: "inherit", cwd: repoRoot },
);
if (r.status !== 0) {
  throw new Error("makensis failed");
}

const setupExe = path.join(repoRoot, "dist", `OpenClaw-${version}-setup.exe`);
console.log("  Installer:", setupExe);

if (wantZip) {
  const zipPath = path.join(repoRoot, "dist", `openclaw-win32-${arch}-${version}.zip`);
  console.log("  Creating zip:", zipPath);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  const tr = spawnSync("tar", ["-a", "-cf", zipPath, "-C", outPath, "."], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  if (tr.status !== 0) {
    throw new Error("tar zip failed");
  }
  console.log("  Zip:", zipPath);
}

console.log("\nDone. Run the installer:", setupExe);
