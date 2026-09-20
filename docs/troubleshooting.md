# 故障排查

## Cursor 报 `Failed to establish a socket connection to proxies: PROXY 127.0.0.1:<BYOK 代理端口>`

### 现象

提交聊天后 Cursor 报错：

```
[internal] Failed to establish a socket connection to proxies: PROXY 127.0.0.1:<端口>
```

同一时刻 `renderer.log` 中多个子系统（pricing、privacy mode、metadata sync、插件市场等）报同一条错误。此时 BYOK 本体、管理端口、证书与模型配置均正常，用 `curl` 直接测该代理端口也能连通。

### 成因

底层是 Windows 回环地址偶发 SYN 丢失或延迟。Node 的 libuv 在 Windows 上对回环地址显式关闭 SYN 重传（`src/win/tcp.c` 中 `MaxSynRetransmissions = TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS`），第一发 SYN 未被及时处理即失败，耗时约等于 `MinRto`（约 300ms）。Cursor 基于 Node/Electron，因此把一次底层抖动放大成大面积硬错误；而 `curl`（schannel）与 .NET 会重传 SYN，同样的抖动下它们表现正常，容易误判为「端口没问题」。

### 处理

1. 在 BYOK 设置页把代理端口换成另一个未被占用的端口并重启 BYOK，Cursor 的 `http.proxy` 会自动跟随。
2. 若复发，检查 Npcap 驱动状态（`Get-Service npcap`）；重载驱动（管理员执行 `sc stop npcap` / `sc start npcap`）可清掉卡住的运行时状态。
3. 自检必须用 Node 并发探测回环端口；`curl` 和 .NET 会重传 SYN，暴露不出该问题。

### 状态与注意

- 可恢复，但根因尚未最终确认（主要嫌疑是较老版本的 Npcap 与当前 Windows 版本的组合）；改端口不属于已验证的修复手段。
- 不要把 Cursor 的 `http.proxy` 指向 Clash 等外部代理来绕开该错误，那会使 BYOK 的本地接管失效。
- 详细证据链、时间线与复现步骤见本机记录（未纳入仓库）。
