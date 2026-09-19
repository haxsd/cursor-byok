import { useEffect } from "react";
import { Card } from "../../shared/ui/Card";
import { PageContent } from "../../shell/layout/PageContent";
import { appStore, useAppStore } from "../../shared/store/appStore";
import type { DiagnosticRecord } from "../../shared/api";
import styles from "./DiagnosticsPage.module.scss";

const REFRESH_INTERVAL_MS = 2_000;

function diagnosisCopy(category: string) {
  switch (category) {
    case "authentication":
      return { title: t("鉴权失败"), reason: t("模型服务拒绝了 API Key 或账号鉴权"), suggestion: t("检查 API Key、模型服务地址和账号权限") };
    case "timeout":
      return { title: t("请求超时"), reason: t("服务在规定时间内没有返回完整结果"), suggestion: t("检查网络稳定性，或稍后重试") };
    case "rate_limit":
      return { title: t("请求频率受限"), reason: t("模型服务返回了限流响应"), suggestion: t("降低请求频率，或检查模型服务额度") };
    case "cursor_sync":
      return { title: t("Cursor 会话同步异常"), reason: t("本地服务保存 Cursor 会话检查点时没有收到客户端确认"), suggestion: t("重启 Cursor 客户端后重试；当前会话数据仍保留在本机") };
    case "upstream":
      return { title: t("模型服务异常"), reason: t("上游模型服务返回了服务器错误"), suggestion: t("稍后重试；如果持续发生，检查服务商状态") };
    case "network":
      return { title: t("网络连接异常"), reason: t("本机到模型服务的连接被中断、代理波动或 TLS/DNS 失败"), suggestion: t("检查梯子或代理是否抖动；DeepSeek 可直连时尽量不要让它走代理") };
    case "database":
      return { title: t("本地数据服务异常"), reason: t("本地数据库被占用、锁定或迁移失败"), suggestion: t("关闭重复运行的 Cursor BYOK 后重试，并保留错误记录") };
    case "response_format":
      return { title: t("模型响应格式异常"), reason: t("模型服务返回的数据无法按预期解析"), suggestion: t("检查模型兼容性和代理是否修改了响应内容") };
    default:
      return { title: t("未知错误"), reason: t("服务记录到了错误，但暂时无法确定具体类型"), suggestion: t("查看下方请求编号，重试后仍失败再继续排查") };
  }
}

function sourceLabel(source: string) {
  if (source === "provider_llm") return t("模型调用");
  if (source === "cursor_request") return t("Cursor 对话");
  if (source === "cursor_sync") return t("Cursor 会话同步");
  return source;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function DiagnosticCard({ record }: { record: DiagnosticRecord }) {
  const copy = diagnosisCopy(record.category);
  return <Card className={styles.card}>
    <div className={styles.cardHeader}>
      <div>
        <div className={styles.title}>{copy.title}</div>
        <div className={styles.meta}>{sourceLabel(record.source)} · {formatTime(record.created_at_ms)}</div>
      </div>
      {record.http_status != null && <span className={styles.status}>{record.http_status}</span>}
    </div>
    <div className={styles.section}>
      <div className={styles.label}>{t("判断原因")}</div>
      <div>{copy.reason}</div>
    </div>
    <div className={styles.section}>
      <div className={styles.label}>{t("建议")}</div>
      <div>{copy.suggestion}</div>
    </div>
    {record.message && <div className={styles.raw}>
      <div className={styles.label}>{t("底层错误摘要")}</div>
      <code>{record.message}</code>
    </div>}
    {(record.request_id || record.call_id) && <div className={styles.identifiers}>
      {record.request_id && <span>{t("请求 ID")}: <code>{record.request_id}</code></span>}
      {record.call_id && <span>{t("调用 ID")}: <code>{record.call_id}</code></span>}
    </div>}
  </Card>;
}

export function DiagnosticsPage() {
  const { diagnostics } = useAppStore();

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (!disposed && document.visibilityState === "visible") void appStore.refreshDiagnostics();
    };
    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const content = <div className={styles.page}>
    <div className={styles.notice}>{t("这里只保留最近 3 天的错误摘要，不保存完整提示词、响应正文或密钥。")}</div>
    {diagnostics.length === 0
      ? <Card className={styles.empty}>{t("最近 3 天没有记录到错误。")}</Card>
      : <div className={styles.list}>{diagnostics.map((record) => <DiagnosticCard key={record.diagnostic_id} record={record} />)}</div>}
  </div>;
  return <PageContent fixed title={t("错误诊断")} contentClassName={styles.pageContent} sections={[{ key: "diagnostics", estimatedHeight: 720, content }]} />;
}
