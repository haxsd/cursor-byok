<div align="center">

# cursor-byok · 个人修改版

基于 [leookun/cursor-byok](https://github.com/leookun/cursor-byok) 的个人分支。

[English](./README-EN.md) · [上游仓库](https://github.com/leookun/cursor-byok) · [上游文档](https://docs.leokun.cn)

</div>

![cursor-byok 仪表盘](./images/en-home-1.png)

## 关于这个仓库

本仓库是 [leookun/cursor-byok](https://github.com/leookun/cursor-byok) 的 fork，基线为上游 **v1.0.0**（提交 `3725f27`），并已同步上游 **v1.0.1**（提交 `2068ab2`）。上游是 MIT 许可的开源项目，本分支在上游基础上做了以下几处改动，供个人自用：

| 改动 | 说明 |
| --- | --- |
| 移除广告 | 删除桌面端广告位与服务端广告接口，应用不再向广告服务发起请求 |
| 价值估算改为分时计价 | 首页「价值估算」按 DeepSeek-V4.1-Flash 的高峰 / 低谷单价**逐小时**计算 |
| 语言精简 | 界面语言只保留简体中文与英文（移除葡萄牙语） |
| 更新地址 | 自动更新指向本仓库，避免被更新回上游带广告的版本 |
| 接管容错 | 同步上游 v1.0.1：终止 Cursor 失败不再中断接管流程 |
| 存储统计显示真实占用 | 同步上游 v1.0.1 的方向，但显示数据库文件的真实大小，而不是上游的调用条目数 |

除此之外，项目的功能、代码结构与上游保持一致，便于后续同步上游改动。**每处改动落在哪些文件、为什么这么改，见 [docs/changes.md](./docs/changes.md)。**

> [!NOTE]
> 上游作者在 `server/src/control/ads.rs` 中注明广告是该开源项目的唯一收入来源，并请求不要在 PR 中移除广告。本仓库是个人分支，改动仅用于自用；如果你喜欢这个项目，请到[上游仓库](https://github.com/leookun/cursor-byok)点个 Star 支持作者。

## 构建与验证

依赖：Node.js 22、Rust stable、Tauri 的系统依赖（Windows 下为 WebView2 与 MSVC 工具链）。

```bash
npm --prefix apps/desktop run check          # 前端：类型检查 + 生产构建
cargo fmt --all -- --check                   # 后端：格式
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
make build-desktop                           # 桌面端打包
```

改动经过的验证范围（类型检查、clippy、服务端测试、计价对账、币种映射）见 [docs/changes.md](./docs/changes.md#验证覆盖)。

> [!NOTE]
> **Windows 上请把仓库的行尾策略设为按原样检出**，否则 `prefix_stability` 会因为提示词模板被检出成 CRLF 而失败（`include_str!` 会把 CRLF 一起编进模板）：
>
> ```bash
> git config core.autocrlf false
> git config core.eol lf
> git checkout -- .
> ```

## 与原版保持同步

本仓库是为了长期跟进上游而建的，改动集中且互不耦合。历史是重新导入的（初始提交与上游没有共同祖先），因此不能直接 `git merge upstream/main`；同步的做法是先看清上游的变更范围，再逐文件套用：

```bash
git fetch https://github.com/leookun/cursor-byok.git main
git diff --stat <上次同步的上游提交> FETCH_HEAD    # 先看范围：改了哪些文件、增删多少行
git diff <上次同步的上游提交> FETCH_HEAD -- <文件> | git apply
```

已同步到上游 **v1.0.1**（提交 `2068ab2`），基线是上游 **v1.0.0**（提交 `3725f27`）。v1.0.0 → v1.0.1 只有两处实质改动（接管容错、存储统计），其余是版本号与 i18n 生成物。若上游改动了价格或广告相关文件，按 [docs/changes.md](./docs/changes.md) 里列出的文件逐一处理即可。

## 致谢与许可

- 原始项目：[leookun/cursor-byok](https://github.com/leookun/cursor-byok)，作者 [leookun](https://github.com/leookun)
- 上游文档：[docs.leokun.cn](https://docs.leokun.cn) · 上游社区：[Issues](https://github.com/leookun/cursor-byok/issues) · [Telegram](https://t.me/cursor_byok)
- 项目功能与支持的模型协议以上游说明为准，本仓库只记录本分支的差异。

本项目沿用上游的 [MIT 许可证](./LICENSE)。原版权归原作者所有，本分支的修改同样以 MIT 许可发布。
