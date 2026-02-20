import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  deleteAccountFromConfigSection,
  applyAccountNameToChannelSection,
  normalizeAccountId,
} from "openclaw/plugin-sdk";
import {
  listNeteaseYunxinAccountIds,
  resolveDefaultNeteaseYunxinAccountId,
  resolveNeteaseYunxinAccount,
} from "./accounts.js";
import { NeteaseYunxinConfigSchema } from "./config-schema.js";
import { handleNeteaseYunxinInbound } from "./inbound.js";
import { neteaseYunxinOutbound } from "./outbound.js";
import { createNimConnection, getNimConnection } from "./sdk-client.js";
import type { ResolvedNeteaseYunxinAccount } from "./types.js";

const meta = {
  id: "netease-yunxin",
  label: "网易云信 IM",
  selectionLabel: "网易云信 IM (NIM)",
  docsPath: "/channels/netease-yunxin",
  docsLabel: "netease-yunxin",
  blurb: "NetEase Yunxin IM (NIM) for message send and receive.",
  aliases: ["yunxin", "nim"],
  order: 70,
};

export const neteaseYunxinPlugin: ChannelPlugin<ResolvedNeteaseYunxinAccount> = {
  id: "netease-yunxin",
  meta: { ...meta, aliases: [...meta.aliases] },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.netease-yunxin"] },
  configSchema: buildChannelConfigSchema(NeteaseYunxinConfigSchema),
  config: {
    listAccountIds: (cfg) =>
      listNeteaseYunxinAccountIds(cfg as { channels?: Record<string, unknown> }),
    resolveAccount: (cfg, accountId) =>
      resolveNeteaseYunxinAccount({
        cfg: cfg as { channels?: Record<string, unknown> },
        accountId: accountId ?? undefined,
      }),
    defaultAccountId: (cfg) =>
      resolveDefaultNeteaseYunxinAccountId(cfg as { channels?: Record<string, unknown> }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "netease-yunxin",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "netease-yunxin",
        accountId,
        clearBaseFields: ["appKey", "accountId", "token"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      nimAccountId: account.nimAccountId ? "[set]" : "[missing]",
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveNeteaseYunxinAccount({
          cfg: cfg as { channels?: Record<string, unknown> },
          accountId,
        }).config.allowFrom ?? []
      )
        .map((entry) => String(entry).trim())
        .filter(Boolean),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^netease-yunxin:/i, "").replace(/^nim:/i, "")),
  },
  pairing: {
    idLabel: "neteaseYunxinUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(netease-yunxin|yunxin|nim):/i, "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      const { sendMessageNeteaseYunxinWithConfig } = await import("./send.js");
      const { PAIRING_APPROVED_MESSAGE } = await import("openclaw/plugin-sdk");
      await sendMessageNeteaseYunxinWithConfig({ cfg, to: id, text: PAIRING_APPROVED_MESSAGE });
    },
  },
  security: {
    collectWarnings: () => [],
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "netease-yunxin",
        accountId,
        name,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const channels = (cfg.channels ?? {}) as Record<string, unknown>;
      const section = (channels["netease-yunxin"] ?? {}) as Record<string, unknown>;
      const in_ = input as Record<string, unknown>;
      const accountIdKey = normalizeAccountId(accountId);
      const nextSection: Record<string, unknown> = { ...section, enabled: true };
      if (accountIdKey === DEFAULT_ACCOUNT_ID) {
        if (in_.appKey !== undefined) nextSection.appKey = in_.appKey;
        if (in_.accountId !== undefined) nextSection.accountId = in_.accountId;
        if (in_.token !== undefined) nextSection.token = in_.token;
      } else {
        const accounts = { ...(section.accounts as Record<string, unknown> | undefined) };
        const existing = (accounts[accountIdKey] ?? {}) as Record<string, unknown>;
        accounts[accountIdKey] = {
          ...existing,
          enabled: true,
          ...(in_.appKey !== undefined && { appKey: in_.appKey }),
          ...(in_.accountId !== undefined && { accountId: in_.accountId }),
          ...(in_.token !== undefined && { token: in_.token }),
        };
        nextSection.accounts = accounts;
      }
      return {
        ...cfg,
        channels: { ...channels, "netease-yunxin": nextSection },
      } as OpenClawConfig;
    },
  },
  messaging: {
    normalizeTarget: (raw) => {
      const t = raw.trim();
      if (!t) return undefined;
      const lower = t.toLowerCase();
      if (lower.startsWith("netease-yunxin:")) return t;
      if (lower.startsWith("nim:") || lower.startsWith("yunxin:")) return t;
      return `netease-yunxin:${t}`;
    },
    targetResolver: {
      looksLikeId: (raw) => raw.trim().length > 0,
      hint: "<accid>",
    },
  },
  outbound: neteaseYunxinOutbound,
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    buildChannelSummary: ({ snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({ accountId: ctx.accountId });
      const account = resolveNeteaseYunxinAccount({
        cfg: ctx.cfg as { channels?: Record<string, unknown> },
        accountId: ctx.accountId,
      });
      const statusSink = (patch: { lastInboundAt?: number }) =>
        ctx.setStatus({ accountId: ctx.accountId, ...patch });

      if (!account.configured || !account.token?.trim()) {
        ctx.log?.error(
          "[netease-yunxin] SDK requires appKey, accountId, token; channel not started",
        );
        return;
      }

      let nimConn: Awaited<ReturnType<typeof createNimConnection>>;
      try {
        nimConn = await createNimConnection({
          accountId: ctx.accountId,
          appKey: account.appKey,
          accid: account.nimAccountId,
          token: account.token,
          runtime: ctx.runtime,
          statusSink,
          onMessage: (msg) => {
            void handleNeteaseYunxinInbound({
              message: {
                senderId: msg.from,
                text: msg.text,
                messageId: msg.messageId,
                timestamp: msg.timestamp,
              },
              account,
              config: ctx.cfg,
              runtime: ctx.runtime,
              statusSink,
            }).catch((err) => ctx.runtime.error(`[netease-yunxin] inbound failed: ${String(err)}`));
          },
        });
      } catch (err) {
        ctx.log?.error(`[netease-yunxin] SDK connect failed: ${String(err)}`);
        return;
      }
      if (!nimConn) {
        ctx.log?.error("[netease-yunxin] SDK init failed; channel not started");
        return;
      }
      ctx.log?.info("[netease-yunxin] SDK connected; send and receive via long connection");

      // Return a promise that stays pending until abort; prevents gateway auto-restart loop.
      const runUntilAbort = new Promise<void>((resolve) => {
        const onAbort = () => {
          ctx.abortSignal.removeEventListener("abort", onAbort);
          void nimConn.destroy().then(
            () => resolve(),
            () => resolve(),
          );
        };
        ctx.abortSignal.addEventListener("abort", onAbort);
        if (ctx.abortSignal.aborted) {
          void nimConn.destroy().then(
            () => resolve(),
            () => resolve(),
          );
        }
      });
      return runUntilAbort;
    },
    stopAccount: async (ctx) => {
      const conn = getNimConnection(ctx.accountId);
      if (conn) {
        await conn.destroy();
      }
    },
  },
};
