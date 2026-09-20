import { useEffect, useState } from "react";
import { api, type DevinBindingKind, type DevinHostPatchReceipt, type DevinHostPatchStatus, type DevinModelBinding, type DevinRoute, type DevinSettings, type Model } from "../../shared/api";
import { Button } from "../../shared/ui/Button";
import { FormField, SecretTextInput, TextInput } from "../../shared/ui/FormControls";
import { Select } from "../../shared/ui/Select";
import { Switch } from "../../shared/ui/Switch";
import { TitledCard } from "../../shared/ui/TitledCard";
import { useMessage } from "../../shared/ui/message";
import { PageContent } from "../../shell/layout/PageContent";
import styles from "./DevinSettingsPage.module.scss";

const emptySettings: DevinSettings = {
  enabled: false,
  auth_token: "",
  api_port: 43_110,
  inference_port: 43_111,
  local_api_port: 43_112,
  bindings: [],
};

/** 旧设置只有主模型哈希，界面把它显示成一条合成的主路由，直到用户真正编辑绑定。 */
const legacyRouteId = "primary";

function routesForDisplay(binding: DevinModelBinding): DevinRoute[] {
  if (binding.routes.length) return binding.routes;
  return [{ route_id: legacyRouteId, model_hash: binding.model_hash, label: binding.display_name, enabled: true }];
}

function activeRouteIdForDisplay(binding: DevinModelBinding): string | null {
  return binding.routes.length ? binding.active_route_id : legacyRouteId;
}

function pickActiveRouteId(routes: DevinRoute[], preferred: string | null): string | null {
  if (preferred && routes.some((route) => route.route_id === preferred && route.enabled)) return preferred;
  return routes.find((route) => route.enabled)?.route_id ?? null;
}

function nextRouteId(routes: DevinRoute[]): string {
  const used = new Set(routes.map((route) => route.route_id));
  let index = routes.length + 1;
  while (used.has(`route-${index}`)) index += 1;
  return `route-${index}`;
}

export function DevinSettingsPage() {
  const message = useMessage();
  const [settings, setSettings] = useState<DevinSettings>(emptySettings);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hostPath, setHostPath] = useState("");
  const [hostStatus, setHostStatus] = useState<DevinHostPatchStatus | null>(null);
  const [hostReceipt, setHostReceipt] = useState<DevinHostPatchReceipt | null>(null);
  const [hostBusy, setHostBusy] = useState(false);

  useEffect(() => {
    void Promise.all([api.devinSettings(), api.models()]).then(([nextSettings, nextModels]) => {
      setSettings(nextSettings);
      setModels(nextModels);
    }).catch((cause) => message(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
  }, [message]);

  const update = <K extends keyof DevinSettings>(key: K, value: DevinSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const updateBinding = (index: number, patch: Partial<DevinModelBinding>) => {
    setSettings((current) => ({
      ...current,
      bindings: current.bindings.map((binding, itemIndex) => itemIndex === index ? { ...binding, ...patch } : binding),
    }));
  };
  const addBinding = () => {
    const model = models[0];
    update("bindings", [...settings.bindings, {
      model_uid: `cursor-byok-${settings.bindings.length + 1}`,
      model_hash: model?.model_hash ?? "",
      display_name: model?.display_name ?? "",
      context_window_tokens: model?.context_window_tokens ?? null,
      enabled: true,
      kind: "standard",
      routes: [],
      active_route_id: null,
    }]);
  };
  const removeBinding = (index: number) => update("bindings", settings.bindings.filter((_, itemIndex) => itemIndex !== index));
  const commitRoutes = (index: number, routes: DevinRoute[], activeRouteId: string | null) => {
    updateBinding(index, routes.length ? { routes, active_route_id: pickActiveRouteId(routes, activeRouteId) } : { routes: [], active_route_id: null });
  };
  const updateRoute = (index: number, binding: DevinModelBinding, routes: DevinRoute[], routeIndex: number, patch: Partial<DevinRoute>) => {
    commitRoutes(index, routes.map((route, itemIndex) => itemIndex === routeIndex ? { ...route, ...patch } : route), activeRouteIdForDisplay(binding));
  };
  const appendRoute = (index: number, binding: DevinModelBinding, routes: DevinRoute[]) => {
    const model = models[0];
    commitRoutes(index, [...routes, {
      route_id: nextRouteId(routes),
      model_hash: model?.model_hash ?? binding.model_hash,
      label: model?.display_name ?? "",
      enabled: true,
    }], activeRouteIdForDisplay(binding));
  };
  const removeRoute = (index: number, binding: DevinModelBinding, routes: DevinRoute[], routeIndex: number) => {
    commitRoutes(index, routes.filter((_, itemIndex) => itemIndex !== routeIndex), activeRouteIdForDisplay(binding));
  };
  const inspectHost = async () => {
    try {
      setHostBusy(true);
      setHostStatus(await api.devinHostStatus(hostPath));
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setHostBusy(false);
    }
  };
  const applyHostPatch = async () => {
    try {
      setHostBusy(true);
      const receipt = await api.applyDevinHostPatch(hostPath);
      setHostReceipt(receipt);
      setHostStatus(await api.devinHostStatus(hostPath));
      message("Devin 宿主补丁已应用；重启 Devin 后生效", { duration: 5_000 });
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setHostBusy(false);
    }
  };
  const restoreHostPatch = async () => {
    if (!hostReceipt) return;
    try {
      setHostBusy(true);
      await api.restoreDevinHostPatch(hostReceipt);
      setHostReceipt(null);
      setHostStatus(await api.devinHostStatus(hostPath));
      message("Devin 宿主文件已恢复");
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setHostBusy(false);
    }
  };
  const save = async () => {
    try {
      setSaving(true);
      const saved = await api.setDevinSettings(settings);
      setSettings(saved);
      message(t("Devin 设置已保存，重启软件后监听端口生效"), { duration: 5_000 });
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = models.map((model) => ({ value: model.model_hash, label: `${model.display_name} · ${model.model_hash.slice(0, 8)}` }));
  const kindOptions = [
    { value: "standard" as DevinBindingKind, label: t("标准") },
    { value: "context_compression" as DevinBindingKind, label: t("上下文压缩") },
  ];
  const content = loading ? <div className={styles.loading}>{t("加载中…")}</div> : <div className={styles.page}>
    <TitledCard title={t("Devin 接入") } action={<Button variant="primary" size="small" disabled={saving} onClick={() => void save()}>{saving ? t("保存中…") : t("保存")}</Button>}>
      <div className={styles.settingRow}>
        <div><strong>{t("启用 Devin 网关")}</strong><small>{t("关闭时不会打开任何 Devin 端口，也不会影响 Cursor。")}</small></div>
        <Switch checked={settings.enabled} label={t("启用 Devin 网关")} onChange={(enabled) => update("enabled", enabled)} />
      </div>
      <div className={styles.fields}>
        <FormField label={t("控制令牌")} hint={t("可选；Devin 请求可通过 x-devin-router-token 或 Bearer 令牌认证。")}>
          <SecretTextInput value={settings.auth_token} onChange={(event) => update("auth_token", event.target.value)} placeholder={t("留空表示仅依赖本机回环访问")} />
        </FormField>
        <FormField label={t("API 端口")}><TextInput type="number" value={settings.api_port} onChange={(event) => update("api_port", Number(event.target.value))} /></FormField>
        <FormField label={t("推理端口")}><TextInput type="number" value={settings.inference_port} onChange={(event) => update("inference_port", Number(event.target.value))} /></FormField>
        <FormField label={t("本地 API 端口")}><TextInput type="number" value={settings.local_api_port} onChange={(event) => update("local_api_port", Number(event.target.value))} /></FormField>
      </div>
    </TitledCard>
    <TitledCard title={t("模型映射")} action={<Button size="small" disabled={!models.length} onClick={addBinding}>{t("添加映射")}</Button>}>
      <div className={styles.bindings}>
        {!settings.bindings.length && <small className={styles.empty}>{t("还没有映射。添加一个 haxsd byok 模型后，Devin 才能使用它。")}</small>}
        {settings.bindings.map((binding, index) => {
          const routes = routesForDisplay(binding);
          const activeRouteId = activeRouteIdForDisplay(binding);
          const hasRoutes = binding.routes.length > 0;
          const isCompression = binding.kind === "context_compression";
          return <div className={styles.binding} key={`${binding.model_uid}-${index}`}>
            <div className={styles.bindingFields}>
              <FormField label={t("Devin 模型 UID")}><TextInput value={binding.model_uid} onChange={(event) => updateBinding(index, { model_uid: event.target.value })} /></FormField>
              <FormField label={t("haxsd byok 模型")}><Select value={binding.model_hash} options={modelOptions} ariaLabel={t("haxsd byok 模型")} onChange={(model_hash) => {
                const model = models.find((item) => item.model_hash === model_hash);
                updateBinding(index, { model_hash, display_name: model?.display_name ?? binding.display_name, context_window_tokens: model?.context_window_tokens ?? null });
              }} /></FormField>
              <FormField label={t("显示名称")}><TextInput value={binding.display_name} onChange={(event) => updateBinding(index, { display_name: event.target.value })} /></FormField>
              <FormField label={t("上下文 token") }><TextInput type="number" min={1} value={binding.context_window_tokens ?? ""} onChange={(event) => updateBinding(index, { context_window_tokens: event.target.value ? Number(event.target.value) : null })} /></FormField>
              <FormField label={t("绑定类型")} hint={t("上下文压缩绑定必须是单线路；切换为该类型会清空候选路由。")}>
                <Select value={binding.kind} options={kindOptions} ariaLabel={t("绑定类型")} onChange={(kind) => {
                  const nextKind = kind as DevinBindingKind;
                  updateBinding(index, nextKind === "context_compression" ? { kind: nextKind, routes: [], active_route_id: null } : { kind: nextKind });
                }} />
              </FormField>
            </div>
            {isCompression ? <small className={styles.routeHint}>{t("上下文压缩绑定只使用上面的模型，不参与候选路由。")}</small> : <div className={styles.routes}>
              <div className={styles.routesHeader}>
                <span>{t("候选路由")}</span>
                <Button size="small" disabled={!models.length} onClick={() => appendRoute(index, binding, routes)}>{t("添加候选路由")}</Button>
              </div>
              {!hasRoutes && <small className={styles.routeHint}>{t("尚未配置候选路由，当前直接使用上面的主模型。")}</small>}
              {routes.map((route, routeIndex) => <div className={styles.route} key={route.route_id}>
                <div className={styles.routeFields}>
                  <FormField label={t("路由模型")}><Select value={route.model_hash} options={modelOptions} ariaLabel={t("路由模型")} onChange={(model_hash) => updateRoute(index, binding, routes, routeIndex, { model_hash })} /></FormField>
                  <FormField label={t("路由名称")}><TextInput value={route.label} onChange={(event) => updateRoute(index, binding, routes, routeIndex, { label: event.target.value })} /></FormField>
                </div>
                <div className={styles.routeFooter}>
                  <Switch checked={route.enabled} label={t("启用此路由")} onChange={(enabled) => updateRoute(index, binding, routes, routeIndex, { enabled })} />
                  <div className={styles.routeActions}>
                    <Button size="small" variant={route.route_id === activeRouteId ? "primary" : "secondary"} disabled={!route.enabled || route.route_id === activeRouteId} onClick={() => commitRoutes(index, routes, route.route_id)}>{route.route_id === activeRouteId ? t("当前路由") : t("设为当前路由")}</Button>
                    <button type="button" className={styles.remove} disabled={!hasRoutes} onClick={() => removeRoute(index, binding, routes, routeIndex)}>{t("移除")}</button>
                  </div>
                </div>
              </div>)}
            </div>}
            <div className={styles.bindingFooter}>
              <Switch checked={binding.enabled} label={t("启用此模型映射")} onChange={(enabled) => updateBinding(index, { enabled })} />
              <button type="button" className={styles.remove} onClick={() => removeBinding(index)}>{t("移除")}</button>
            </div>
          </div>;
        })}
      </div>
    </TitledCard>
    <TitledCard title={t("安全边界")}>
      <p className={styles.note}>{t("网关固定监听 127.0.0.1，并限制单次请求体为 24 MiB。Devin 负责执行工具，haxsd byok 负责模型调用和事件转发。")}</p>
    </TitledCard>
    <TitledCard title="Devin 宿主接入（可选）">
      <p className={styles.note}>只对你明确填写的 extension.js 操作。应用补丁前会校验四个版本锚点并创建 SHA-256 备份；未知版本、部分补丁或备份不一致时会拒绝写入。</p>
      <div className={styles.fields}>
        <FormField label="Devin / Windsurf extension.js 路径" hint="例如：C:\\Program Files\\Devin\\resources\\app\\extensions\\windsurf\\dist\\extension.js">
          <TextInput value={hostPath} onChange={(event) => setHostPath(event.target.value)} placeholder="请输入绝对路径" />
        </FormField>
      </div>
      <div className={styles.hostActions}>
        <Button size="small" disabled={!hostPath.trim() || hostBusy} onClick={() => void inspectHost()}>{hostBusy ? "检查中…" : "检查宿主"}</Button>
        <Button size="small" variant="primary" disabled={!hostStatus?.clean || !settings.enabled || hostBusy} onClick={() => void applyHostPatch()}>应用补丁</Button>
        <Button size="small" disabled={!hostReceipt || hostBusy} onClick={() => void restoreHostPatch()}>恢复原文件</Button>
      </div>
      {hostStatus && <small className={styles.hostStatus}>{hostStatus.patched ? `已接入：API ${hostStatus.ports?.api_port} · 推理 ${hostStatus.ports?.inference_port} · Local API ${hostStatus.ports?.local_api_port}` : hostStatus.clean ? "兼容版本，尚未应用补丁" : hostStatus.message}</small>}
    </TitledCard>
  </div>;
  return <PageContent title="Devin" sections={[{ key: "devin", estimatedHeight: 900, content }]} />;
}
