<div align="center">

# cursor-byok · personal fork

A personal fork of [leookun/cursor-byok](https://github.com/leookun/cursor-byok).

[中文说明](./README.md) · [Upstream repository](https://github.com/leookun/cursor-byok) · [Upstream docs](https://docs.leokun.cn)

</div>

![cursor-byok dashboard](./images/en-home-1.png)

## About this repository

This repository is a fork of [leookun/cursor-byok](https://github.com/leookun/cursor-byok), based on upstream **v1.0.0** (commit `3725f27`), with upstream **v1.0.1** (commit `2068ab2`) folded in. Upstream is an MIT-licensed open-source project. This fork makes the following changes for personal use:

| Change | Description |
| --- | --- |
| Ads removed | The desktop ad slots and the server-side ad endpoints are gone; the app no longer talks to the ad service |
| Value estimate uses time-of-day pricing | The home page "value estimate" is priced hour by hour with DeepSeek-V4.1-Flash peak / off-peak rates |
| Languages trimmed | Only Simplified Chinese and English remain (Portuguese removed) |
| Update endpoint | Auto-update points at this fork so the app is not updated back into an ad-carrying upstream build |
| Takeover tolerates a stuck Cursor | From upstream v1.0.1: failing to terminate Cursor no longer aborts the takeover |
| Storage reports real usage | Follows upstream v1.0.1's direction but shows the real database file size instead of upstream's row counts |

Everything else keeps upstream's behavior and code structure, which makes future upstream syncs straightforward. **Which files each change touches, and why, is documented in [docs/changes.md](./docs/changes.md) (Chinese).**

> [!NOTE]
> The upstream author notes in `server/src/control/ads.rs` that ads are the project's only source of income and asks that they not be removed in pull requests. This is a personal fork and the change is for private use only. If you like the project, please star the [upstream repository](https://github.com/leookun/cursor-byok).

## Build and verify

Requirements: Node.js 22, Rust stable, and Tauri's platform prerequisites (WebView2 and the MSVC toolchain on Windows).

```bash
npm --prefix apps/desktop run check          # frontend typecheck + production build
cargo fmt --all -- --check                   # rust formatting
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
make build-desktop                           # package the desktop app
```

The verification this fork went through (typecheck, clippy, server tests, pricing cross-check, currency mapping) is listed in [docs/changes.md](./docs/changes.md#验证覆盖) (Chinese).

> [!NOTE]
> **On Windows, check the repository out without line-ending conversion**, otherwise `prefix_stability` fails because the prompt template is checked out with CRLF (`include_str!` bakes the CRLF into the template):
>
> ```bash
> git config core.autocrlf false
> git config core.eol lf
> git checkout -- .
> ```

## Syncing with upstream

This fork exists to track upstream over the long run, with changes kept small and independent. Its history was re-imported, so the initial commit shares no ancestor with upstream and `git merge upstream/main` does not work. Sync by inspecting what upstream changed and applying it file by file:

```bash
git fetch https://github.com/leookun/cursor-byok.git main
git diff --stat <last synced upstream commit> FETCH_HEAD    # see the scope first
git diff <last synced upstream commit> FETCH_HEAD -- <file> | git apply
```

Synced up to upstream **v1.0.1** (commit `2068ab2`); the baseline is upstream **v1.0.0** (commit `3725f27`). Between them there are only two behavioural changes (takeover tolerance, storage accounting); everything else is version numbers and generated i18n files. Files touched by pricing or ads still need to be resolved by hand, following the list in [docs/changes.md](./docs/changes.md).

## Credits and license

- Original project: [leookun/cursor-byok](https://github.com/leookun/cursor-byok) by [leookun](https://github.com/leookun)
- Upstream docs: [docs.leokun.cn](https://docs.leokun.cn) · Upstream community: [Issues](https://github.com/leookun/cursor-byok/issues) · [Telegram](https://t.me/cursor_byok)
- Features and supported model protocols are documented upstream; this repository only records what this fork changes.

Released under the upstream [MIT License](./LICENSE). Copyright remains with the original author; modifications in this fork are released under the same license.
