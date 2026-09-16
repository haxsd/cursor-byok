<div align="center">

# cursor-byok · personal fork

A personal fork of [leookun/cursor-byok](https://github.com/leookun/cursor-byok).

[中文说明](./README.md) · [Upstream repository](https://github.com/leookun/cursor-byok) · [Upstream docs](https://docs.leokun.cn)

</div>

![cursor-byok dashboard](./images/en-home-1.png)

## About this repository

This repository is a fork of [leookun/cursor-byok](https://github.com/leookun/cursor-byok), based on upstream **v1.0.0** (commit `3725f27`). Upstream is an MIT-licensed open-source project. This fork makes the following changes for personal use:

| Change | Description |
| --- | --- |
| Ads removed | The desktop ad slots and the server-side ad endpoints are gone; the app no longer talks to the ad service |
| Value estimate uses time-of-day pricing | The home page "value estimate" is priced hour by hour with DeepSeek-V4.1-Flash peak / off-peak rates |
| Languages trimmed | Only Simplified Chinese and English remain (Portuguese removed) |
| Update endpoint | Auto-update points at this fork so the app is not updated back into an ad-carrying upstream build |

Everything else keeps upstream's behavior and code structure, which makes future upstream syncs straightforward.

> [!NOTE]
> The upstream author notes in `server/src/control/ads.rs` that ads are the project's only source of income and asks that they not be removed in pull requests. This is a personal fork and the change is for private use only. If you like the project, please star the [upstream repository](https://github.com/leookun/cursor-byok).

## What changed

### 1. Ads removed

- `apps/desktop/src/shell/ads/` — deleted (ad menu, floating ad, cache, types)
- `apps/desktop/src/shell/AppLayout.tsx` — ad state, polling, callbacks and dialogs removed
- `apps/desktop/src/shared/api.ts` — `/promotions` endpoints removed
- `server/src/control/ads.rs` — deleted (ad fetch, image cache, dismissal reporting)
- `server/src/control/mod.rs` — the three ad routes removed

The "user guide" entry in the sidebar is a feature entry point, not an ad, so it is kept.

### 2. Time-of-day pricing for the value estimate

DeepSeek-V4.1-Flash rates, **one price list per currency** (both are the official published prices, not converted at an exchange rate):

| Item | CNY off-peak | CNY peak | USD off-peak | USD peak |
| --- | --- | --- | --- | --- |
| Input (cache miss) | ¥1.00 | ¥2.00 | $0.15 | $0.30 |
| Input (cache hit) | ¥0.02 | ¥0.04 | $0.003 | $0.006 |
| Output | ¥4.00 | ¥8.00 | $0.60 | $1.20 |
| Cache write | ¥0 | ¥0 | $0 | $0 |

(Per million tokens. DeepSeek does not bill cache writes separately.)

**The currency follows the interface language**: the Simplified Chinese UI prices in CNY, the English UI prices in USD. Both price lists are stored independently, so switching languages never overwrites the other one.

Peak hours are **01:00–04:00 and 06:00–10:00 UTC, Monday to Friday**. All other times (including weekends) are off-peak at half the peak rate.

Upstream multiplied the total token count of the selected range by whatever period happened to be active when the window was opened, so the same range produced different totals at different times of day, and any range crossing a boundary was wrong. This fork fetches hourly usage buckets from the local service and prices each hour with the rates of the period that hour belongs to. Because DeepSeek's boundaries fall on the hour and the service aligns its buckets to the hour as well, every bucket belongs entirely to one period — the result is exact.

For the last 31 days of real usage: hour-accurate pricing gives about ¥249, while the old approach showed about ¥162 when opened during off-peak (understating by ~¥88) and about ¥324 during peak.

Relevant files:

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/features/home/metrics/peakOffPeakPricing.ts` | Period rules, hourly pricing, chunked fetching for long ranges |
| `apps/desktop/src/features/home/metrics/tokenCost.ts` | Currency rules, token-to-cost conversion and formatting |
| `apps/desktop/src/features/home/metrics/HomeMetrics.tsx` | The "value estimate" card and its tooltip |
| `apps/desktop/src/features/settings/PricingSettingsCard.tsx` | The "Token pricing" settings card with both modes |
| `server/src/store/settings.rs` | Persisted pricing shape and defaults |

The settings card offers two modes: **peak / off-peak pricing** (default, two sets of rates) and **fixed pricing** (a single set, for models billed uniformly).

The card edits the price list of the currency that matches the current interface language; switch the language to edit the other one. The language-to-currency mapping lives in `currencyOf` and `CURRENCY_SYMBOLS` in `tokenCost.ts`.

### 3. Languages

Only Simplified Chinese and English are available. Other system languages fall back to English. The Portuguese locale file and its detection logic were removed.

### 4. Auto-update

The update endpoint now points at `haxsd/cursor-byok` instead of upstream.

> [!IMPORTANT]
> This fork keeps upstream's Tauri updater public key. To publish signed releases with working auto-update, generate your own key pair, put the public key into `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json`, and sign builds with the private key. Until then the update check fails signature verification and simply installs nothing.

## Build and verify

Requirements: Node.js 22, Rust stable, and Tauri's platform prerequisites (WebView2 and the MSVC toolchain on Windows).

```bash
npm --prefix apps/desktop run check          # frontend typecheck + production build
cargo fmt --all -- --check                   # rust formatting
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
make build-desktop                           # package the desktop app
```

Verification performed on this fork:

- `npm run check` passes (typecheck + production build);
- `cargo fmt --check`, `cargo clippy -D warnings` and `cargo check --workspace --all-targets` pass;
- `cargo test -p cursor-server` passes all 242 tests across 16 suites;
- the hourly pricing was cross-checked against an independent implementation with all four cost components matching exactly;
- the sum of the usage buckets equals the aggregate figures returned by the service, so nothing is dropped;
- the language-to-currency mapping was exercised against the real module with 14 assertions (zh/en × currency × price list × money formatting), all passing.

## Publishing installers

This repository is wired to GitHub Actions: **pushing a tag builds and publishes the Windows installer automatically**.

```bash
# 1. set the same version in all three files
#    apps/desktop/package.json
#    apps/desktop/src-tauri/Cargo.toml
#    apps/desktop/src-tauri/tauri.conf.json

# 2. commit, push, then tag (the tag must be v<version>)
git tag v1.0.1
git push origin v1.0.1
```

The release then appears on the Releases page with:

| Asset | Description |
| --- | --- |
| `Cursor BYOK_<version>_x64-setup.exe` | NSIS installer, double-click to install |
| `cursor-byok-<version>-windows-amd64.zip` | Portable build, unzip and run (a single `cursor-byok-desktop.exe`) |
| `latest.json` / `portable-latest.json` | Manifests used by the in-app update check |

To validate a build without publishing, run the `Release desktop app` workflow manually from the Actions tab; it only produces workflow artifacts.

The workflow builds Windows only. To add macOS / Linux, restore the corresponding `matrix` entries and platform steps in `.github/workflows/release.yml` (upstream's `release.yml` is the reference).

Signing: update packages are signed with this fork's own key. The private key lives in the repository's Actions secrets and the public key in `plugins.updater.pubkey` in `tauri.conf.json`. **Back up the private key and its password** — without them no further update package can be signed (see the notes under `.tauri/`).

## Syncing with upstream

```bash
git remote add upstream https://github.com/leookun/cursor-byok.git
git fetch upstream
git merge upstream/main
```

Conflicts are limited to the files listed in "What changed".

## Upstream project

cursor-byok is an open-source local model gateway for Cursor. It runs a service on your machine, routes model requests through providers you configure, and preserves Cursor Agent capabilities such as tool calling, Skills and MCP. It supports OpenAI- and Anthropic-compatible endpoints, model management, connection benchmarks, usage metrics, and runs on macOS, Windows and Linux.

```text
Cursor client
    │  Agent requests and tool results
    ▼
cursor-byok local service
    │  OpenAI / Anthropic compatible requests
    ▼
Your model API
```

API keys and settings are stored locally; requests are still sent to the provider you configure.

## Credits and license

- Original project: [leookun/cursor-byok](https://github.com/leookun/cursor-byok) by [leookun](https://github.com/leookun)
- Upstream docs: [docs.leokun.cn](https://docs.leokun.cn)
- Upstream community: [Issues](https://github.com/leookun/cursor-byok/issues) · [Telegram](https://t.me/cursor_byok)

Released under the upstream [MIT License](./LICENSE). Copyright remains with the original author; modifications in this fork are released under the same license.
