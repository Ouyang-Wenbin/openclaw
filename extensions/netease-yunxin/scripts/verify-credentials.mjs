/**
 * Run in a child process with stdio: 'ignore' so node-nim/Doubango logs never reach the parent.
 * Reads APPKEY, ACCID, TOKEN, OUT from env; writes JSON result to OUT and exits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, "..", "src", "sdk-client.js");
const outPath = process.env.OUT ?? "";

let result;
try {
  const { verifyNimCredentialsInternal } = await import(clientPath);
  result = await verifyNimCredentialsInternal({
    appKey: process.env.APPKEY ?? "",
    accid: process.env.ACCID ?? "",
    token: process.env.TOKEN ?? "",
  });
} catch (err) {
  result = {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  };
}
fs.writeFileSync(outPath, JSON.stringify(result), "utf8");
