// @ts-check

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 */

const NO_CHANGES = {
  operations: [],
};

// Drop determines the drop tier: 150 cm = tier 1, 200 cm = tier 2, 250 cm = tier 3.
/** @type {Record<number, number>} */
const DROP_TIERS = {
  150: 1,
  200: 2,
  250: 3,
};

/**
 * @param {string | null | undefined} value
 * @returns {number}
 */
function parseCm(value) {
  if (typeof value !== "string") return NaN;

  const match = value.trim().match(/^(\d+)\s*(?:cm)?$/i);
  return match ? Number(match[1]) : NaN;
}

/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const rawTiers = input.shop.pricingTiers?.jsonValue;
  if (!Array.isArray(rawTiers)) return NO_CHANGES;

  const tiers = rawTiers.map((tier) => ({
    minWidth: Number(tier.min_width),
    maxWidth: Number(tier.max_width),
    basePrice: Number(tier.base_price),
    pricePerDropTier: Number(tier.price_per_drop_tier),
  }));

  /** @type {CartTransformRunResult["operations"]} */
  const operations = [];

  input.cart.lines.forEach((line) => {
    const width = parseCm(line.width?.value);
    const drop = parseCm(line.drop?.value);

    if (!Number.isFinite(width) || !Number.isFinite(drop)) return;

    const tier = tiers.find(
      (item) => width >= item.minWidth && width <= item.maxWidth
    );
    const dropTier = DROP_TIERS[drop];

    if (!tier || !dropTier) return;

    const calculatedPrice =
      tier.basePrice + (dropTier - 1) * tier.pricePerDropTier;

    if (!Number.isFinite(calculatedPrice)) return;

    operations.push({
      lineUpdate: {
        cartLineId: line.id,
        price: {
          adjustment: {
            fixedPricePerUnit: {
              amount: calculatedPrice.toFixed(2),
            },
          },
        },
      },
    });
  });

  return operations.length > 0 ? { operations } : NO_CHANGES;
}
