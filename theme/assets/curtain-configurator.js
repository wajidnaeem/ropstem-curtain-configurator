/**
 * <curtain-configurator>
 * Made-to-measure curtain configurator for Dawn.
 * Vanilla ES6+, no dependencies.
 *
 * Price = base_price + (dropTier - 1) * price_per_drop_tier
 * All tier data comes from the product's custom.curtain_pricing_tiers metaobjects
 * (rendered by Liquid as JSON, in cents). Nothing is hardcoded here.
 */
class CurtainConfigurator extends HTMLElement {
  constructor() {
    super();

    this.widthInput = this.querySelector('[data-width]');
    this.widthError = this.querySelector('[data-width-error]');
    this.panelCountElement = this.querySelector('[data-panel-count]');
    this.priceElement = this.querySelector('[data-price]');
    this.addButton = this.querySelector('[data-add-to-cart]');
    this.messageElement = this.querySelector('[data-message]');

    this.minWidth = Number(this.dataset.minWidth);
    this.maxWidth = Number(this.dataset.maxWidth);

    // Fall back to Dawn's usual order (option1 = Drop, option2 = Fabric)
    // if the section couldn't find the options by name.
    const dropIndex = Number(this.dataset.dropOptionIndex);
    const fabricIndex = Number(this.dataset.fabricOptionIndex);
    this.dropOptionIndex = dropIndex >= 0 ? dropIndex : 0;
    this.fabricOptionIndex = fabricIndex >= 0 ? fabricIndex : 1;

    this.variants = [];
    this.pricingTiers = [];
    this.currentConfiguration = null;
    this.isAddingToCart = false;
    this.resetLabelTimer = null;
  }

  connectedCallback() {
    if (!this.addButton) return; // Section rendered its "not configured" notice.

    this.loadData();
    this.bindEvents();
    this.calculate({ showErrors: true });
  }

  /* ------------------------------------------------------------
   * Data
   * ------------------------------------------------------------ */

  loadData() {
    try {
      this.variants = JSON.parse(this.querySelector('[data-variants]')?.textContent || '[]');
      this.pricingTiers = JSON.parse(this.querySelector('[data-pricing-tiers]')?.textContent || '[]')
        .map((tier) => ({
          minWidth: Number(tier.min_width),
          maxWidth: Number(tier.max_width),
          panelsRequired: Number(tier.panels_required),
          basePrice: Number(tier.base_price),              // cents
          pricePerDropTier: Number(tier.price_per_drop_tier) // cents
        }))
        .sort((a, b) => a.minWidth - b.minWidth);
    } catch (error) {
      console.error('Curtain Configurator: failed to parse product data.', error);
      this.pricingTiers = [];
    }

    if (!this.pricingTiers.length) {
      this.disable('Pricing is unavailable for this product.');
    }
  }

  bindEvents() {
    // While typing: recalculate silently (don't flash errors on "1" before "180").
    this.widthInput?.addEventListener('input', () => this.calculate({ showErrors: false }));
    // On blur / Enter: show validation errors.
    this.widthInput?.addEventListener('change', () => this.calculate({ showErrors: true }));

    this.addEventListener('change', (event) => {
      if (event.target.matches('[data-drop], [data-fabric]')) {
        this.calculate({ showErrors: true });
      }
    });

    this.addButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.handleAddToCart();
    });
  }

  /* ------------------------------------------------------------
   * Inputs
   * ------------------------------------------------------------ */

  getWidth() {
    const raw = this.widthInput?.value.trim();
    return raw === '' ? NaN : Number(raw);
  }

  getSelectedDrop() {
    const input = this.querySelector('[data-drop]:checked');
    if (!input) return null;

    return {
      cm: Number(input.value),
      tier: Number(input.dataset.dropTier),
      optionValue: input.dataset.optionValue ?? input.value
    };
  }

  getSelectedFabric() {
    return this.querySelector('[data-fabric]:checked')?.value ?? null;
  }

  /* ------------------------------------------------------------
   * Business rules
   * ------------------------------------------------------------ */

  validateWidth(width) {
    if (!Number.isFinite(width)) return 'Please enter a width.';
    if (!Number.isInteger(width)) return 'Width must be a whole number of centimetres.';
    if (width < this.minWidth || width > this.maxWidth) {
      return `Width must be between ${this.minWidth} cm and ${this.maxWidth} cm.`;
    }
    return null;
  }

  findPricingTier(width) {
    return this.pricingTiers.find((tier) => width >= tier.minWidth && width <= tier.maxWidth) || null;
  }

  calculatePrice(tier, dropTier) {
    const price = tier.basePrice + (dropTier - 1) * tier.pricePerDropTier;
    return Number.isFinite(price) ? price : null;
  }

  findVariant(dropValue, fabricValue) {
    const normalize = (value) => String(value ?? '').trim().toLowerCase();

    return this.variants.find((variant) =>
      Array.isArray(variant.options) &&
      normalize(variant.options[this.dropOptionIndex]) === normalize(dropValue) &&
      normalize(variant.options[this.fabricOptionIndex]) === normalize(fabricValue)
    ) || null;
  }

  /* ------------------------------------------------------------
   * Calculation + render
   * ------------------------------------------------------------ */

  calculate({ showErrors }) {
    this.currentConfiguration = null;

    const width = this.getWidth();
    const widthError = this.validateWidth(width);

    if (widthError) {
      this.setWidthError(showErrors ? widthError : '');
      return this.resetSummary();
    }

    const tier = this.findPricingTier(width);
    if (!tier) {
      this.setWidthError(showErrors ? 'No pricing is available for this width.' : '');
      return this.resetSummary();
    }

    this.setWidthError('');

    const drop = this.getSelectedDrop();
    if (!drop || !Number.isInteger(drop.tier) || drop.tier < 1) {
      this.setMessage('Please select a drop.', 'error');
      return this.resetSummary();
    }

    const price = this.calculatePrice(tier, drop.tier);
    if (price === null) {
      this.setMessage('Unable to calculate a price for this configuration.', 'error');
      return this.resetSummary();
    }

    const fabric = this.getSelectedFabric();
    const variant = this.findVariant(drop.optionValue, fabric);
    if (!variant) {
      this.setMessage('This drop and fabric combination is unavailable.', 'error');
      return this.resetSummary();
    }

    this.currentConfiguration = {
      width,
      drop: drop.cm,
      fabric,
      panelsRequired: tier.panelsRequired,
      price,
      variantId: variant.id,
      available: variant.available !== false
    };

    this.setMessage('');
    this.renderSummary(this.currentConfiguration);
  }

  renderSummary(config) {
    const formatted = this.formatMoney(config.price);

    this.setText(this.panelCountElement, String(config.panelsRequired));
    this.setText(this.priceElement, formatted);

    if (!config.available) {
      this.addButton.disabled = true;
      this.setText(this.addButton, 'Sold out');
      return;
    }

    this.addButton.disabled = this.isAddingToCart;
    if (!this.isAddingToCart) {
      this.setText(this.addButton, `Add to cart — ${formatted}`);
    }
  }

  resetSummary() {
    this.setText(this.panelCountElement, '—');
    this.setText(this.priceElement, '—');
    this.addButton.disabled = true;
    this.setText(this.addButton, 'Enter your measurements');
  }

  disable(message) {
    this.resetSummary();
    this.setMessage(message, 'error');
  }

  /* ------------------------------------------------------------
   * Add to cart (Ajax Cart API + Section Rendering API)
   * ------------------------------------------------------------ */

  getCartUI() {
    // Dawn exposes one of these depending on Theme settings → Cart type.
    return document.querySelector('cart-notification') || document.querySelector('cart-drawer');
  }

  async handleAddToCart() {
    const config = this.currentConfiguration;
    if (!config || !config.available || this.isAddingToCart) return;

    this.isAddingToCart = true;
    clearTimeout(this.resetLabelTimer);
    this.addButton.disabled = true;
    this.addButton.setAttribute('aria-busy', 'true');
    this.setText(this.addButton, 'Adding…');
    this.setMessage('');

    const cartUI = this.getCartUI();
    const sectionIds = cartUI?.getSectionsToRender?.().map((section) => section.id) ?? [];

    const payload = {
      items: [
        {
          id: config.variantId,
          quantity: 1,
          properties: {
            // Customer-visible
            Width: `${config.width}cm`,
            Drop: `${config.drop}cm`,
            // Private (leading underscore): hidden from customers, kept on the order
            _fabric_panels: String(config.panelsRequired)
          }
        }
      ]
    };

    // Ask Shopify to return the cart section HTML in the same response.
    if (sectionIds.length) {
      payload.sections = sectionIds.join(',');
      payload.sections_url = window.location.pathname;
    }

    try {
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok || data.status) {
        throw new Error(data.description || data.message || 'Unable to add to cart.');
      }

      this.refreshCart(cartUI, data, config.variantId);
      this.setText(this.addButton, 'Added to cart ✓');
      this.setMessage('');
    } catch (error) {
      console.error('Curtain Configurator: add to cart failed.', error);
      this.setMessage(error.message, 'error');
    } finally {
      this.isAddingToCart = false;
      this.addButton.removeAttribute('aria-busy');

      this.resetLabelTimer = setTimeout(() => {
        if (this.currentConfiguration) this.renderSummary(this.currentConfiguration);
      }, 2000);

      if (this.currentConfiguration?.available) this.addButton.disabled = false;
    }
  }

  refreshCart(cartUI, data, variantId) {
    // No drawer/notification (Cart type = Page): go to the cart page.
    if (!cartUI || !data.sections) {
      window.location.href = `${window.Shopify?.routes?.root || '/'}cart`;
      return;
    }

    // Tell other Dawn components the cart changed (same event product-form.js publishes).
    if (typeof window.publish === 'function' && window.PUB_SUB_EVENTS) {
      window.publish(window.PUB_SUB_EVENTS.cartUpdate, {
        source: 'curtain-configurator',
        productVariantId: variantId,
        cartData: data
      });
    }

    cartUI.classList.remove('is-empty');

    // Dawn's own renderer swaps in the section HTML and opens the drawer/notification.
    cartUI.renderContents({ ...data, id: variantId });
  }

  /* ------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------ */

  formatMoney(cents) {
    const currency = window.Shopify?.currency?.active || 'USD';
    const locale = document.documentElement.lang || undefined;

    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  // Only touch the DOM when the text actually changes.
  setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  // The error line keeps its reserved height (no `hidden`), so there is no layout shift.
  setWidthError(message) {
    this.setText(this.widthError, message);
    this.widthInput?.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  setMessage(message, state = '') {
    if (!this.messageElement) return;
    this.setText(this.messageElement, message);
    if (state) this.messageElement.dataset.state = state;
    else delete this.messageElement.dataset.state;
  }
}

if (!customElements.get('curtain-configurator')) {
  customElements.define('curtain-configurator', CurtainConfigurator);
}
