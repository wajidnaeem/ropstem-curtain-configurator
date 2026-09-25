# Made-to-Measure Curtain Configurator

A custom Product Detail Page for made-to-measure curtains on Shopify Online Store 2.0 (Dawn). The customer enters a **width** and picks a **drop** and **fabric**. The page calculates the price and required fabric panels live, and adds the configured curtain to the cart through the Ajax Cart API.

Pricing rules live in **Shopify Metaobjects**, not in code. A **Cart Transform Function** applies the same calculation on Shopify's servers, so the cart and checkout charge the correct price and the customer cannot change it from the browser.

| | |
|---|---|
| **Storefront** | `theme/`: Liquid section + `<curtain-configurator>` custom element (vanilla ES6+, no dependencies) |
| **Server-side pricing** | `extensions/cart-transformer-rop/`: Cart Transform Function (JavaScript → WebAssembly) |
| **Admin app** | `app/`: embedded app page that syncs the pricing tiers to checkout |
| **Metaobject schema** | [`docs/metaobject-schema.png`](docs/metaobject-schema.png) |

---

## Contents

1. [How it works](#how-it-works)
2. [Repository structure](#repository-structure)
3. [Setup on a fresh store](#setup-on-a-fresh-store)
4. [Pricing calculation](#pricing-calculation)
5. [Cart serialization and payload construction](#cart-serialization-and-payload-construction)
6. [Other technical decisions](#other-technical-decisions)
7. [Testing](#testing)
8. [Assumptions and limitations](#assumptions-and-limitations)

---

## How it works

```
 Shopify Admin                          Storefront (Dawn)                         Checkout
 ─────────────                          ─────────────────                         ────────
 Curtain Pricing Tier metaobjects ──►  product.metafields.custom
 (min/max width, panels, prices)       .curtain_pricing_tiers  (list reference)
          │                                     │
          │                                     ▼
          │                             curtain-configurator.liquid
          │                             renders tiers as JSON (in cents)
          │                                     │
          │                                     ▼
          │                             <curtain-configurator> (JS)
          │                             live price + panels, validation
          │                                     │  POST /cart/add.js
          │                                     ▼  (+ Section Rendering API)
          │                             Cart line:
          │                               variant  = Drop × Fabric
          │                               Width: 180cm, Drop: 200cm
          │                               _fabric_panels: 2
          │                                     │
          ▼                                     ▼
 "Sync pricing to checkout"  ──►  shop metafield  ──►  Cart Transform Function
 (admin app)                     $app.curtain_pricing_tiers   recalculates price
                                 (JSON snapshot)              → lineUpdate on the line
```

1. The merchant manages tiers as **Curtain Pricing Tier** metaobject entries and links them to the product with a **list-reference product metafield**.
2. The **section** reads those entries in Liquid and passes them to JavaScript as JSON, so no ranges or prices exist in the theme code.
3. The **custom element** calculates the price and panel count on every input, updates the price display and the Add to Cart label, and adds the item with `/cart/add.js`.
4. The **Cart Transform Function** runs on Shopify's servers for every cart. It reads the `Width` and `Drop` line properties, looks up the tier, and sets the line price, which is the price the customer pays.

---

## Repository structure

```
.
├── extensions/cart-transformer-rop/         Cart Transform Function
│   ├── src/cart_transform_run.graphql       Function input query
│   ├── src/cart_transform_run.js            Pricing logic (server-side)
│   └── tests/                               Vitest integration tests + fixtures
│
├── app/routes/app._index.jsx                Admin page: tier overview + "Sync pricing to checkout"
├── shopify.app.toml                         App configuration (scopes, webhooks)
└── docs/metaobject-schema.png               Metaobject definition screenshot
```

---

## Setup on a fresh store

### 1. Create the metaobject definition

**Settings → Custom data → Metaobjects → Add definition**

| Setting | Value |
|---|---|
| Name | `Curtain Pricing Tier` |
| Type | `curtain_pricing_tier` |
| **Storefronts access** | **On** (required so Liquid can read the entries) |

Fields:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `min_width` | Integer | ✓ | Smallest width in this tier (cm, inclusive) |
| `max_width` | Integer | ✓ | Largest width in this tier (cm, inclusive) |
| `panels_required` | Integer | ✓ | Fabric panels needed to manufacture this width |
| `base_price` | Money | ✓ | Price at the shortest drop |
| `price_per_drop_tier` | Money | ✓ | Surcharge for each drop step above the shortest |

A screenshot of this definition is in [`docs/metaobject-schema.png`](docs/metaobject-schema.png).

### 2. Add the pricing tiers

**Content → Metaobjects → Curtain Pricing Tier → Add entry**, e.g.:

| Entry | min_width | max_width | panels_required | base_price | price_per_drop_tier |
|---|---|---|---|---|---|
| 50 | 50 | 120 | 1 | $1,000.00 | $200.00 |
| 121 | 121 | 240 | 2 | $1,800.00 | $350.00 |
| 241 | 241 | 360 | 3 | $2,600.00 | $500.00 |

Tiers must not overlap. The configurator's allowed width range is **derived from these entries** (smallest `min_width` to largest `max_width`), so with the entries above it is 50–360 cm.

### 3. Create the product metafield (list reference)

**Settings → Custom data → Products → Add definition**

| Setting | Value |
|---|---|
| Name | `Curtain pricing tiers` |
| Namespace and key | `custom.curtain_pricing_tiers` |
| Type | **Metaobject** → Curtain Pricing Tier → **List of entries** |
| Storefronts access | On |

### 4. Create the product

- Options: **Drop** (`150`, `200`, `250`, in ascending order) and **Fabric** (e.g. `Beige`, `Grey`, `White`).
- There is **no "Fabric Panels" option**. Panels are calculated, never selected.
- In the product's **Curtain pricing tiers** metafield, select all tier entries.

### 5. Install the theme files

Copy the files from `theme/` into a Dawn theme (or push with the Shopify CLI):

```bash
shopify theme push --store <store>.myshopify.com --path <dawn-folder> --unpublished
```

In the theme editor, open the product and configure the **Curtain Configurator** section:

| Setting | Purpose |
|---|---|
| Drop option name / Fabric option name | Must match the product's option names (default `Drop` / `Fabric`) |
| Fabric blocks | One block per swatch: label, **variant value** (must match the Fabric option value exactly), colour |
| Show fabric panel count | Optional. Shows the calculated panel count in the price summary |

### 6. Install the app (server-side pricing)

```bash
npm install
shopify app dev        # development
shopify app deploy     # production
```

1. Install the app on the store and open it.
2. Click **Sync pricing to checkout**. The page should show every tier and the status **In sync**.
3. **Repeat the sync whenever tiers are edited.** The status badge shows **Out of sync** when the metaobjects and the checkout copy differ.

Activate the Cart Transform once per store (Shopify admin → GraphiQL, or the app's Admin API):

```graphql
mutation {
  cartTransformCreate(functionHandle: "cart-transformer-rop") {
    cartTransform { id }
    userErrors { field message }
  }
}
```

---

## Pricing calculation

### Formula

```
tier      = the entry where  min_width ≤ width ≤ max_width
dropTier  = position of the selected drop in the Drop option (150 → 1, 200 → 2, 250 → 3)

price     = tier.base_price + (dropTier − 1) × tier.price_per_drop_tier
panels    = tier.panels_required
```

- **Width** picks the tier, which sets the base price and the number of fabric panels.
- **Drop** adds a fixed surcharge per step above the shortest drop. The shortest drop pays only the base price.

### Worked examples (tiers from the setup above)

| Width | Drop | Tier | Calculation | Price | Panels |
|---|---|---|---|---|---|
| 100 cm | 150 cm | 50–120 | 1,000 + 0 × 200 | **$1,000.00** | 1 |
| 180 cm | 200 cm | 121–240 | 1,800 + 1 × 350 | **$2,150.00** | 2 |
| 200 cm | 150 cm | 121–240 | 1,800 + 0 × 350 | **$1,800.00** | 2 |
| 300 cm | 250 cm | 241–360 | 2,600 + 2 × 500 | **$3,600.00** | 3 |

### Where it runs

The same formula runs in two places, reading from the same metaobjects:

| | Storefront (`curtain-configurator.js`) | Checkout (`cart_transform_run.js`) |
|---|---|---|
| Purpose | Instant feedback while the customer types | **Authoritative price** charged at checkout |
| Data source | Metaobjects rendered by Liquid | Metaobjects synced to a shop metafield |
| Trust | Runs in the browser, so it can be tampered with | Runs on Shopify's servers, so it can't |

Money is handled in **integer cents** in the browser (`$1,800.00` → `180000`) to avoid floating-point rounding (`0.1 + 0.2 ≠ 0.3`), and formatted with `Intl.NumberFormat` in the store's active currency.

---

## Cart serialization and payload construction

### Payload

```json
POST /cart/add.js
{
  "items": [
    {
      "id": 44123456789,
      "quantity": 1,
      "properties": {
        "Width": "180cm",
        "Drop": "200cm",
        "_fabric_panels": "2"
      }
    }
  ],
  "sections": "cart-drawer,cart-icon-bubble",
  "sections_url": "/products/made-to-measure-curtain"
}
```

### Decisions

**1. Variant = Drop × Fabric.** The line item uses a real variant, so the order shows the selected Drop and Fabric, and inventory, SKUs and fulfilment work as normal. Width can't be a variant because it's a free number (50–360, 311 possible values), so it's sent as a line item property.

**2. Visible properties: `Width` and `Drop`.** Their values include the unit (`180cm`) so they read clearly in the cart, the order and packing slips without extra formatting.

**3. Private property: `_fabric_panels`.** Keys starting with `_` are hidden from customers by Shopify (cart, checkout, order status and notification templates) but stay on the order in the Admin and in the order JSON/API, so manufacturing gets the value. The panel count is **never** offered as a variant dropdown.

**4. The browser never sends a price.** `/cart/add.js` doesn't accept a price, and the storefront doesn't try to fake one. The Cart Transform Function recalculates the price on the server from `Width` and `Drop`. If someone edits the properties, they get the price for the dimensions they submitted, which are the dimensions that will be manufactured. Unknown widths or drops get no price change and fall back to the variant price.

**5. One request with the Section Rendering API.** The `sections` parameter makes `/cart/add.js` return the fresh cart drawer and cart icon HTML **in the same response**. The section IDs come from Dawn's own `cart-drawer` / `cart-notification` element (`getSectionsToRender()`), and the HTML is handed to Dawn's native `renderContents()`. The drawer updates and opens without a page reload or a second request. If the theme's cart type is **Page**, the customer is redirected to `/cart`.

**6. Dawn integration.** After adding, the element publishes Dawn's `cartUpdate` pub/sub event (the same one `product-form.js` publishes), so other theme components stay in sync.

**7. Every item is a separate line.** Two curtains with different widths have different properties, so Shopify keeps them as separate cart lines automatically. Each line's price is calculated independently.

---

## Other technical decisions

### Why the checkout reads a synced JSON snapshot

Shopify Functions cap the input query's **complexity at 30**. Reading each metaobject field (`field(key: …)`) individually costs 68 for just four tiers. Instead, the admin app serializes all tier entries into **one** JSON shop metafield (`$app.curtain_pricing_tiers`), which the function reads in a single lookup, whatever the number of tiers.

The metaobjects stay the **single source of truth**. The JSON is a derived copy, and the admin page shows **In sync / Out of sync** so a stale copy is easy to spot.

### Zero Cumulative Layout Shift

- The error and message lines are **never** toggled with `hidden`/`display:none`. They keep a reserved `min-height`, and only their text changes.
- The price summary rows and the button have **fixed heights**. The button text uses `white-space: nowrap` so a longer label can't wrap onto a second line.
- Prices use `font-variant-numeric: tabular-nums`, so `$1,800.00` → `$2,150.00` keeps the same width.
- The DOM is only written when a value actually changes.

### Validation and UX

- The width must be a whole number within the range derived from the tiers. While typing, the price recalculates silently (no error flash on "1" before "180"); errors show once the field is left.
- Drop radios are **generated from the product's own Drop option values**, so they always match real variants. Options are located **by name**, so their order on the product doesn't matter.
- Unavailable combinations and sold-out variants disable the button with a clear message. Errors are shown inline (no `alert()`), with `aria-live` for screen readers.
- Radios keep native keyboard support, with visible focus styles.

### No dependencies

Vanilla ES6+ and an HTML custom element (`customElements.define`). No jQuery, UI or maths libraries. The script is loaded with `defer`.

---

## Testing

### Function tests

```bash
cd extensions/cart-transformer-rop
npm test
```

| Fixture | Checks |
|---|---|
| `no-operations.json` | No tier data / no properties → no price change |
| `curtain-price.json` | 180 cm × 200 cm → `lineUpdate` with `175.00` (fixture tiers), plain lines untouched |

### Manual test checklist

| Action | Expected |
|---|---|
| Width 180, drop 200 | Price **$2,150.00**; button "Add to cart — $2,150.00" |
| Width 30, leave the field | Inline error, button disabled, **no layout shift** |
| Switch drop / fabric | Price updates instantly |
| Add to cart | Drawer opens with `Width: 180cm`, `Drop: 200cm`; `_fabric_panels` **not visible** |
| Cart / checkout total | Matches the storefront price (**$2,150.00**) |
| Admin → the order | `_fabric_panels: 2` present on the line item |

---

## Assumptions and limitations

- **Drop tiers follow the order of the Drop option values** (first value = tier 1). Keep the values in ascending order. The function uses the same 150/200/250 mapping.
- **Re-sync after editing tiers.** A webhook (`metaobjects/update`) could automate this. The manual button keeps the task scope small and gives the merchant an explicit "publish prices" step.
- **Cart Transform `lineUpdate`** is limited to eligible plans (Shopify Plus; development stores support it for testing).
- **Money formatting in Liquid** uses the `money_without_currency` filter and removes the thousands separator. This assumes a currency format with `,` for thousands and `.` for decimals (as in USD).
- **Quantity** is fixed at 1 per add. Customers change the quantity in the cart; each unit is priced by the function.
