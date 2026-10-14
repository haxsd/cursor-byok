# 改动详情

本文件是 [README](../README.md) 里那张改动总表的展开：每处改动落在哪些文件、为什么这么改。
同步上游时按这里的清单逐文件处理。

## 1. 移除广告

| 位置 | 处理 |
| --- | --- |
| `apps/desktop/src/shell/ads/` | 整个目录删除（广告菜单、浮动广告、缓存与类型定义） |
| `apps/desktop/src/shell/AppLayout.tsx` | 移除广告相关的状态、定时拉取、交互回调与弹窗 |
| `apps/desktop/src/shared/api.ts` | 移除 `/promotions` 与 `/promotions/{id}/dismissals` 两个接口 |
| `server/src/control/ads.rs` | 整个文件删除（广告拉取、图片缓存、免打扰上报） |
| `server/src/control/mod.rs` | 移除三条广告路由 |

菜单里的「使用教程」入口属于功能入口，不属于广告，已保留。

## 2. 「价值估算」改为分时计价

### 价格表

DeepSeek-V4.1-Flash 官方单价，**两种币种各自一套**（都是官方公布的原价，不是按汇率折算的）：

| 项目 | 人民币 · 低谷 | 人民币 · 高峰 | 美元 · 低谷 | 美元 · 高峰 |
| --- | --- | --- | --- | --- |
| 输入（缓存未命中） | ¥1.00 | ¥2.00 | $0.15 | $0.30 |
| 输入（缓存命中） | ¥0.02 | ¥0.04 | $0.003 | $0.006 |
| 输出 | ¥4.00 | ¥8.00 | $0.60 | $1.20 |
| 缓存写入 | ¥0 | ¥0 | $0 | $0 |

（单位：每百万 token。DeepSeek 不单独收取缓存写入费用。）

**币种跟随界面语言**：简体中文界面用人民币计价，英文界面用美元计价。两种币种在设置里各自维护一套完整价格，切换语言不会互相覆盖。

时段规则：**UTC 周一至周五 01:00–04:00、06:00–10:00 为高峰期**，其余时间（含周末全天）为低谷期，低谷价为高峰价的一半。

### 为什么按小时算

上游原来的做法是：把所选时间范围内的 token 总数，统一乘以「打开界面那一刻」所属时段的价格。这带来两个问题：

1. 同一个时间范围，在不同时间打开会得到**不同金额**；
2. 只要范围跨过峰谷分界（几乎必然跨过），金额一定是错的。

现在改为向本地服务按**小时**拉取用量分桶，每个小时用它**自己所属时段**的单价计算后求和。之所以精确：DeepSeek 的时段边界都落在整点上，服务端的分桶也严格对齐整点，因此每个分桶完整地属于某个时段，不存在归属误差。

效果：跨峰谷的时间范围用旧算法会明显失真（低谷期打开偏低、高峰期打开偏高），按小时计价后与逐条用量一致。

### 相关实现

| 文件 | 职责 |
| --- | --- |
| `apps/desktop/src/features/home/metrics/peakOffPeakPricing.ts` | 时段判断、逐小时计价、超长范围分段取数 |
| `apps/desktop/src/features/home/metrics/tokenCost.ts` | 币种规则、价格换算、金额与单价格式化 |
| `apps/desktop/src/features/home/metrics/HomeMetrics.tsx` | 首页「价值估算」卡片与悬浮说明 |
| `apps/desktop/src/features/settings/PricingSettingsCard.tsx` | 「Token 定价」设置卡片，支持两种计价方式 |
| `server/src/store/settings.rs` | 价格设置的持久化结构与默认值 |

设置里的「计价方式」有两种：

- **高峰 / 低谷分别计价**（默认）：填两套单价，按上面的规则逐小时计算；
- **全时段固定单价**：只填一套单价，适用于定价不分时段的模型。

设置卡片里编辑的是**当前界面语言对应币种**的那套价格；要改另一种币种的价格，切换界面语言后再编辑即可。币种与符号的映射集中在 `tokenCost.ts` 的 `currencyOf` 与 `CURRENCY_SYMBOLS` 里。

## 3. 语言

界面语言只保留**简体中文**与**英文**，跟随系统语言时其他语言一律回退到英文。移除了葡萄牙语词条文件与相关判断。

维护翻译的工作流：源码里的中文原文就是词条源文，新增 `t("…")` 调用后执行

```bash
npm --prefix apps/desktop run i18n:scan
```

命令会重建 `apps/desktop/src/i18n/generated/catalog.json`，并把新词条以空值补进各语言文件；随后在 `apps/desktop/src/i18n/locales/en-US.json` 中按 id 填入英文即可（id 是源文的哈希，可在 catalog.json 中按源文检索）。词条占位符必须与源文完全一致，构建时会校验。

## 4. 自动更新

自动更新地址指向本仓库（`haxsd/cursor-byok`），避免被更新回上游带广告的版本。

> [!IMPORTANT]
> 发布带自动更新的 Release 时，签名私钥必须与 `apps/desktop/src-tauri/tauri.conf.json` 里的 `plugins.updater.pubkey` 配对（CI 通过 `TAURI_SIGNING_PRIVATE_KEY` 注入私钥）。两者不匹配时客户端只会校验失败：不报错，也不会安装任何东西。本仓库的更新公钥已换成自己的密钥，不再是上游那把。

## 5. 接管容错（同步上游 v1.0.1）

上游 v1.0.1 把「终止 Cursor」从接管流程的必需步骤降级为可选步骤。

| 位置 | 处理 |
| --- | --- |
| `server/src/local_app/mod.rs` | `process::terminate_cursor().await?` 改为失败只记 `tracing::warn!` 后继续 |

原因：终止 Cursor 只是让刚写入的 `http.proxy` 更快生效。Windows 上 Cursor 正在重启、被权限挡住或被占用时，终止进程会失败，原来的 `?` 就把这个可选步骤的失败升级成整个接管流程失败，用户看到的现象是代理设置没有生效。

## 6. 「存储管理」显示数据库真实大小（同步上游 v1.0.1）

上游 v1.0.1 删掉了按列长估算存储字节的 SQL，改为显示调用与追踪的条目数。本分支保留「显示大小」这个行为，但把数字换成数据库文件的真实大小：

| 位置 | 处理 |
| --- | --- |
| `server/src/store/storage.rs` | 删掉按列长求和加魔数（256 / 24 / 96 / 48）的估算，改为 `pragma_page_count()` × `pragma_page_size()`；`bytes` 等于数据库文件大小（页数 × 页大小，含空闲页） |
| `apps/desktop/src/features/settings/SettingsPage.tsx` | 数值显示为「数据库 {size}」；三路设置读取由 `Promise.all` 拆成三条独立链，任一接口失败不再让另外两块设置一直空着 |
| `apps/desktop/src/demo/api.ts` | 演示数据的清理分支与新语义一致：只清空条目，`bytes` 保持不变 |

两点注意：

- 清理统计数据只是删除记录，SQLite 会把腾出的页面放进空闲列表，文件要等 `VACUUM` 之后才会变小，所以清理后大小不变是正常的；
- 数据库开了 WAL，尚未 checkpoint 的页不计入这个数字。

## 验证覆盖

本分支的改动经过以下验证（覆盖范围，非逐项清单）：

- `npm run check`：TypeScript 类型检查与生产构建通过；
- `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings` 通过；
- 服务端测试全绿，其中新增一项断言：「存储管理」的数值来自页大小，空库也不为 0；
- 逐小时计价与独立复算脚本对账，四项费用完全一致；
- 分桶用量之和与服务端汇总数据相等，不存在漏算；
- 币种跟随语言的映射用真实模块跑过覆盖（中/英 × 币种 × 价格表 × 金额格式化）全部通过。
