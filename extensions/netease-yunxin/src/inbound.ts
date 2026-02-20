/**
 * Handle inbound message from NetEase Yunxin: deliver to agent and send reply back.
 */
import {
  createReplyPrefixOptions,
  logInboundDrop,
  resolveControlCommandGate,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { resolveNeteaseYunxinAccount } from "./accounts.js";
import { getNeteaseYunxinRuntime } from "./runtime.js";
import { sendMessageNeteaseYunxinWithConfig } from "./send.js";
import type { ResolvedNeteaseYunxinAccount } from "./types.js";

const CHANNEL_ID = "netease-yunxin" as const;

function normalizeAllowlist(allowFrom: (string | number)[] | undefined): string[] {
  if (!allowFrom || !Array.isArray(allowFrom)) return [];
  return allowFrom.map((e) => String(e).trim()).filter(Boolean);
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return true;
  if (allowFrom.includes("*")) return true;
  const normalized = senderId.trim().toLowerCase();
  return allowFrom.some((e) => e.trim().toLowerCase() === normalized);
}

async function deliverNeteaseYunxinReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  /** Full target: netease-yunxin:<accid> (DM) or netease-yunxin:channel:<teamId> (group). */
  to: string;
  accountId: string;
  cfg: OpenClawConfig;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, to, accountId, cfg, statusSink } = params;
  const text = payload.text ?? "";
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];
  const combined = text.trim()
    ? mediaList.length
      ? `${text.trim()}\n\n${mediaList.map((u) => `Attachment: ${u}`).join("\n")}`
      : text.trim()
    : mediaList.map((u) => `Attachment: ${u}`).join("\n");
  if (!combined.trim()) return;
  await sendMessageNeteaseYunxinWithConfig({ cfg, to, text: combined, accountId });
  statusSink?.({ lastOutboundAt: Date.now() });
}

export type NeteaseYunxinInboundMessage = {
  senderId: string;
  senderName?: string;
  text: string;
  messageId: string;
  timestamp: number;
  conversationType?: "direct" | "channel";
  teamId?: string;
};

export async function handleNeteaseYunxinInbound(params: {
  message: NeteaseYunxinInboundMessage;
  account: ResolvedNeteaseYunxinAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getNeteaseYunxinRuntime();
  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    runtime.log?.(`[netease-yunxin] inbound drop empty from=${message.senderId}`);
    return;
  }
  runtime.log?.(
    `[netease-yunxin] inbound from=${message.senderId} body=${rawBody.slice(0, 60)}${rawBody.length > 60 ? "…" : ""}`,
  );

  statusSink?.({ lastInboundAt: message.timestamp });

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = normalizeAllowlist(account.config.allowFrom);
  const storeAllowFrom = await core.channel.pairing.readAllowFromStore(CHANNEL_ID).catch(() => []);
  const storeList = normalizeAllowlist(storeAllowFrom);
  const effectiveAllowFrom = [...configAllowFrom, ...storeList].filter(Boolean);

  if (dmPolicy === "disabled") {
    runtime.log?.(`[netease-yunxin] drop DM sender=${message.senderId} (dmPolicy=disabled)`);
    return;
  }
  if (dmPolicy !== "open") {
    const allowed = isSenderAllowed(message.senderId, effectiveAllowFrom);
    if (!allowed) {
      if (dmPolicy === "pairing") {
        const { code, created } = await core.channel.pairing.upsertPairingRequest({
          channel: CHANNEL_ID,
          id: message.senderId,
          meta: { name: message.senderName },
        });
        if (created) {
          runtime.log?.(
            `[netease-yunxin] inbound pairing reply to=${message.senderId} code=${code}`,
          );
          try {
            await sendMessageNeteaseYunxinWithConfig({
              cfg: config,
              to: message.senderId,
              text: core.channel.pairing.buildPairingReply({
                channel: CHANNEL_ID,
                idLine: `Your NIM accid: ${message.senderId}`,
                code,
              }),
              accountId: account.accountId,
            });
            statusSink?.({ lastOutboundAt: Date.now() });
          } catch (err) {
            runtime.error?.(`[netease-yunxin] pairing reply failed: ${String(err)}`);
          }
        }
      }
      runtime.log?.(`[netease-yunxin] drop DM sender ${message.senderId} (dmPolicy=${dmPolicy})`);
      return;
    }
  }

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const useAccessGroups =
    (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;
  const senderAllowed = isSenderAllowed(message.senderId, effectiveAllowFrom);
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [{ configured: effectiveAllowFrom.length > 0, allowed: senderAllowed }],
    allowTextCommands,
    hasControlCommand,
  });
  if (commandGate.shouldBlock) {
    logInboundDrop({
      log: (msg) => runtime.log?.(msg),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: message.senderId,
    });
    return;
  }

  const isChannel = message.conversationType === "channel" && message.teamId;
  const replyTo = isChannel
    ? `netease-yunxin:channel:${message.teamId}`
    : `netease-yunxin:${message.senderId}`;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: isChannel
      ? { kind: "channel", id: message.teamId! }
      : { kind: "direct", id: message.senderId },
  });
  runtime.log?.(`[netease-yunxin] inbound dispatch to agent session=${route.sessionKey}`);

  const fromLabel = message.senderName ? `user:${message.senderName}` : `user:${message.senderId}`;
  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "NetEase Yunxin",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `netease-yunxin:${message.senderId}`,
    To: replyTo,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isChannel ? "channel" : "direct",
    ConversationLabel: isChannel ? `channel:${message.teamId}` : fromLabel,
    SenderName: message.senderName,
    SenderId: message.senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: replyTo,
    CommandAuthorized: commandGate.commandAuthorized,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    createIfMissing: true,
    updateLastRoute: {
      sessionKey: route.sessionKey,
      channel: CHANNEL_ID,
      to: replyTo,
      accountId: account.accountId,
    },
    onRecordError: (err) =>
      runtime.error?.(`[netease-yunxin] recordInboundSession: ${String(err)}`),
  });
  runtime.log?.(`[netease-yunxin] inbound recordInboundSession done, dispatching reply`);

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  runtime.log?.(`[netease-yunxin] inbound calling dispatchReplyWithBufferedBlockDispatcher`);
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        runtime.log?.(`[netease-yunxin] inbound deliver callback invoked to=${replyTo}`);
        const t = (payload as { text?: string }).text ?? "";
        runtime.log?.(
          `[netease-yunxin] inbound deliver reply to=${replyTo} text=${t.slice(0, 50)}`,
        );
        await deliverNeteaseYunxinReply({
          payload: payload as { text?: string; mediaUrls?: string[]; mediaUrl?: string },
          to: replyTo,
          accountId: account.accountId,
          cfg: config,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`[netease-yunxin] reply failed: ${String(err)} (${info.kind})`);
      },
    },
    replyOptions: { onModelSelected },
  });
  runtime.log?.(`[netease-yunxin] inbound dispatchReplyWithBufferedBlockDispatcher done`);
}
