<div align="center">

# cursor-byok · personal fork

A personal fork of [leookun/cursor-byok](https://github.com/leookun/cursor-byok), based on v1.0.0 and synced with v1.0.1.

[中文](./README.md) · [Upstream](https://github.com/leookun/cursor-byok) · [Upstream docs](https://docs.leokun.cn)

</div>

![cursor-byok dashboard](./images/en-home-1.png)

## What this fork changes

| Change | Notes |
| --- | --- |
| No ads | Removes the desktop ad slots and the server ad endpoints; the app stops calling the ad service |
| Hourly value estimate | The home "value estimate" uses DeepSeek-V4.1-Flash peak / off-peak prices, hour by hour |
| Fewer languages | Simplified Chinese and English only |
| Update channel | In-app updates point at this repository |
| Takeover resilience | A failed attempt to stop Cursor no longer aborts takeover (synced from upstream v1.0.1) |
| Storage shows real usage | Shows the real database file size (same direction as upstream v1.0.1) |

Everything else keeps the upstream code and structure. Which files each change touches, why, and how to build, verify and sync with upstream are documented in [docs/changes.md](./docs/changes.md).

> Upstream notes that ads are the project's only source of income. This is a personal fork; if you like the project, support the author at the [upstream repository](https://github.com/leookun/cursor-byok).

## License

Under the upstream [MIT license](./LICENSE). Original copyright stays with the upstream author; this fork's changes are released under MIT as well.
