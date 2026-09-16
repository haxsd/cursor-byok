/**
 * 计价相关的纯函数。
 *
 * 价格单位统一为「元 / 百万 token」，货币符号集中在 `CURRENCY_SYMBOL` 中定义，
 * 需要换成其他币种时只改这一处（同时把设置里的单价填成对应币种的数值）。
 */

/** 显示用的货币符号。 */
export const CURRENCY_SYMBOL = "¥";

/** 价格与 token 数量的换算基准：每百万 token。 */
const TOKENS_PER_UNIT = 1_000_000;

/** 按「每百万 token 的单价」换算一批 token 的费用。 */
export function priceTokens(tokens: number, pricePerMillion: number) {
  return (tokens / TOKENS_PER_UNIT) * pricePerMillion;
}

/** 把金额格式化为带货币符号、保留两位小数的字符串。 */
export function formatMoney(value: number) {
  return `${CURRENCY_SYMBOL}${value.toFixed(2)}`;
}

/**
 * 把单价格式化为紧凑字符串。
 *
 * 分时计价时界面上显示的是区间内的加权平均价，可能是 1.7325 这种值，
 * 这里去掉多余的尾零，让整数单价仍然显示为 `2` 而不是 `2.0000`。
 */
export function formatPrice(value: number) {
  return String(Number(value.toFixed(4)));
}
