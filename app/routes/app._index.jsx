import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const TIERS_QUERY = `#graphql
  query curtainPricingTiers {
    shop {
      id
      pricingTiers: metafield(namespace: "$app", key: "curtain_pricing_tiers") {
        jsonValue
        updatedAt
      }
    }
    metaobjects(type: "curtain_pricing_tier", first: 50) {
      nodes {
        handle
        fields {
          key
          jsonValue
        }
      }
    }
  }`;

// Money fields come back as { amount, currency_code }; integers as numbers.
function toNumber(value) {
  if (value && typeof value === "object" && "amount" in value) {
    return Number(value.amount);
  }
  return Number(value);
}

function serializeTiers(metaobjects) {
  return metaobjects
    .map(({ handle, fields }) => {
      const byKey = Object.fromEntries(
        fields.map((field) => [field.key, field.jsonValue]),
      );
      return {
        handle,
        min_width: toNumber(byKey.min_width),
        max_width: toNumber(byKey.max_width),
        panels_required: toNumber(byKey.panels_required),
        base_price: toNumber(byKey.base_price),
        price_per_drop_tier: toNumber(byKey.price_per_drop_tier),
      };
    })
    .sort((a, b) => a.min_width - b.min_width);
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(TIERS_QUERY);
  const { data } = await response.json();

  return {
    tiers: serializeTiers(data.metaobjects.nodes),
    synced: data.shop.pricingTiers?.jsonValue ?? null,
    syncedAt: data.shop.pricingTiers?.updatedAt ?? null,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(TIERS_QUERY);
  const { data } = await response.json();
  const tiers = serializeTiers(data.metaobjects.nodes);

  const setResponse = await admin.graphql(
    `#graphql
    mutation syncCurtainPricingTiers($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: data.shop.id,
            namespace: "$app",
            key: "curtain_pricing_tiers",
            type: "json",
            value: JSON.stringify(tiers),
          },
        ],
      },
    },
  );
  const setJson = await setResponse.json();
  const userErrors = setJson.data.metafieldsSet.userErrors;

  return { ok: userErrors.length === 0, userErrors, count: tiers.length };
};

export default function Index() {
  const { tiers, synced, syncedAt } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSyncing = fetcher.state !== "idle";
  const inSync = JSON.stringify(tiers) === JSON.stringify(synced);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(`Synced ${fetcher.data.count} pricing tiers`);
    } else {
      shopify.toast.show("Sync failed", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const sync = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Curtain pricing">
      <s-button
        slot="primary-action"
        onClick={sync}
        {...(isSyncing ? { loading: true } : {})}
      >
        Sync pricing to checkout
      </s-button>

      <s-section heading="Pricing tiers">
        <s-paragraph>
          Tiers are managed as <s-text>Curtain Pricing Tier</s-text> metaobjects
          in Content → Metaobjects. After editing them, click{" "}
          <s-text>Sync pricing to checkout</s-text> so the cart transform
          function charges the updated prices.
        </s-paragraph>
        <s-paragraph>
          Status:{" "}
          <s-badge tone={inSync ? "success" : "warning"}>
            {inSync ? "In sync" : "Out of sync"}
          </s-badge>
          {syncedAt ? ` Last synced ${new Date(syncedAt).toLocaleString()}` : ""}
        </s-paragraph>

        <s-table>
          <s-table-header-row>
            <s-table-header>Handle</s-table-header>
            <s-table-header>Width (cm)</s-table-header>
            <s-table-header>Panels</s-table-header>
            <s-table-header>Base price</s-table-header>
            <s-table-header>Per drop tier</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {tiers.map((tier) => (
              <s-table-row key={tier.handle}>
                <s-table-cell>{tier.handle}</s-table-cell>
                <s-table-cell>
                  {tier.min_width}–{tier.max_width}
                </s-table-cell>
                <s-table-cell>{tier.panels_required}</s-table-cell>
                <s-table-cell>{tier.base_price.toFixed(2)}</s-table-cell>
                <s-table-cell>
                  {tier.price_per_drop_tier.toFixed(2)}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
