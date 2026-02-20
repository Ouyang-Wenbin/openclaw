/**
 * One-off send test: init + login + send "测试" to target accid + uninit.
 * Usage (from repo root, with gateway NOT required):
 *   NETEASE_YUNXIN_APP_KEY=xxx NETEASE_YUNXIN_ACCOUNT_ID=xxx NETEASE_YUNXIN_TOKEN=xxx \
 *   pnpm exec tsx extensions/netease-yunxin/scripts/send-test.ts 453355
 * Or with message:
 *   ... tsx extensions/netease-yunxin/scripts/send-test.ts 453355 "测试"
 */
import { createNimConnection } from "../src/sdk-client.js";

const targetAccid = process.argv[2]?.trim() || "453355";
const text = process.argv[3]?.trim() || "测试";

const appKey = process.env.NETEASE_YUNXIN_APP_KEY?.trim();
const accid = process.env.NETEASE_YUNXIN_ACCOUNT_ID?.trim();
const token = process.env.NETEASE_YUNXIN_TOKEN?.trim();

if (!appKey || !accid || !token) {
  console.error("Set NETEASE_YUNXIN_APP_KEY, NETEASE_YUNXIN_ACCOUNT_ID, NETEASE_YUNXIN_TOKEN");
  process.exit(1);
}

const runtime = {
  log: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
};

async function main() {
  runtime.log(`[send-test] connecting as ${accid}, will send to ${targetAccid}: ${text}`);
  const conn = await createNimConnection({
    accountId: "default",
    appKey,
    accid,
    token,
    runtime,
    onMessage: (m) => runtime.log(`[recv] from=${m.from} text=${m.text}`),
  });
  if (!conn) {
    runtime.error("[send-test] connect failed");
    process.exit(1);
  }
  runtime.log("[send-test] connected, sending...");
  const result = await conn.sendText(targetAccid, text);
  await conn.destroy();
  if (result.ok) {
    runtime.log(`[send-test] sent ok messageId=${result.messageId ?? ""}`);
  } else {
    runtime.error(`[send-test] send failed: ${result.error ?? ""}`);
    process.exit(1);
  }
}

main().catch((err) => {
  runtime.error(String(err));
  process.exit(1);
});
