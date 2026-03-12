import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getNeteaseYunxinRuntime } from "./runtime.js";
import { sendMessageNeteaseYunxinWithConfig } from "./send.js";

const OUTBOUND_MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10MB (image and file)

function extFromContentType(contentType: string | undefined): string {
  if (!contentType) return "jpg";
  const m = contentType.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

function isImageContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().startsWith("image/");
}

/** Extension for non-image file from contentType (e.g. application/pdf -> pdf). */
function fileExtFromContentType(contentType: string | undefined): string {
  if (!contentType) return "bin";
  const m = contentType.toLowerCase().split(";")[0]!.trim();
  if (m === "application/pdf") return "pdf";
  if (m === "application/msword") return "doc";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx";
  if (m === "application/vnd.ms-excel") return "xls";
  if (m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (m === "application/vnd.ms-powerpoint") return "ppt";
  if (m === "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    return "pptx";
  if (m === "text/plain") return "txt";
  const slash = m.indexOf("/");
  if (slash > 0) {
    const sub = m.slice(slash + 1);
    if (sub && !sub.includes("x-")) return sub;
  }
  return "bin";
}

export const neteaseYunxinOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getNeteaseYunxinRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId }) => {
    const result = await sendMessageNeteaseYunxinWithConfig({
      cfg,
      to,
      text,
      accountId,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Send failed");
    }
    return {
      channel: "netease-yunxin",
      messageId: result.messageId ?? "",
    };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId, mediaLocalRoots }) => {
    if (!mediaUrl) {
      const result = await sendMessageNeteaseYunxinWithConfig({
        cfg,
        to,
        text: text ?? "",
        accountId,
      });
      if (!result.ok) throw new Error(result.error ?? "Send failed");
      return { channel: "netease-yunxin", messageId: result.messageId ?? "" };
    }
    const runtime = getNeteaseYunxinRuntime();
    let tempPath: string | undefined;
    let media: { buffer: Buffer; contentType?: string };
    try {
      try {
        media = await runtime.media.loadWebMedia(mediaUrl, {
          maxBytes: OUTBOUND_MEDIA_MAX_BYTES,
          localRoots: mediaLocalRoots?.length ? [...mediaLocalRoots] : undefined,
        });
      } catch (loadErr) {
        const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        const isPathNotAllowed =
          msg.includes("not under an allowed directory") || msg.includes("path-not-allowed");
        const localPath = mediaUrl.startsWith("file://")
          ? mediaUrl.slice(mediaUrl.indexOf("file://") + 7)
          : mediaUrl;
        const normalized = path.normalize(localPath);
        const underTmp =
          normalized.startsWith(path.join(path.sep, "tmp") + path.sep) ||
          normalized === path.join(path.sep, "tmp");
        const underOsTmp = os.tmpdir() && normalized.startsWith(path.resolve(os.tmpdir()));
        if (isPathNotAllowed && path.isAbsolute(localPath) && (underTmp || underOsTmp)) {
          if (!fs.existsSync(localPath)) throw loadErr;
          const buf = fs.readFileSync(localPath);
          if (buf.length > OUTBOUND_MEDIA_MAX_BYTES) throw loadErr;
          const mime = runtime.media.detectMime?.({ buffer: buf, filePath: localPath });
          media = {
            buffer: buf,
            contentType:
              (typeof mime === "string" ? mime : undefined) ?? "application/octet-stream",
          };
        } else {
          throw loadErr;
        }
      }
      const isImage = isImageContentType(media.contentType);
      if (isImage) {
        const ext = extFromContentType(media.contentType);
        tempPath = path.join(
          os.tmpdir(),
          `openclaw-yunxin-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
        );
        fs.writeFileSync(tempPath, media.buffer);
        const meta =
          typeof runtime.media.getImageMetadata === "function"
            ? await runtime.media.getImageMetadata(media.buffer)
            : null;
        const result = await sendMessageNeteaseYunxinWithConfig({
          cfg,
          to,
          text: text ?? "",
          accountId,
          imagePath: tempPath,
          imageName: path.basename(tempPath),
          imageWidth: meta?.width,
          imageHeight: meta?.height,
        });
        if (result.ok) {
          return { channel: "netease-yunxin", messageId: result.messageId ?? "" };
        }
        // Fallback: send as text with link when createImageMessage not available
      } else {
        const ext = fileExtFromContentType(media.contentType);
        tempPath = path.join(
          os.tmpdir(),
          `openclaw-yunxin-file-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
        );
        fs.writeFileSync(tempPath, media.buffer);
        const fileName = path.basename(tempPath);
        const result = await sendMessageNeteaseYunxinWithConfig({
          cfg,
          to,
          text: text ?? "",
          accountId,
          filePath: tempPath,
          fileName,
        });
        if (result.ok) {
          return { channel: "netease-yunxin", messageId: result.messageId ?? "" };
        }
        // Fallback: send as text with link when createFileMessage not available
      }
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
    }
    const isLocalPath =
      mediaUrl.startsWith("file://") ||
      (mediaUrl.startsWith("/") && !mediaUrl.startsWith("https://"));
    const attachmentLabel = isLocalPath ? "📎 [附件]" : `Attachment: ${mediaUrl}`;
    const messageWithMedia = [text ?? "", attachmentLabel].filter(Boolean).join("\n\n").trim();
    const result = await sendMessageNeteaseYunxinWithConfig({
      cfg,
      to,
      text: messageWithMedia || "📎 [附件]",
      accountId,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Send failed");
    }
    return {
      channel: "netease-yunxin",
      messageId: result.messageId ?? "",
    };
  },
};
