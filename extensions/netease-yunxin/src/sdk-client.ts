/**
 * NetEase Yunxin node-nim SDK wrapper (V10).
 * Initialization and login: https://doc.yunxin.163.com/messaging2/guide/zA0ODU5Mzk
 * Message收发: https://doc.yunxin.163.com/messaging2/guide/收发消息
 * Uses V2NIMClient: getMessageService().on('receiveMessages'), messageCreator.createTextMessage, sendMessage.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type NimConnection = {
  sendText(
    toAccid: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>;
  sendTeamMessage(
    teamId: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }>;
  destroy(): Promise<void>;
};

/** V2 init option (appkey required, appDataPath optional). */
type V2NIMInitOption = {
  appkey: string;
  appDataPath?: string;
  basicOption?: Record<string, unknown>;
  linkOption?: Record<string, unknown>;
  databaseOption?: Record<string, unknown>;
  fcsOption?: Record<string, unknown>;
  privateServerOption?: Record<string, unknown>;
};

/** V2NIMMessage from receiveMessages callback. P2P: receiverId=our accid; team: conversationType=2, conversationId/sessionId=teamId. */
type V2NIMMessage = {
  text?: string;
  senderId?: string;
  receiverId?: string;
  conversationId?: string;
  /** 0 single, 2 team (group) */
  conversationType?: number;
  sessionId?: string;
  /** @mention accids when present */
  mentionAccids?: string[];
  clientMsgId?: string;
  serverMsgId?: string;
  createTime?: number;
  type?: number;
};

/** node-nim 10.9.40+: V2NIMClient instance. */
type V2NIMClient = {
  init(option: V2NIMInitOption): { code?: number } | null | undefined;
  uninit(): void;
  getLoginService(): {
    /** V2 API: returns Promise<void>; option can be {} or { timeout?, retryCount? }. */
    login(accountId: string, token: string, option: Record<string, unknown>): Promise<void>;
  };
  getMessageService(): {
    on(event: "receiveMessages", cb: (messages: V2NIMMessage[]) => void): void;
    off(event: "receiveMessages", cb: (messages: V2NIMMessage[]) => void): void;
    sendMessage(
      message: unknown,
      conversationId: string,
      params: Record<string, unknown>,
      progressCb: null | ((progress: number) => void),
    ): Promise<{ message?: V2NIMMessage }>;
  } | null;
  messageCreator?: {
    createTextMessage(text: string): V2NIMMessage | null;
  } | null;
  conversationIdUtil?: {
    p2pConversationId(accountId: string): string;
    teamConversationId?(teamId: string): string;
  } | null;
};

/** node-nim module: V2NIMClient class and/or pre-created v2 instance. */
type NodeNimModule = {
  V2NIMClient?: new () => V2NIMClient;
  v2?: V2NIMClient;
};

const connectionByAccountId = new Map<string, NimConnection>();

/** Per-receiver dedupe state (module-level so it survives connection restarts). */
const dedupeByReceiver = new Map<
  string,
  { seenIds: Set<string>; recentFromText: Map<string, number>; processing: Set<string> }
>();
const DEDUPE_WINDOW_MS = 10_000;
const PROCESSING_RELEASE_MS = 100;

/** Message IDs we sent (per our accid) — skip these in receive to avoid processing our own reply echo. */
const sentMessageIdsByAccid = new Map<string, Set<string>>();
const SENT_IDS_MAX = 400;

function getDedupeState(receiverAccid: string) {
  let s = dedupeByReceiver.get(receiverAccid);
  if (!s) {
    s = { seenIds: new Set(), recentFromText: new Map(), processing: new Set() };
    dedupeByReceiver.set(receiverAccid, s);
  }
  return s;
}

function getSentIds(accid: string): Set<string> {
  let s = sentMessageIdsByAccid.get(accid);
  if (!s) {
    s = new Set();
    sentMessageIdsByAccid.set(accid, s);
  }
  return s;
}

function addSentMessageId(accid: string, id: string): void {
  const s = getSentIds(accid);
  if (!id || id.startsWith("sdk-")) return;
  s.add(id);
  if (s.size > SENT_IDS_MAX) {
    const arr = [...s];
    s.clear();
    arr.slice(-SENT_IDS_MAX >> 1).forEach((x) => s.add(x));
  }
}

export function registerNimConnection(accountId: string, conn: NimConnection): void {
  connectionByAccountId.set(accountId, conn);
}

export function unregisterNimConnection(accountId: string): void {
  connectionByAccountId.delete(accountId);
}

export function getNimConnection(accountId: string): NimConnection | undefined {
  return connectionByAccountId.get(accountId);
}

function loadV2(runtime?: { error?: (msg: string) => void }): V2NIMClient | null {
  try {
    const mod = require("node-nim") as NodeNimModule;
    if (mod.v2) {
      return mod.v2;
    }
    if (typeof mod.V2NIMClient === "function") {
      return new mod.V2NIMClient();
    }
    runtime?.error?.(
      "[netease-yunxin] node-nim loaded but V2NIMClient/v2 missing; need node-nim >= 10.9.40",
    );
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runtime?.error?.(
      `[netease-yunxin] node-nim load failed: ${msg}. ` +
        "Ensure node-nim is installed and built (native addon). " +
        "With pnpm: run `pnpm approve-builds` then `pnpm rebuild node-nim` in the extension dir.",
    );
    return null;
  }
}

/**
 * Create connection: V2 init + static token login per doc.
 * Caller must call destroy() on abort or channel stop.
 */
/** Delivered to channel: direct (P2P) or channel (group with teamId). */
export type NimInboundMessage = {
  from: string;
  text: string;
  messageId: string;
  timestamp: number;
  conversationType: "direct" | "channel";
  teamId?: string;
};

export async function createNimConnection(params: {
  accountId: string;
  appKey: string;
  accid: string;
  token: string;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  onMessage: (msg: NimInboundMessage) => void;
  statusSink?: (patch: { lastInboundAt?: number }) => void;
}): Promise<NimConnection | null> {
  const { accountId, appKey, accid, token, runtime, onMessage, statusSink } = params;
  const v2 = loadV2(runtime);
  if (!v2) return null;

  const initOption: V2NIMInitOption = {
    appkey: appKey,
    appDataPath: "",
  };
  const initResult = v2.init(initOption);
  if (initResult != null && (typeof initResult === "object" ? initResult?.code : initResult)) {
    runtime.error?.(
      `[netease-yunxin] SDK init failed; result=${JSON.stringify(initResult)}. See https://doc.yunxin.163.com/messaging2/guide/zA0ODU5Mzk`,
    );
    return null;
  }
  runtime.log?.("[netease-yunxin] SDK init ok");

  // node-nim V2 API: login(accountId, token, option) returns Promise<void>; callbacks are not used.
  const LOGIN_TIMEOUT_MS = 55_000;
  const loginService = v2.getLoginService();
  const loginPromise = loginService.login(accid, token, {});
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `login timed out after ${LOGIN_TIMEOUT_MS / 1000}s (SDK may be waiting for data sync or network)`,
          ),
        ),
      LOGIN_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([loginPromise, timeoutPromise]);
  } catch (err) {
    runtime.error?.(`[netease-yunxin] SDK login failed: ${String(err)}`);
    try {
      v2.uninit();
    } catch {
      // ignore
    }
    throw err;
  }

  runtime.log?.("[netease-yunxin] SDK login ok");

  const messageService = v2.getMessageService?.() ?? null;
  const messageCreator = v2.messageCreator ?? null;
  const conversationIdUtil = v2.conversationIdUtil ?? null;

  const dedupe = getDedupeState(accid);

  const CONVERSATION_TYPE_TEAM = 2;
  const isTeamMessage = (m: V2NIMMessage) => {
    if (Number(m.conversationType) === CONVERSATION_TYPE_TEAM) return true;
    const sid = String(m.sessionId ?? "").trim();
    const cid = String(m.conversationId ?? "").trim();
    const rid = String(m.receiverId ?? "").trim();
    if (sid && rid !== accid) return true;
    if (cid && cid !== accid && cid !== rid) return true;
    if (rid === accid && cid && cid !== accid) return true;
    return false;
  };
  /** conversationId for team is often "accid|conversationType|teamId" (e.g. 025177|2|62071378227). */
  const getTeamId = (m: V2NIMMessage) => {
    const cid = String(m.conversationId ?? "").trim();
    const sid = String(m.sessionId ?? "").trim();
    if (Number(m.conversationType) === CONVERSATION_TYPE_TEAM && cid) {
      const parts = cid.split("|");
      if (parts.length >= 3) return parts[2]!.trim();
      if (cid && cid !== sid && sid !== "-") return sid;
      return cid;
    }
    if (sid && sid !== "-") return sid;
    return cid || undefined;
  };
  const isMentioned = (m: V2NIMMessage, ourAccid: string) => {
    const mentions = m.mentionAccids;
    if (Array.isArray(mentions) && mentions.some((id) => String(id).trim() === ourAccid))
      return true;
    const t = String(m.text ?? "");
    if (
      t.includes(`@${ourAccid}`) ||
      t.includes(`@${ourAccid}\u2005`) ||
      t.includes(`@${ourAccid} `)
    )
      return true;
    if (Number(m.conversationType) === CONVERSATION_TYPE_TEAM && t.includes("@")) return true;
    return false;
  };
  const logSkip = (reason: string, m?: V2NIMMessage) => {
    if (!m) {
      runtime.log?.(`[netease-yunxin] skip: ${reason}`);
      return;
    }
    const cid = String(m.conversationId ?? "").trim();
    const sid = String(m.sessionId ?? "").trim();
    const ct = m.conversationType;
    runtime.log?.(
      `[netease-yunxin] skip: ${reason} (conversationType=${ct} sessionId=${sid || "-"} conversationId=${cid || "-"} receiverId=${String(m.receiverId ?? "").trim() || "-"} senderId=${String(m.senderId ?? "").trim() || "-"} type=${m.type} text=${String(m.text ?? "").slice(0, 40)})`,
    );
  };

  let receiveHandler: ((messages: V2NIMMessage[]) => void) | null = null;
  if (messageService?.on) {
    receiveHandler = (messages: V2NIMMessage[]) => {
      const list = messages ?? [];
      const now = Date.now();
      let accepted = 0;
      let skipped = 0;
      for (const m of list) {
        const receiverId = String(m.receiverId ?? "").trim();
        const from = String(m.senderId ?? "").trim();
        const type = Number(m.type ?? -1);
        const text = String(m.text ?? "").trim();
        const isText =
          type === 0 ||
          (text.length > 0 &&
            type !== 1 &&
            type !== 2 &&
            type !== 3 &&
            type !== 4 &&
            type !== 5 &&
            type !== 6 &&
            type !== 10);
        if (!isText) {
          logSkip("not text", m);
          skipped += 1;
          continue;
        }
        const serverId = String(m.serverMsgId ?? "").trim();
        const clientId = String(m.clientMsgId ?? "").trim();
        const messageId = serverId || clientId || `sdk-${now}`;
        const timestamp = Number(m.createTime ?? Date.now());
        if (!from) {
          logSkip("empty sender", m);
          skipped += 1;
          continue;
        }
        const team = isTeamMessage(m);
        const teamId = team ? getTeamId(m) : undefined;

        if (team) {
          if (!teamId) {
            logSkip("team but no teamId", m);
            skipped += 1;
            continue;
          }
          if (!isMentioned(m, accid)) {
            logSkip("team not @mentioned", m);
            skipped += 1;
            continue;
          }
          const teamDedupe = getDedupeState(`team:${teamId}`);
          const dedupeById = serverId || clientId;
          if (dedupeById && teamDedupe.seenIds.has(dedupeById)) {
            skipped += 1;
            continue;
          }
          if (from === accid) {
            const sentIds = getSentIds(accid);
            if ((serverId && sentIds.has(serverId)) || (clientId && sentIds.has(clientId))) {
              runtime.log?.(
                `[netease-yunxin] skip own echo (team) messageId=${serverId || clientId}`,
              );
              skipped += 1;
              continue;
            }
          }
          const fromTextKey = `team:${teamId}:${from}:${text}`;
          if (teamDedupe.processing.has(fromTextKey)) {
            skipped += 1;
            continue;
          }
          const lastAt = teamDedupe.recentFromText.get(fromTextKey);
          if (lastAt != null && now - lastAt < DEDUPE_WINDOW_MS) {
            skipped += 1;
            continue;
          }
          teamDedupe.processing.add(fromTextKey);
          if (dedupeById) teamDedupe.seenIds.add(dedupeById);
          teamDedupe.recentFromText.set(fromTextKey, now);
          setTimeout(() => teamDedupe.processing.delete(fromTextKey), PROCESSING_RELEASE_MS);
          if (teamDedupe.recentFromText.size > 200) {
            const cutoff = now - DEDUPE_WINDOW_MS * 2;
            for (const [k, t] of teamDedupe.recentFromText) {
              if (t < cutoff) teamDedupe.recentFromText.delete(k);
            }
          }
          if (teamDedupe.seenIds.size > 500) {
            const arr = [...teamDedupe.seenIds].slice(-300);
            teamDedupe.seenIds.clear();
            arr.forEach((id) => teamDedupe.seenIds.add(id));
          }
          accepted += 1;
          statusSink?.({ lastInboundAt: Date.now() });
          runtime.log?.(
            `[netease-yunxin] RECV team=${teamId} from=${from} text=${text?.slice(0, 60) ?? ""}`,
          );
          const tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
          onMessage({
            from,
            text,
            messageId,
            timestamp: tsMs,
            conversationType: "channel",
            teamId,
          });
          continue;
        }

        if (receiverId !== accid) {
          logSkip("P2P receiverId not me", m);
          skipped += 1;
          continue;
        }
        if (from === accid) {
          const sentIds = getSentIds(accid);
          if ((serverId && sentIds.has(serverId)) || (clientId && sentIds.has(clientId))) {
            runtime.log?.(`[netease-yunxin] skip own echo messageId=${serverId || clientId}`);
            skipped += 1;
            continue;
          }
        }
        const dedupeById = serverId || clientId;
        if (dedupeById && dedupe.seenIds.has(dedupeById)) {
          skipped += 1;
          continue;
        }
        const fromTextKey = `${from}:${text}`;
        if (dedupe.processing.has(fromTextKey)) {
          skipped += 1;
          continue;
        }
        const lastAt = dedupe.recentFromText.get(fromTextKey);
        if (lastAt != null && now - lastAt < DEDUPE_WINDOW_MS) {
          skipped += 1;
          continue;
        }
        dedupe.processing.add(fromTextKey);
        if (dedupeById) dedupe.seenIds.add(dedupeById);
        dedupe.recentFromText.set(fromTextKey, now);
        setTimeout(() => dedupe.processing.delete(fromTextKey), PROCESSING_RELEASE_MS);
        if (dedupe.recentFromText.size > 200) {
          const cutoff = now - DEDUPE_WINDOW_MS * 2;
          for (const [k, t] of dedupe.recentFromText) {
            if (t < cutoff) dedupe.recentFromText.delete(k);
          }
        }
        if (dedupe.seenIds.size > 500) {
          const arr = [...dedupe.seenIds].slice(-300);
          dedupe.seenIds.clear();
          arr.forEach((id) => dedupe.seenIds.add(id));
        }
        accepted += 1;
        statusSink?.({ lastInboundAt: Date.now() });
        runtime.log?.(`[netease-yunxin] RECV from=${from} text=${text?.slice(0, 80) ?? ""}`);
        const tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
        onMessage({ from, text, messageId, timestamp: tsMs, conversationType: "direct" });
      }
      if (list.length > 0) {
        runtime.log?.(
          `[netease-yunxin] receiveMessages batch=${list.length} accepted=${accepted} skipped=${skipped}`,
        );
        if (accepted === 0 && skipped > 0 && list[0]) {
          const raw = list[0];
          runtime.log?.(
            `[netease-yunxin] first message raw: conversationType=${raw.conversationType} sessionId=${String(raw.sessionId ?? "").trim() || "-"} conversationId=${String(raw.conversationId ?? "").trim() || "-"} receiverId=${String(raw.receiverId ?? "").trim() || "-"} senderId=${String(raw.senderId ?? "").trim() || "-"} type=${raw.type} mentionAccids=${JSON.stringify(raw.mentionAccids)} text=${String(raw.text ?? "").slice(0, 60)}`,
          );
        }
      }
    };
    messageService.on("receiveMessages", receiveHandler);
    runtime.log?.(`[netease-yunxin] listener registered receiver=${accid} (P2P + team @mention)`);
  }

  const sendText = async (
    toAccid: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
    if (!messageCreator?.createTextMessage || !messageService?.sendMessage || !conversationIdUtil) {
      return {
        ok: false,
        error: "V2 messageService/messageCreator/conversationIdUtil not available",
      };
    }
    try {
      const msg = messageCreator.createTextMessage(text);
      if (!msg) {
        return { ok: false, error: "createTextMessage returned null" };
      }
      const conversationId = conversationIdUtil.p2pConversationId(toAccid);
      runtime.log?.(`[netease-yunxin] SDK send to=${toAccid} text=${text?.slice(0, 50)}`);
      const SEND_TIMEOUT_MS = 25_000;
      const sendPromise = messageService.sendMessage(msg, conversationId, {}, null);
      const sendTimeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS / 1000}s`)),
          SEND_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([sendPromise, sendTimeout]);
      const outMsg = result?.message;
      const messageId = outMsg?.serverMsgId ?? outMsg?.clientMsgId ?? `sdk-${Date.now()}`;
      if (outMsg) {
        const sid = String(outMsg.serverMsgId ?? "").trim();
        const cid = String(outMsg.clientMsgId ?? "").trim();
        if (sid) addSentMessageId(accid, sid);
        if (cid) addSentMessageId(accid, cid);
      }
      runtime.log?.(`[netease-yunxin] SDK send ok`);
      return { ok: true, messageId };
    } catch (e) {
      runtime.error?.(`[netease-yunxin] SDK send failed: ${String(e)}`);
      return { ok: false, error: String(e) };
    }
  };

  const sendTeamMessage = async (
    teamId: string,
    text: string,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
    if (!messageCreator?.createTextMessage || !messageService?.sendMessage || !conversationIdUtil) {
      return {
        ok: false,
        error: "V2 messageService/messageCreator/conversationIdUtil not available",
      };
    }
    const teamConvId =
      typeof conversationIdUtil.teamConversationId === "function"
        ? conversationIdUtil.teamConversationId(teamId)
        : undefined;
    if (!teamConvId) {
      return {
        ok: false,
        error:
          "node-nim conversationIdUtil.teamConversationId(teamId) not available; need SDK support for team send",
      };
    }
    try {
      const msg = messageCreator.createTextMessage(text);
      if (!msg) {
        return { ok: false, error: "createTextMessage returned null" };
      }
      runtime.log?.(`[netease-yunxin] SDK send team=${teamId} text=${text?.slice(0, 50)}`);
      const SEND_TIMEOUT_MS = 25_000;
      const sendPromise = messageService.sendMessage(msg, teamConvId, {}, null);
      const sendTimeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS / 1000}s`)),
          SEND_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([sendPromise, sendTimeout]);
      const outMsg = result?.message;
      const messageId = outMsg?.serverMsgId ?? outMsg?.clientMsgId ?? `sdk-${Date.now()}`;
      if (outMsg) {
        const sid = String(outMsg.serverMsgId ?? "").trim();
        const cid = String(outMsg.clientMsgId ?? "").trim();
        if (sid) addSentMessageId(accid, sid);
        if (cid) addSentMessageId(accid, cid);
      }
      runtime.log?.(`[netease-yunxin] SDK send team ok`);
      return { ok: true, messageId };
    } catch (e) {
      runtime.error?.(`[netease-yunxin] SDK send team failed: ${String(e)}`);
      return { ok: false, error: String(e) };
    }
  };

  const destroy = async (): Promise<void> => {
    unregisterNimConnection(accountId);
    if (messageService?.off && receiveHandler) {
      try {
        messageService.off("receiveMessages", receiveHandler);
      } catch {
        // ignore
      }
    }
    try {
      v2.uninit();
    } catch {
      // ignore
    }
  };

  const conn: NimConnection = { sendText, sendTeamMessage, destroy };
  registerNimConnection(accountId, conn);
  runtime.log?.("[netease-yunxin] SDK connected");
  return conn;
}
