<div align="center">

# cursor-byok · 个人修改版

基于 [leookun/cursor-byok](https://github.com/leookun/cursor-byok) 的个人分支。

[English](./README-EN.md) · [上游仓库](https://github.com/leookun/cursor-byok) · [上游文档](https://docs.leokun.cn)

</div>

![cursor-byok 仪表盘](./images/en-home-1.png)

## 关于这个仓库

本仓库是 [leookun/cursor-byok](https://github.com/leookun/cursor-byok) 的 fork，基线为上游 **v1.0.0**（提交 `3725f27`）。上游是 MIT 许可的开源项目，本分支在上游基础上做了以下几处改动，供个人自用：

| 改动 | 说明 |
| --- | --- |
| 移除广告 | 删除桌面端广告位与服务端广告接口，应用不再向广告服务发起请求 |
| 价值估算改为分时计价 | 首页「价值估算」按 DeepSeek-V4.1-Flash 的高峰 / 低谷单价**逐小时**计算 |
| 语言精简 | 界面语言只保留简体中文与英文（移除葡萄牙语） |
| 更新地址 | 自动更新指向本仓库，避免被更新回上游带广告的版本 |

除此之外，项目的功能、代码结构与上游保持一致，便于后续同步上游改动。

> [!NOTE]
> 上游作者在 `server/src/control/ads.rs` 中注明广告是该开源项目的唯一收入来源，并请求不要在 PR 中移除广告。本仓库是个人分支，改动仅用于自用；如果你喜欢这个项目，请到[上游仓库](https://github.com/leookun/cursor-byok)点个 Star 支持作者。

## 改动详情

### 1. 移除广告

| 位置 | 处理 |
| --- | --- |
| `apps/desktop/src/shell/ads/` | 整个目录删除（广告菜单、浮动广告、缓存与类型定义） |
| `apps/desktop/src/shell/AppLayout.tsx` | 移除广告相关的状态、定时拉取、交互回调与弹窗 |
| `apps/desktop/src/shared/api.ts` | 移除 `/promotions` 与 `/promotions/{id}/dismissals` 两个接口 |
| `server/src/control/ads.rs` | 整个文件删除（广告拉取、图片缓存、免打扰上报） |
| `server/src/control/mod.rs` | 移除三条广告路由 |

菜单里的「使用教程」入口属于功能入口，不属于广告，已保留。

### 2. 「价值估算」改为分时计价

#### 价格表

DeepSeek-V4.1-Flash 官方单价（元 / 百万 token）：

| 项目 | 低谷时段 | 高峰时段 |
| --- | --- | --- |
| 输入（缓存未命中） | ¥1.00 | ¥2.00 |
| 输入（缓存命中） | ¥0.02 | ¥0.04 |
| 输出 | ¥4.00 | ¥8.00 |
| 缓存写入 | ¥0（DeepSeek 不单独收取） | ¥0 |

时段规则：**UTC 周一至周五 01:00–04:00、06:00–10:00 为高峰期**，其余时间（含周末全天）为低谷期，低谷价为高峰价的一半。

#### 为什么按小时算

上游原来的做法是：把所选时间范围内的 token 总数，统一乘以「打开界面那一刻」所属时段的价格。这带来两个问题：

1. 同一个时间范围，在不同时间打开会得到**不同金额**；
2. 只要范围跨过峰谷分界（几乎必然跨过），金额一定是错的。

现在改为向本地服务按**小时**拉取用量分桶，每个小时用它**自己所属时段**的单价计算后求和。之所以精确：DeepSeek 的时段边界都落在整点上，服务端的分桶也严格对齐整点，因此每个分桶完整地属于某个时段，不存在归属误差。

以近 31 天的真实用量为例：逐小时精确计价约 ¥249，而旧算法在低谷期打开只会显示约 ¥162（少算约 ¥88），在高峰期打开则会偏高到约 ¥324。

#### 相关实现

| 文件 | 职责 |
| --- | --- |
| `apps/desktop/src/features/home/metrics/peakOffPeakPricing.ts` | 时段判断、逐小时计价、超长范围分段取数 |
| `apps/desktop/src/features/home/metrics/tokenCost.ts` | 价格换算、金额与单价格式化（货币符号集中在此） |
| `apps/desktop/src/features/home/metrics/HomeMetrics.tsx` | 首页「价值估算」卡片与悬浮说明 |
| `apps/desktop/src/features/settings/PricingSettingsCard.tsx` | 「Token 定价」设置卡片，支持两种计价方式 |
| `server/src/store/settings.rs` | 价格设置的持久化结构与默认值 |

设置里的「计价方式」有两种：

- **高峰 / 低谷分别计价**（默认）：填两套单价，按上面的规则逐小时计算；
- **全时段固定单价**：只填一套单价，适用于定价不分时段的模型。

界面上的货币符号统一为人民币 `¥`，如需换成其他币种，改 `tokenCost.ts` 里的 `CURRENCY_SYMBOL` 并填入对应币种的单价即可。

### 3. 语言

界面语言只保留**简体中文**与**英文**，跟随系统语言时其他语言一律回退到英文。移除了葡萄牙语词条文件与相关判断。

维护翻译的工作流：源码里的中文原文就是词条源文，新增 `t("…")` 调用后执行

```bash
npm --prefix apps/desktop run i18n:scan
```

命令会重建 `apps/desktop/src/i18n/generated/catalog.json`，并把新词条以空值补进各语言文件；随后在 `apps/desktop/src/i18n/locales/en-US.json` 中按 id 填入英文即可（id 是源文的哈希，可在 catalog.json 中按源文检索）。词条占位符必须与源文完全一致，构建时会校验。

### 4. 自动更新

自动更新地址指向本仓库（`haxsd/cursor-byok`），避免被更新回上游带广告的版本。

> [!IMPORTANT]
> 本仓库保留了上游的 Tauri 更新公钥。若要正式发布带自动更新的 Release，需要自行生成签名密钥并把公钥填回 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，否则客户端会因签名校验失败而不更新（不会报错，也不会安装任何东西）。

## 构建与验证

依赖：Node.js 22、Rust stable、Tauri 的系统依赖（Windows 下为 WebView2 与 MSVC 工具链）。

```bash
# 前端：类型检查 + 生产构建
npm --prefix apps/desktop run check

# 后端：格式、静态检查、测试
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# 桌面端打包
make build-desktop
```

本分支的改动已通过以下验证：

- `npm run check`：TypeScript 类型检查与生产构建全部通过；
- `cargo fmt --check`、`cargo clippy -D warnings`、`cargo check --workspace --all-targets` 通过；
- `cargo test -p cursor-server`：16 个测试套件、241 项测试全部通过；
- 逐小时计价与独立复算脚本对账，四项费用完全一致；
- 分桶用量之和与服务端汇总数据相等，不存在漏算。

> [!NOTE]
> **Windows 上请把仓库的行尾策略设为按原样检出**，否则 `prefix_stability` 会因为提示词模板被检出成 CRLF 而失败（`include_str!` 会把 CRLF 一起编进模板）：
>
> ```bash
> git config core.autocrlf false
> git config core.eol lf
> git checkout -- .
> ```

## 与原版保持同步

本仓库是为了长期跟进上游而建的，改动集中且互不耦合，同步上游的步骤：

```bash
git remote add upstream https://github.com/leookun/cursor-byok.git
git fetch upstream
git merge upstream/main
```

若上游同时改动了价格或广告相关文件，按「改动详情」里列出的文件逐一处理冲突即可。

## 原始项目说明（摘自上游）

cursor-byok 是一个面向 Cursor 的开源本地模型网关。它在你的机器上运行一个服务，把 Cursor 接到你自己配置的模型 API 上，并保留 Cursor Agent 的工具调用、Skills、MCP 等能力。

主要特性：

- **自带模型通道**：自行配置 API 地址、凭据与模型 ID；
- **多种协议**：OpenAI 兼容、Anthropic 兼容或自定义端点；
- **模型管理**：新增、复制、编辑、排序、批量测试；
- **连接基准**：首字耗时、生成速度、原始响应查看；
- **Agent 能力**：工具调用、Skills、MCP、多轮会话；
- **用量统计**：token 用量、缓存命中率、会话轮次与价值估算；
- **跨平台**：macOS、Windows、Linux。

```text
Cursor 客户端
    │  Agent 请求与工具结果
    ▼
cursor-byok 本地服务
    │  OpenAI / Anthropic 兼容请求
    ▼
你的模型 API
```

API 密钥与设置都保存在本地，请求仍会发送到你配置的模型服务商。

## 致谢与许可

- 原始项目：[leookun/cursor-byok](https://github.com/leookun/cursor-byok)，作者 [leookun](https://github.com/leookun)
- 上游文档：[docs.leokun.cn](https://docs.leokun.cn)
- 上游社区：[Issues](https://github.com/leookun/cursor-byok/issues) · [Telegram](https://t.me/cursor_byok)

本项目沿用上游的 [MIT 许可证](./LICENSE)。原版权归原作者所有，本分支的修改同样以 MIT 许可发布。
