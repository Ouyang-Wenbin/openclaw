---
summary: "NetEase Yunxin IM (NIM) support status, capabilities, and configuration"
read_when:
  - Working on NetEase Yunxin IM channel features
title: "NetEase Yunxin IM"
---

# NetEase Yunxin IM (plugin)

Status: supported via plugin. Uses the **node-nim** client SDK for send and receive over a long connection. No server-side REST API or webhook required.

## Plugin required

NetEase Yunxin IM ships as a plugin.

Install via CLI (npm registry):

```bash
openclaw plugins install @openclaw/netease-yunxin
```

Local checkout (when running from a git repo):

```bash
openclaw plugins install ./extensions/netease-yunxin
```

## Configuration

Configure in `openclaw.json` under `channels.netease-yunxin`, or use environment variables for the default account.

### Config keys

| Key           | Description                                                                    |
| ------------- | ------------------------------------------------------------------------------ |
| `appKey`      | NetEase app key (from NIM console).                                            |
| `accountId`   | NIM account id (accid), used for SDK login.                                    |
| `token`       | Login token for SDK (required). See 获取静态 Token in NIM docs.                |
| `enabled`     | Enable/disable the channel (default: true).                                    |
| `allowFrom`   | Allowlist of accids for DMs (optional).                                        |
| `dmPolicy`    | `pairing` \| `allowlist` \| `open` \| `disabled` (default: pairing).           |
| `mediaMaxMb`  | Max size (MB) for downloading inbound images for the model (default: 10).      |
| `linkOption`  | Optional SDK init link options (e.g. custom link server; see Troubleshooting). |
| `basicOption` | Optional SDK init basic options (shape depends on node-nim version).           |

### Environment variables (default account only)

- `NETEASE_YUNXIN_APP_KEY`
- `NETEASE_YUNXIN_ACCOUNT_ID`
- `NETEASE_YUNXIN_TOKEN`

### Minimal config

```json
{
  "channels": {
    "netease-yunxin": {
      "enabled": true,
      "appKey": "your_app_key",
      "accountId": "your_nim_accid",
      "token": "your_login_token",
      "dmPolicy": "pairing"
    }
  }
}
```

## Sending and receiving

- **Send**: `openclaw message send --channel netease-yunxin --to <accid> --message "Hello"`. The `--to` value is the recipient's NIM accid.
- **Receive**: Plugin uses **node-nim** to log in and receive messages over a long connection. At startup you should see `[netease-yunxin] SDK connected; send and receive via long connection`.
- The plugin depends on `node-nim` (native addon). If you use pnpm and see "Ignored build scripts" for node-nim, run `pnpm approve-builds` in the repo or install the plugin with npm in the extension directory so the addon builds.

## Images

- **Inbound (receive)**: PICTURE messages (type=1) are accepted. The image URL from the message `attach` is downloaded (up to `mediaMaxMb`), saved locally, and passed to the agent so the model can understand the image. Reply can be text or media.
- **Outbound (send)**: When the agent or CLI sends media (e.g. screenshot, generated image), the plugin tries to send a real PICTURE message via node-nim `createImageMessage` (local file path). If the SDK does not support it, the message is sent as text with an "Attachment: &lt;url&gt;" link.

## Access control (DMs)

- Default: `dmPolicy = "pairing"`. Unknown senders get a pairing code.
- Approve via: `openclaw pairing approve netease-yunxin <CODE>`.
- Public DMs: `dmPolicy="open"` and `allowFrom=["*"]`.

## Troubleshooting

### VPN or system proxy (wanproxy / SOCKS / ELIFECYCLE)

If you see errors such as `Connection to host wanproxy.127.net left intact`, `[DOUBANGO INFO]: UnRegister network proxy node plugin: SOCKS...`, or `ELIFECYCLE Command failed with exit code 1` when a VPN or system proxy is enabled, the **node-nim** native SDK (or its native stack) can conflict with the proxy. The SDK may try to use or unregister a SOCKS proxy and then fail.

**Suggestions:**

1. **Bypass VPN for the gateway**: Run the OpenClaw gateway without routing its traffic through the VPN (e.g. split tunneling so the gateway process uses the direct network).
2. **Custom link server**: If your NIM app uses an overseas or custom link server, set `linkOption` (and optionally `basicOption`) in config so the SDK uses the intended server. The exact keys depend on the node-nim version; see [NIM ServerAddresses](https://doc.yunxin.163.com/docs/interface/IM_Android_EN/IM_Android/com/netease/nimlib/sdk/ServerAddresses.html) and node-nim API for link/server options.

3. **IPv6**: NetEase Yunxin supports IPv6 on the server side. If your environment has broken or slow IPv6 routing (common with some VPNs), connection issues may improve by using a link server that resolves to IPv4 or by configuring the system to prefer IPv4 for the SDK; `linkOption` can be used if the SDK exposes a way to prefer IPv4 or a specific server.
