import { useEffect, useState } from "react";
import { api, type DevinModelBinding, type DevinSettings, type Model } from "../../shared/api";
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

export function DevinSettingsPage() {
  const message = useMessage();
  const [settings, setSettings] = useState<DevinSettings>(emptySettings);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    }]);
  };
  const removeBinding = (index: number) => update("bindings", settings.bindings.filter((_, itemIndex) => itemIndex !== index));
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
        {!settings.bindings.length && <small className={styles.empty}>{t("还没有映射。添加一个 Cursor BYOK 模型后，Devin 才能使用它。")}</small>}
        {settings.bindings.map((binding, index) => <div className={styles.binding} key={`${binding.model_uid}-${index}`}>
          <div className={styles.bindingFields}>
            <FormField label={t("Devin 模型 UID")}><TextInput value={binding.model_uid} onChange={(event) => updateBinding(index, { model_uid: event.target.value })} /></FormField>
            <FormField label={t("Cursor BYOK 模型")}><Select value={binding.model_hash} options={modelOptions} ariaLabel={t("Cursor BYOK 模型")} onChange={(model_hash) => {
              const model = models.find((item) => item.model_hash === model_hash);
              updateBinding(index, { model_hash, display_name: model?.display_name ?? binding.display_name, context_window_tokens: model?.context_window_tokens ?? null });
            }} /></FormField>
            <FormField label={t("显示名称")}><TextInput value={binding.display_name} onChange={(event) => updateBinding(index, { display_name: event.target.value })} /></FormField>
            <FormField label={t("上下文 token") }><TextInput type="number" min={1} value={binding.context_window_tokens ?? ""} onChange={(event) => updateBinding(index, { context_window_tokens: event.target.value ? Number(event.target.value) : null })} /></FormField>
          </div>
          <div className={styles.bindingFooter}>
            <Switch checked={binding.enabled} label={t("启用此模型映射")} onChange={(enabled) => updateBinding(index, { enabled })} />
            <button type="button" className={styles.remove} onClick={() => removeBinding(index)}>{t("移除")}</button>
          </div>
        </div>)}
      </div>
    </TitledCard>
    <TitledCard title={t("安全边界")}>
      <p className={styles.note}>{t("网关固定监听 127.0.0.1，并限制单次请求体为 24 MiB。Devin 负责执行工具，Cursor BYOK 只负责模型调用和事件转发。")}</p>
    </TitledCard>
  </div>;
  return <PageContent title="Devin" sections={[{ key: "devin", estimatedHeight: 900, content }]} />;
}
