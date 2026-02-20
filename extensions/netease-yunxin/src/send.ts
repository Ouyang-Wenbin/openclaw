import { resolveDefaultNeteaseYunxinAccountId, resolveNeteaseYunxinAccount } from "./accounts.js";
import { createNimConnection, getNimConnection } from "./sdk-client.js";
import type { NeteaseYunxinSendResult } from "./types.js";

function resolveAccountIdForSend(
  cfg: { channels?: Record<string, unknown> },
  accountId?: string | null,
): string {
  return accountId?.trim() || resolveDefaultNeteaseYunxinAccountId(cfg);
}

/** Strip channel prefix so SDK receives bare accid (e.g. 453355). */
function toAccid(target: string): string {
  const t = target.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith("netease-yunxin:")) return t.slice("netease-yunxin:".length).trim();
  if (lower.startsWith("nim:")) return t.slice("nim:".length).trim();
  if (lower.startsWith("yunxin:")) return t.slice("yunxin:".length).trim();
  return t;
}

/** Send via SDK. Uses existing connection if channel is running; otherwise creates a temporary connection. */
export async function sendMessageNeteaseYunxinWithConfig(params: {
  cfg: { channels?: Record<string, unknown> };
  to: string;
  text: string;
  accountId?: string | null;
}): Promise<NeteaseYunxinSendResult> {
  const accountId = resolveAccountIdForSend(params.cfg, params.accountId);
  const accid = toAccid(params.to);
  if (!accid) {
    return { ok: false, error: "Missing target accid" };
  }

  let conn = getNimConnection(accountId);
  let temporary = false;
  if (!conn) {
    const account = resolveNeteaseYunxinAccount({
      cfg: params.cfg as { channels?: Record<string, unknown> },
      accountId,
    });
    if (!account.configured || !account.appKey || !account.nimAccountId || !account.token) {
      return {
        ok: false,
        error:
          "SDK not connected and config missing. Set channels.netease-yunxin.appKey, accountId, token (or NETEASE_YUNXIN_* env) and ensure channel is running, or configure and retry.",
      };
    }
    try {
      conn = await createNimConnection({
        accountId,
        appKey: account.appKey,
        accid: account.nimAccountId,
        token: account.token,
        runtime: { log: () => {}, error: () => {} },
        onMessage: () => {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
    if (!conn) {
      return { ok: false, error: "SDK init failed" };
    }
    temporary = true;
  }

  try {
    return await conn.sendText(accid, params.text ?? "");
  } finally {
    if (temporary) {
      await conn.destroy();
    }
  }
}
