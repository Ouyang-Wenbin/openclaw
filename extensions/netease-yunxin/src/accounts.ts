import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import type {
  NeteaseYunxinAccountConfig,
  NeteaseYunxinConfig,
  ResolvedNeteaseYunxinAccount,
} from "./types.js";

type CoreConfig = { channels?: Record<string, unknown> };

function mergeAccountConfig(cfg: CoreConfig, accountId: string): NeteaseYunxinAccountConfig {
  const section = (cfg.channels?.["netease-yunxin"] ?? {}) as NeteaseYunxinConfig;
  const { accounts: _a, ...base } = section;
  const account = section.accounts?.[accountId] ?? {};
  return { ...base, ...account };
}

function resolveConfig(
  merged: NeteaseYunxinAccountConfig,
  accountId: string,
): { appKey: string; nimAccountId: string; token: string } {
  const envAppKey = process.env.NETEASE_YUNXIN_APP_KEY?.trim();
  const envAccountId = process.env.NETEASE_YUNXIN_ACCOUNT_ID?.trim();
  const envToken = process.env.NETEASE_YUNXIN_TOKEN?.trim();

  const useEnv = accountId === DEFAULT_ACCOUNT_ID && (envAppKey || envAccountId || envToken);

  const appKey = useEnv ? (envAppKey ?? merged.appKey ?? "") : (merged.appKey ?? "");
  const nimAccountId = useEnv ? (envAccountId ?? merged.accountId ?? "") : (merged.accountId ?? "");
  const token = useEnv ? (envToken ?? merged.token ?? "") : (merged.token ?? "");

  return { appKey, nimAccountId, token };
}

export function listNeteaseYunxinAccountIds(cfg: CoreConfig): string[] {
  const section = (cfg.channels?.["netease-yunxin"] ?? {}) as NeteaseYunxinConfig;
  const accounts = section.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [DEFAULT_ACCOUNT_ID];
  }
  const ids = Object.keys(accounts).filter(Boolean).map(normalizeAccountId);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultNeteaseYunxinAccountId(cfg: CoreConfig): string {
  const ids = listNeteaseYunxinAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveNeteaseYunxinAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedNeteaseYunxinAccount {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultNeteaseYunxinAccountId(params.cfg),
  );
  const merged = mergeAccountConfig(params.cfg, accountId);
  const baseEnabled =
    (params.cfg.channels?.["netease-yunxin"] as { enabled?: boolean } | undefined)?.enabled !==
    false;
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  const { appKey, nimAccountId, token } = resolveConfig(merged, accountId);
  const configured = Boolean(appKey && nimAccountId && token);

  return {
    accountId,
    enabled,
    configured,
    appKey,
    nimAccountId,
    token,
    config: merged,
  };
}
