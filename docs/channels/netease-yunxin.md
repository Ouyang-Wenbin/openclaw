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

| Key         | Description                                                          |
| ----------- | -------------------------------------------------------------------- |
| `appKey`    | NetEase app key (from NIM console).                                  |
| `accountId` | NIM account id (accid), used for SDK login.                          |
| `token`     | Login token for SDK (required). See 获取静态 Token in NIM docs.      |
| `enabled`   | Enable/disable the channel (default: true).                          |
| `allowFrom` | Allowlist of accids for DMs (optional).                              |
| `dmPolicy`  | `pairing` \| `allowlist` \| `open` \| `disabled` (default: pairing). |

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

## Access control (DMs)

- Default: `dmPolicy = "pairing"`. Unknown senders get a pairing code.
- Approve via: `openclaw pairing approve netease-yunxin <CODE>`.
- Public DMs: `dmPolicy="open"` and `allowFrom=["*"]`.
