import { useEffect, useState } from "react";
import type { PricingMode, TokenPrice, TokenPricingSettings } from "../../shared/api";
import { appStore, DEFAULT_TOKEN_PRICING, useAppStore } from "../../shared/store/appStore";
import { Button } from "../../shared/ui/Button";
import { FormField, TextInput } from "../../shared/ui/FormControls";
import { Select } from "../../shared/ui/Select";
import { TitledCard } from "../../shared/ui/TitledCard";
import { CURRENCY_SYMBOL } from "../home/metrics/tokenCost";
import { useMessage } from "../../shared/ui/message";
import styles from "./PricingSettingsCard.module.scss";

/** 一组单价的编辑草稿，价格在表单里按字符串处理，保存时再校验。 */
type PriceDraft = {
  input_per_million: string;
  output_per_million: string;
  cache_read_per_million: string;
  cache_write_per_million: string;
};

type PricingDraft = {
  mode: PricingMode;
  fixed: PriceDraft;
  peak: PriceDraft;
  offPeak: PriceDraft;
};

function toPriceDraft(price: TokenPrice): PriceDraft {
  return {
    input_per_million: String(price.input_per_million),
    output_per_million: String(price.output_per_million),
    cache_read_per_million: String(price.cache_read_per_million),
    cache_write_per_million: String(price.cache_write_per_million),
  };
}

function toDraft(pricing: TokenPricingSettings): PricingDraft {
  return {
    mode: pricing.mode,
    fixed: toPriceDraft(pricing.fixed),
    peak: toPriceDraft(pricing.peak),
    offPeak: toPriceDraft(pricing.off_peak),
  };
}

function formatPrice(value: number) {
  return `${CURRENCY_SYMBOL}${value}`;
}

function parsePrice(value: string, label: string) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(t("{label}必须是非负数", { label }));
  }
  return price;
}

/** 把一组草稿转成价格对象；`group` 只用于错误提示，让人知道是哪一段填错了。 */
function toPrice(draft: PriceDraft, group: string): TokenPrice {
  return {
    input_per_million: parsePrice(draft.input_per_million, t("{group}的输入价格", { group })),
    output_per_million: parsePrice(draft.output_per_million, t("{group}的输出价格", { group })),
    cache_read_per_million: parsePrice(draft.cache_read_per_million, t("{group}的缓存读取价格", { group })),
    cache_write_per_million: parsePrice(draft.cache_write_per_million, t("{group}的缓存写入价格", { group })),
  };
}

function toSettings(draft: PricingDraft): TokenPricingSettings {
  return {
    mode: draft.mode,
    fixed: toPrice(draft.fixed, t("全时段")),
    peak: toPrice(draft.peak, t("高峰时段")),
    off_peak: toPrice(draft.offPeak, t("低谷时段")),
  };
}

/** 一组单价的编辑表单。 */
function PriceFields({ draft, onChange }: {
  draft: PriceDraft;
  onChange: (next: PriceDraft) => void;
}) {
  const field = (key: keyof PriceDraft, label: string) => (
    <FormField label={label}>
      <TextInput
        type="number"
        min={0}
        step="any"
        value={draft[key]}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
      />
    </FormField>
  );

  return <>
    {field("input_per_million", t("输入价格（缓存未命中，{unit}/1M）", { unit: CURRENCY_SYMBOL }))}
    {field("output_per_million", t("输出价格（{unit}/1M）", { unit: CURRENCY_SYMBOL }))}
    {field("cache_read_per_million", t("缓存读取价格（缓存命中，{unit}/1M）", { unit: CURRENCY_SYMBOL }))}
    {field("cache_write_per_million", t("缓存写入价格（{unit}/1M）", { unit: CURRENCY_SYMBOL }))}
  </>;
}

/** 一组单价的只读展示。 */
function PriceRows({ price }: { price: TokenPrice }) {
  const row = (label: string, value: number) => (
    <div className={styles.row}>
      <strong>{label}</strong>
      <span className={styles.value}>{formatPrice(value)}</span>
    </div>
  );

  return <>
    {row(t("输入价格（缓存未命中）"), price.input_per_million)}
    {row(t("输出价格"), price.output_per_million)}
    {row(t("缓存读取价格（缓存命中）"), price.cache_read_per_million)}
    {row(t("缓存写入价格"), price.cache_write_per_million)}
  </>;
}

export function PricingSettingsCard() {
  const { pricing } = useAppStore();
  const message = useMessage();
  const [draft, setDraft] = useState<PricingDraft>(() => toDraft(pricing));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(toDraft(pricing));
  }, [pricing, editing]);

  const edit = () => {
    setDraft(toDraft(pricing));
    setEditing(true);
  };

  const cancel = () => {
    setDraft(toDraft(pricing));
    setEditing(false);
  };

  const save = async () => {
    try {
      setSaving(true);
      const next = toSettings(draft);
      if (await appStore.updatePricingSettings(next)) {
        setEditing(false);
        message(t("定价设置已保存"));
      }
    } catch (cause) {
      message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const restoreDefault = () => {
    setDraft(toDraft(DEFAULT_TOKEN_PRICING));
  };

  const modeOptions = [
    { value: "peak_off_peak", label: t("高峰 / 低谷分别计价") },
    { value: "fixed", label: t("全时段固定单价") },
  ];

  const action = editing ? (
    <div className={styles.actionGroup}>
      <Button size="small" disabled={saving} onClick={restoreDefault}>{t("恢复默认")}</Button>
      <Button size="small" disabled={saving} onClick={cancel}>{t("取消")}</Button>
      <Button variant="primary" size="small" disabled={saving} onClick={() => void save()}>
        {saving ? t("保存中…") : t("保存")}
      </Button>
    </div>
  ) : (
    <button type="button" className={styles.headerAction} onClick={edit}>{t("编辑")}</button>
  );

  return (
    <TitledCard title={t("Token 定价")} action={action}>
      <div className={styles.content}>
        <small>{t("用于首页价值估算的 Token 单价，单位：{unit} / 百万 Token。", { unit: CURRENCY_SYMBOL })}</small>
        {editing ? (
          <div className={styles.fields}>
            <FormField label={t("计价方式")}>
              <Select
                value={draft.mode}
                options={modeOptions}
                ariaLabel={t("计价方式")}
                onChange={(value) => setDraft({ ...draft, mode: value as PricingMode })}
              />
            </FormField>
            {draft.mode === "peak_off_peak" ? <>
              <span className={styles.sectionTitle}>{t("高峰时段")}</span>
              <PriceFields draft={draft.peak} onChange={(next) => setDraft({ ...draft, peak: next })} />
              <span className={styles.sectionTitle}>{t("低谷时段")}</span>
              <PriceFields draft={draft.offPeak} onChange={(next) => setDraft({ ...draft, offPeak: next })} />
              <span className={styles.rule}>{t("规则：UTC 周一至周五 01:00-04:00、06:00-10:00 为高峰期，其余时段（含周末）为低谷期；低谷价通常为高峰价的一半。")}</span>
            </> : <>
              <span className={styles.sectionTitle}>{t("全时段")}</span>
              <PriceFields draft={draft.fixed} onChange={(next) => setDraft({ ...draft, fixed: next })} />
            </>}
          </div>
        ) : pricing.mode === "peak_off_peak" ? (
          <>
            <div className={styles.row}>
              <strong>{t("计价方式")}</strong>
              <span className={styles.value}>{t("高峰 / 低谷分别计价")}</span>
            </div>
            <span className={styles.sectionTitle}>{t("高峰时段")}</span>
            <PriceRows price={pricing.peak} />
            <span className={styles.sectionTitle}>{t("低谷时段")}</span>
            <PriceRows price={pricing.off_peak} />
            <span className={styles.rule}>{t("规则：UTC 周一至周五 01:00-04:00、06:00-10:00 为高峰期，其余时段（含周末）为低谷期；低谷价通常为高峰价的一半。")}</span>
          </>
        ) : (
          <>
            <div className={styles.row}>
              <strong>{t("计价方式")}</strong>
              <span className={styles.value}>{t("全时段固定单价")}</span>
            </div>
            <span className={styles.sectionTitle}>{t("全时段")}</span>
            <PriceRows price={pricing.fixed} />
          </>
        )}
      </div>
    </TitledCard>
  );
}
