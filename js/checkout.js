/* =============================================
   CHECKOUT.JS — Full order page logic
   ============================================= */

const NP_API_CO = 'https://api.novaposhta.ua/v2.0/json/';

const Checkout = {
  currentStep: 1,
  carrier: 'np',
  cityRef: null,
  cityName: '',
  selectedBranch: null,
  callPref: 'nocall',
  payment: 'cod',
  products: [],
  _acTimeout: null,
  _allBranches: [],

  async init() {
    await this._loadProducts();
    this._renderSummary();
    this._checkPrefilledBranch();

    // City input enter
    document.getElementById('coCity').addEventListener('keydown', e => {
      if (e.key === 'Enter') { this.closeAC(); if (this.cityRef) this.loadBranches(); }
      if (e.key === 'Escape') this.closeAC();
    });
  },

  // ---- LOAD PRODUCTS ----
  async _loadProducts() {
    const params = new URLSearchParams(window.location.search);
    const id    = params.get('id');
    const catId = params.get('cat');
    const isCart = params.get('cart');
    const branch = params.get('branch');

    if (isCart) {
      this.products = Cart.items;
    } else if (id && catId) {
      try {
        const prods = await DataLoader.category(parseInt(catId));
        const p = prods.find(pr => pr.id === id);
        if (p) this.products = [{ ...p, qty: 1 }];
      } catch {}
    }
    // Pre-fill branch from URL
    if (branch) {
      this._setSelectedBranch({ label: decodeURIComponent(branch) });
    }
  },

  _checkPrefilledBranch() {
    // If branch was passed via delivery page
    const saved = localStorage.getItem('beauty_delivery_branch');
    if (saved && !this.selectedBranch) {
      this._setSelectedBranch({ label: saved });
      localStorage.removeItem('beauty_delivery_branch');
    }
  },

  _renderSummary() {
    const items = document.getElementById('summaryItems');
    const totals = document.getElementById('summaryTotals');
    if (!this.products.length) {
      items.innerHTML = `<div style="color:var(--text-muted);font-size:.85rem;text-align:center;padding:20px">Кошик порожній</div>`;
      return;
    }
    items.innerHTML = this.products.map(p => `
      <div class="summary-product">
        <div class="summary-product__img">
          ${p.pictures?.[0] ? `<img src="${p.pictures[0]}" alt="">` : '📦'}
        </div>
        <div>
          <div class="summary-product__name">${escHtml(p.name.slice(0,70))}${p.name.length>70?'...':''}</div>
          <div class="summary-product__vendor">${escHtml(p.vendor||'')} × ${p.qty||1}</div>
          <div style="font-weight:700;color:var(--accent);margin-top:4px">${fmtPrice(p.price * (p.qty||1))} грн</div>
        </div>
      </div>`).join('');

    const total = this.products.reduce((s,p) => s + p.price*(p.qty||1), 0);
    document.getElementById('sumSubtotal').textContent = fmtPrice(total) + ' грн';
    document.getElementById('sumTotal').textContent = fmtPrice(total) + ' грн';
    totals.style.display = '';
    this.setPayment(this.payment);
  },

  // ---- STEPS ----
  nextStep(from) {
    if (from === 1) {
      const name  = document.getElementById('inpName').value.trim();
      const phone = document.getElementById('inpPhone').value.trim();
      if (!name) { Toast.show('Введіть ім\'я', 'error'); document.getElementById('inpName').focus(); return; }
      if (!phone) { Toast.show('Введіть телефон', 'error'); document.getElementById('inpPhone').focus(); return; }
      this._activateStep(2);
    } else if (from === 2) {
      if (!this.selectedBranch) { Toast.show('Оберіть відділення', 'error'); return; }
      this._activateStep(3);
    }
  },

  _activateStep(n) {
    this.currentStep = n;
    // Update indicators
    for (let i = 1; i <= 3; i++) {
      const ind = document.getElementById(`step${i}-ind`);
      ind.classList.remove('active','done');
      if (i < n) ind.classList.add('done');
      else if (i === n) ind.classList.add('active');
    }
    for (let i = 1; i <= 2; i++) {
      document.getElementById(`line${i}`)?.classList.toggle('done', i < n);
    }
    // Update cards
    const cards = { 1: 'stepContact', 2: 'stepDelivery', 3: 'stepConfirm' };
    Object.entries(cards).forEach(([num, id]) => {
      const el = document.getElementById(id);
      if (parseInt(num) === n) {
        el.style.opacity = '1';
        el.style.pointerEvents = '';
        // Update badge color
        el.querySelector('.step-badge').style.background = 'var(--accent)';
      } else if (parseInt(num) < n) {
        el.style.opacity = '0.7';
        el.style.pointerEvents = 'auto';
        el.querySelector('.step-badge').style.background = 'var(--success)';
      } else {
        el.style.opacity = '0.5';
        el.style.pointerEvents = 'none';
        el.querySelector('.step-badge').style.background = 'var(--text-muted)';
      }
    });
    // Scroll to active card
    const activeId = cards[n];
    document.getElementById(activeId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // ---- CARRIER ----
  setCarrier(c) {
    this.carrier = c;
    document.getElementById('carrierNP').classList.toggle('active', c === 'np');
    document.getElementById('carrierUP').classList.toggle('active', c === 'up');
    this.selectedBranch = null;
    document.getElementById('selectedBranchBox').classList.remove('show');
    document.getElementById('deliveryNextBtn').style.display = 'none';
    document.getElementById('coBranchList').innerHTML = '';
    document.getElementById('branchSearchRow').style.display = 'none';
    if (this.cityRef || this.cityName) this.loadBranches();
  },

  // ---- CITY AUTOCOMPLETE ----
  onCityInput(val) {
    clearTimeout(this._acTimeout);
    if (val.length < 2) { this.closeAC(); return; }
    this._acTimeout = setTimeout(() => this._fetchCities(val), 280);
  },

  async _fetchCities(q) {
    const key = CONFIG.novaPoshtaKey;
    if (!key) return;
    try {
      const res = await fetch(NP_API_CO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          modelName: 'Address',
          calledMethod: 'getCities',
          methodProperties: { FindByString: q, Limit: 8 },
        }),
      });
      const data = await res.json();
      if (!data.success || !data.data?.length) { this.closeAC(); return; }
      const ac = document.getElementById('coCityAC');
      ac.innerHTML = data.data.map(c => `
        <div class="city-ac-item" onclick="Checkout.selectCity('${escHtml(c.Description)}','${c.Ref}')">
          <span>🏙️ ${escHtml(c.Description)}</span>
          <span class="region">${escHtml(c.AreaDescription||'')}</span>
        </div>`).join('');
      ac.classList.add('open');
    } catch { this.closeAC(); }
  },

  selectCity(name, ref) {
    document.getElementById('coCity').value = name;
    this.cityName = name;
    this.cityRef  = ref;
    this.closeAC();
    this.loadBranches();
  },

  closeAC() {
    document.getElementById('coCityAC').classList.remove('open');
  },

  // ---- LOAD BRANCHES ----
  async loadBranches() {
    const list = document.getElementById('coBranchList');
    list.innerHTML = '<div class="branch-spinner">Завантаження відділень...</div>';
    document.getElementById('branchSearchRow').style.display = 'none';

    if (this.carrier === 'up') {
      list.innerHTML = '<div style="padding:16px;font-size:.85rem;color:var(--text-muted)">⚠️ Укрпошта: потрібен API ключ у config.js</div>';
      return;
    }

    const key = CONFIG.novaPoshtaKey;
    if (!key) {
      list.innerHTML = '<div style="padding:16px;font-size:.85rem;color:var(--danger)">Додайте novaPoshtaKey в config.js</div>';
      return;
    }

    try {
      const props = this.cityRef
        ? { CityRef: this.cityRef, Limit: 200, Page: 1 }
        : { CityName: this.cityName, Limit: 200, Page: 1 };

      const res = await fetch(NP_API_CO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          modelName: 'Address',
          calledMethod: 'getWarehouses',
          methodProperties: props,
        }),
      });
      const data = await res.json();

      if (!data.success || !data.data?.length) {
        list.innerHTML = '<div style="padding:16px;font-size:.85rem;color:var(--text-muted)">Відділень не знайдено</div>';
        return;
      }

      this._allBranches = data.data.map(w => ({
        num:   w.Number,
        addr:  w.ShortAddress || w.Description,
        hours: this._npHours(w),
        ref:   w.Ref,
        label: `Нова Пошта №${w.Number}: ${w.ShortAddress || w.Description}`,
      }));

      document.getElementById('branchSearchRow').style.display = '';
      this._renderBranches(this._allBranches);
    } catch (e) {
      list.innerHTML = `<div style="padding:16px;font-size:.85rem;color:var(--danger)">Помилка: ${escHtml(e.message)}</div>`;
    }
  },

  filterBranches(q) {
    const filtered = q
      ? this._allBranches.filter(b =>
          b.num.includes(q) || b.addr.toLowerCase().includes(q.toLowerCase()))
      : this._allBranches;
    this._renderBranches(filtered);
  },

  _renderBranches(list) {
    const wrap = document.getElementById('coBranchList');
    if (!list.length) {
      wrap.innerHTML = '<div style="padding:12px;font-size:.85rem;color:var(--text-muted)">Нічого не знайдено</div>';
      return;
    }
    wrap.innerHTML = `<div class="branch-list-inline">
      ${list.map(b => `
        <div class="branch-row${this.selectedBranch?.num === b.num ? ' selected' : ''}"
             onclick="Checkout.selectBranch(${JSON.stringify(b).split('"').join('&quot;')})">
          <div>
            <div class="branch-row__num">№${escHtml(b.num)}</div>
            <div class="branch-row__addr">${escHtml(b.addr)}</div>
            ${b.hours ? `<div class="branch-row__hours">🕐 ${escHtml(b.hours.slice(0,50))}</div>` : ''}
          </div>
          <div class="branch-row__check">${this.selectedBranch?.num === b.num ? '✓' : ''}</div>
        </div>`).join('')}
    </div>`;
  },

  selectBranch(b) {
    // b comes in as object via onclick
    if (typeof b === 'string') {
      try { b = JSON.parse(b); } catch {}
    }
    this.selectedBranch = b;
    this._setSelectedBranch(b);
    this._renderBranches(
      document.getElementById('coBranchFilter').value
        ? this._allBranches.filter(br => br.num.includes(document.getElementById('coBranchFilter').value) || br.addr.toLowerCase().includes(document.getElementById('coBranchFilter').value.toLowerCase()))
        : this._allBranches
    );
  },

  _setSelectedBranch(b) {
    this.selectedBranch = b;
    const box = document.getElementById('selectedBranchBox');
    box.classList.add('show');
    document.getElementById('selectedBranchVal').textContent = b.label || b.addr || '';
    document.getElementById('deliveryNextBtn').style.display = '';
    document.getElementById('summaryItems'); // trigger re-render if needed
    // Update summary delivery line
    const delRow = document.querySelector('.summary-row span[id]');
    // Animate the box
    box.style.animation = 'none';
    box.offsetHeight;
    box.style.animation = '';
  },

  _npHours(w) {
    if (w.ScheduleDay?.Monday) {
      return `Пн–Пт ${w.ScheduleDay.Monday}, Сб ${w.ScheduleDay.Saturday || 'вих'}`;
    }
    return '';
  },

  // ---- CALL PREFERENCE ----
  setCallPref(val) {
    this.callPref = val;
    document.getElementById('optNoCall').classList.toggle('selected', val === 'nocall');
    document.getElementById('optCallYes').classList.toggle('selected', val === 'call');
  },

  // ---- PAYMENT ----
  setPayment(val) {
    this.payment = val;
    const row = document.getElementById('summaryPaymentRow');
    const valEl = document.getElementById('summaryPaymentVal');
    if (row && valEl) { row.style.display = ''; valEl.textContent = 'Накладений платіж'; }
  },

  // ---- SUBMIT ----
  async submit() {
    const name    = document.getElementById('inpName').value.trim();
    const phone   = document.getElementById('inpPhone').value.trim();
    const email   = document.getElementById('inpEmail').value.trim();
    const comment = document.getElementById('inpComment').value.trim();

    if (!name || !phone) { this._activateStep(1); Toast.show('Заповніть контактні дані', 'error'); return; }
    if (!this.selectedBranch) { this._activateStep(2); Toast.show('Оберіть відділення доставки', 'error'); return; }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = this.payment === 'card' ? '⏳ Переходимо до оплати...' : '⏳ Оформлюємо...';

    const orderNum = 'BU-' + Date.now().toString().slice(-6);
    const paymentLabels = { cod: 'Накладений платіж', card: 'Оплата картою онлайн (Monobank)', invoice: 'Безготівковий розрахунок' };
    const payload = {
      orderNum,
      type: 'order',
      noCall: this.callPref === 'nocall',
      payment: {
        method: this.payment,
        label: paymentLabels[this.payment] || this.payment,
      },
      customer: { name, phone, email },
      delivery: {
        carrier: 'Нова Пошта',
        branch: this.selectedBranch?.label || this.selectedBranch?.addr || '',
        branchNum: this.selectedBranch?.num || '',
        city: this.cityName,
      },
      products: this.products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        qty: p.qty || 1,
        vendor: p.vendor,
        total: p.price * (p.qty || 1),
      })),
      total: this.products.reduce((s,p) => s + p.price*(p.qty||1), 0),
      comment,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(CONFIG.webhooks.order, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Card payment: redirect to Monobank payment page
      if (this.payment === 'card' && res.ok) {
        let data = {};
        try { data = await res.json(); } catch {}
        if (data.paymentUrl) {
          // Clear cart before redirect
          if (new URLSearchParams(window.location.search).get('cart')) Cart.clear();
          window.location.href = data.paymentUrl;
          return;
        }
      }
    } catch {}

    // Clear cart if cart order
    if (new URLSearchParams(window.location.search).get('cart')) {
      Cart.clear();
    }

    if (typeof gtag !== 'undefined') gtag('event', 'purchase', {
      transaction_id: orderNum, currency: 'UAH',
      value: this.products.reduce((s,p) => s + p.price*(p.qty||1), 0),
      items: this.products.map(p => ({ item_id: p.id, item_name: p.name, price: p.price, quantity: p.qty||1 }))
    });

    this._showSuccess(orderNum);
  },

  _showSuccess(orderNum) {
    document.getElementById('checkoutMain').style.display = 'none';
    const s = document.getElementById('checkoutSuccess');
    s.classList.add('show');
    document.getElementById('successOrderNum').textContent = '№ ' + orderNum;
    document.getElementById('successMsg').textContent = this.callPref === 'nocall'
      ? 'Ваше замовлення оформлено автоматично. Очікуйте SMS/email з підтвердженням.'
      : 'Менеджер зателефонує вам протягом 30 хвилин для підтвердження замовлення.';
    document.getElementById('noCallBadge').style.display = this.callPref === 'nocall' ? '' : 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
};

document.addEventListener('DOMContentLoaded', () => Checkout.init());
