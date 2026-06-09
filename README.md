# ZARIX LOCAL

Standalone desktop staking tool for ZARIX tokens on Solana. Single executable, runs locally, fully open source.

## What is this?

A lightweight desktop app for managing your ZARIX staking positions. It runs a local server and opens in standalone app mode (no browser tabs/URL bar) — talks directly to Solana with no backend, no accounts, no middleman.

**What you can do:**
- Stake ZARIX with 1–7 year lock periods
- Claim daily staking rewards
- Unstake after lock expiry
- Stake LP tokens in gauge pools
- Claim LP staking rewards
- View balances, voting power, network stats
- Use your own RPC endpoint (Helius, QuickNode, etc.)

## Quick Start

### Download

Grab the latest binary for your OS from [Releases](https://github.com/zarix-protocol/zarix-local/releases).

### Run

```bash
# Linux / macOS
chmod +x zarix-local
./zarix-local

# Windows — just double-click or:
zarix-local.exe
```

Opens in standalone app mode (Chrome/Edge). If no Chromium browser is found, falls back to your default browser. Connect Phantom or Jupiter wallet and you're in.

### Build from source

Requires [Rust](https://rustup.rs/) and Node.js (for the Solana JS bundle).

```bash
git clone https://github.com/zarix-protocol/zarix-local.git
cd zarix-local

chmod +x build.sh
./build.sh              # build for current platform
./build.sh linux        # cross-compile for linux x86_64
./build.sh windows      # cross-compile for windows (needs mingw-w64)
./build.sh macos        # cross-compile for macOS x86_64
./build.sh macos-arm    # cross-compile for macOS ARM (M1/M2)
./build.sh all          # all platforms
```

Binaries go to `dist/`.

## How it works

```
Standalone App Window (Chrome --app mode)
    ↕ HTTP
Rust server (actix-web, embedded frontend)
    ↕ HTTPS
Solana RPC (mainnet-beta or custom)
```

- The Rust binary embeds the frontend at compile time and serves it on `127.0.0.1:3847`
- Opens in Chrome/Edge app mode for a native desktop feel (no tabs, no URL bar)
- All Solana RPC calls go through a local proxy to avoid browser CORS issues
- Transaction signing is handled entirely by your wallet extension (Phantom/Jupiter)
- The server is stateless — nothing is stored on disk, no telemetry, no analytics
- Private keys never leave your wallet

## Wallet Support

| Wallet | Status |
|--------|--------|
| **Phantom** | ✅ Recommended |
| **Jupiter** | ✅ Supported |
| **Solflare** | ✅ Supported |

If no wallet is detected, the app shows an install prompt with direct links to the Chrome Web Store.

## Security

- **Keys** — never touched by this app. Your wallet extension handles all signing.
- **Network** — server binds to `127.0.0.1` only, not accessible from other machines
- **Origin validation** — all API endpoints verify request origin to prevent CSRF attacks
- **RPC proxy** — validates URLs, blocks private/internal IPs, HTTPS-only, no redirects
- **Storage** — stateless server. Browser stores only your RPC URL preference in localStorage
- **CSP** — Content Security Policy restricts scripts, styles, and network connections
- **No telemetry**, no auto-update, no phoning home

## On-Chain Details

| | |
|---|---|
| **Program ID** | `6uwVSD2u9FyZDPnyNPE8JeWyiwR2sy3ZexnVdfopXLVs` |
| **Token Mint** | `ukV3rKPFqaYuGMnSx9ZuShiY15aEjr2s5evf8ydHuTf` |
| **Network** | Solana Mainnet |
| **Daily Emission** | 20,000 ZARIX (halves every 730 epochs) |

## Custom RPC

Default is Solana's public RPC. For better performance and access to transaction history + LP features, set your own in ⚙️ Settings:

- [Helius](https://helius.dev) — free tier available
- [QuickNode](https://quicknode.com)

## Verify Binary

```bash
sha256sum -c SHA256SUMS.txt
```

## License

MIT — see [LICENSE](LICENSE)
