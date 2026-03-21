/* =============================================
   DELIVERY.JS — Nova Poshta + Ukrposhta branch finder
   ============================================= */

const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
const UP_API = 'https://www.ukrposhta.ua/ecom/0.0.1/';

// Demo API key — works for city/warehouse lookup (read-only, public)
const NP_DEMO_KEY = 'YOUR_NP_KEY'; // замінити або залишити порожнім

const DeliveryPage = {
  map: null,
  markers: [],
  carrier: 'np',
  branches: [],
  filtered: [],
  activeType: 'all',
  cityRef: null,
  cityName: '',
  selectedIdx: null,
  npIcons: null,
  upIcon: null,
  _acTimeout: null,

  init() {
    this._initMap();
    this._initIcons();
    this._checkApiKeys();
    // Try to detect city from localStorage
    const saved = localStorage.getItem('beauty_city');
    if (saved) {
      try {
        const { name, ref } = JSON.parse(saved);
        document.getElementById('cityInput').value = name;
        this.cityRef  = ref;
        this.cityName = name;
        this.searchBranches();
      } catch {}
    }
    document.getElementById('cityInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { this.closeAC(); this.searchBranches(); }
      if (e.key === 'Escape') this.closeAC();
    });
  },

  _initMap() {
    this.map = L.map('deliveryMap', { zoomControl: true }).setView([49.0, 31.5], 6);
    setTimeout(() => this.map.invalidateSize(true), 200);
    window.addEventListener('load', () => this.map.invalidateSize(true));

    // Tile layers
    this._layerStreet = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    });
    this._layerSatellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri, Maxar, GeoEye',
      maxZoom: 19,
    });
    this._layerLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, opacity: 0.8,
    });

    this._layerStreet.addTo(this.map);
    this._isSatellite = false;

    // Map type toggle button
    const MapToggle = L.Control.extend({
      onAdd: () => {
        const btn = L.DomUtil.create('button', 'map-toggle-btn');
        btn.innerHTML = '🛰️ Супутник';
        btn.title = 'Перемкнути вигляд карти';
        btn.style.cssText = 'background:#fff;border:2px solid rgba(0,0,0,.2);border-radius:6px;padding:6px 12px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.15)';
        L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
        L.DomEvent.on(btn, 'click', () => DeliveryPage.toggleMapType(btn));
        return btn;
      },
    });
    new MapToggle({ position: 'topright' }).addTo(this.map);
  },

  toggleMapType(btn) {
    if (this._isSatellite) {
      this.map.removeLayer(this._layerSatellite);
      this.map.removeLayer(this._layerLabels);
      this._layerStreet.addTo(this.map);
      btn.innerHTML = '🛰️ Супутник';
      this._isSatellite = false;
    } else {
      this.map.removeLayer(this._layerStreet);
      this._layerSatellite.addTo(this.map);
      this._layerLabels.addTo(this.map);
      btn.innerHTML = '🗺️ Схема';
      this._isSatellite = true;
    }
  },

  _initIcons() {
    this.npIcon = L.divIcon({
      html: `<div style="background:#e85d26;color:#fff;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(232,93,38,.5);border:2px solid #fff">
               <span style="transform:rotate(45deg);font-size:12px">📦</span></div>`,
      iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30], className: '',
    });
    this.upIcon = L.divIcon({
      html: `<div style="background:#f6b700;color:#fff;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(246,183,0,.5);border:2px solid #fff">
               <span style="transform:rotate(45deg);font-size:12px">✉️</span></div>`,
      iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30], className: '',
    });
  },

  _checkApiKeys() {
    const npKey = CONFIG.novaPoshtaKey;
    const upKey = CONFIG.ukrPoshtaKey;
    const banner = document.getElementById('apiBanner');
    if (this.carrier === 'np' && !npKey) {
      banner.classList.remove('hidden');
      document.getElementById('apiProvider').textContent = 'Нова Пошта';
      document.getElementById('apiLink').href = 'https://developers.novaposhta.ua/';
      document.getElementById('apiLink').textContent = 'developers.novaposhta.ua';
    } else if (this.carrier === 'up' && !upKey) {
      banner.classList.remove('hidden');
      document.getElementById('apiProvider').textContent = 'Укрпошта';
      document.getElementById('apiLink').href = 'https://dev.ukrposhta.ua/';
      document.getElementById('apiLink').textContent = 'dev.ukrposhta.ua';
    } else {
      banner.classList.add('hidden');
    }
  },

  switchCarrier(carrier) {
    this.carrier = carrier;
    document.getElementById('tabNP').classList.toggle('active', carrier === 'np');
    document.getElementById('tabUP').classList.toggle('active', carrier === 'up');
    this._checkApiKeys();
    this._clearMarkers();
    this.branches = [];
    this.filtered = [];
    this._renderList();
    if (this.cityRef || this.cityName) this.searchBranches();
  },

  // ---- CITY AUTOCOMPLETE (Nova Poshta) ----
  async onCityInput(val) {
    clearTimeout(this._acTimeout);
    if (val.length < 2) { this.closeAC(); return; }
    this._acTimeout = setTimeout(() => this._fetchCities(val), 300);
  },

  async _fetchCities(query) {
    const key = CONFIG.novaPoshtaKey || NP_DEMO_KEY;
    try {
      const res = await fetch(NP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          modelName: 'Address',
          calledMethod: 'getCities',
          methodProperties: { FindByString: query, Limit: 10 },
        }),
      });
      const data = await res.json();
      if (!data.success || !data.data?.length) { this.closeAC(); return; }
      this._showAC(data.data);
    } catch { this.closeAC(); }
  },

  _showAC(cities) {
    const ac = document.getElementById('cityAC');
    ac.innerHTML = cities.map(c => `
      <div class="city-ac-item" onclick="DeliveryPage.selectCity('${escHtml(c.Description)}','${c.Ref}','${escHtml(c.AreaDescription || '')}')">
        <span>🏙️</span>
        <span>${escHtml(c.Description)}<span class="region"> ${escHtml(c.AreaDescription || '')}</span></span>
      </div>`).join('');
    ac.classList.add('open');
  },

  selectCity(name, ref, region) {
    document.getElementById('cityInput').value = name;
    this.cityName = name;
    this.cityRef  = ref;
    this.closeAC();
    localStorage.setItem('beauty_city', JSON.stringify({ name, ref, region }));
    this.searchBranches();
  },

  closeAC() {
    document.getElementById('cityAC').classList.remove('open');
  },

  // ---- SEARCH ----
  async searchBranches() {
    this.closeAC();
    const city = document.getElementById('cityInput').value.trim();
    if (!city) return;
    this._setLoading();
    this._clearMarkers();
    this.branches = [];

    if (this.carrier === 'np') {
      await this._fetchNP(city);
    } else {
      await this._fetchUP(city);
    }
  },

  // ---- NOVA POSHTA ----
  async _fetchNP(city) {
    const key = CONFIG.novaPoshtaKey || NP_DEMO_KEY;
    if (!CONFIG.novaPoshtaKey) {
      // Try anyway — some endpoints work with empty key in test mode
    }
    try {
      // If we have cityRef use it, otherwise search by name
      const methodProps = this.cityRef
        ? { CityRef: this.cityRef, Limit: 200, Page: 1 }
        : { CityName: city, Limit: 200, Page: 1 };

      const res = await fetch(NP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: key,
          modelName: 'Address',
          calledMethod: 'getWarehouses',
          methodProperties: methodProps,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        this._setError(data.errors?.[0] || 'Помилка API Нова Пошта. Перевірте API ключ у config.js');
        return;
      }
      if (!data.data?.length) {
        this._setEmpty('Відділення не знайдено в цьому місті');
        return;
      }

      this.branches = data.data.map(w => ({
        id:       w.Number,
        num:      w.Number,
        name:     w.Description,
        addr:     w.ShortAddress || w.Description,
        hours:    this._npHours(w),
        lat:      parseFloat(w.Latitude),
        lng:      parseFloat(w.Longitude),
        phone:    w.Phone || '',
        maxWeight: w.TotalMaxWeightAllowed ? `до ${w.TotalMaxWeightAllowed} кг` : '',
        type:     this._npType(w.CategoryOfWarehouse),
        raw:      w,
      })).filter(b => b.lat && b.lng);

      this.cityName = city;
      this._renderAll();
    } catch (e) {
      this._setError('Помилка мережі: ' + e.message);
    }
  },

  _npHours(w) {
    if (w.Reception?.Monday) {
      const d = w.Reception;
      return `Пн–Пт ${d.Monday || ''}, Сб ${d.Saturday || ''}, Нд ${d.Sunday || ''}`;
    }
    if (w.ScheduleDay?.Monday) {
      const d = w.ScheduleDay;
      return `Пн–Пт ${d.Monday}, Сб ${d.Saturday || 'вих'}, Нд ${d.Sunday || 'вих'}`;
    }
    return '';
  },

  _npType(cat) {
    if (!cat) return 'office';
    const c = cat.toLowerCase();
    if (c.includes('postamat') || c.includes('поштомат')) return 'postamat';
    return 'office';
  },

  // ---- УКРПОШТА ----
  async _fetchUP(city) {
    const key = CONFIG.ukrPoshtaKey;
    if (!key) {
      this._setError('Потрібен API ключ Укрпошти. Отримайте безкоштовно на dev.ukrposhta.ua → вставте в config.js як ukrPoshtaKey');
      return;
    }
    try {
      // Ukrposhta: GET addresses/delivery-branches?city=...
      const url = `${UP_API}addresses/delivery-branches?city=${encodeURIComponent(city)}&limit=200`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
        },
      });
      if (!res.ok) {
        this._setError(`Помилка API Укрпошти (${res.status}). Перевірте ключ або спробуйте пізніше.`);
        return;
      }
      const data = await res.json();
      const list = data.Entries?.Entry || data || [];
      if (!list.length) { this._setEmpty('Відділення Укрпошти не знайдено'); return; }

      this.branches = list.map((b, i) => ({
        id:    b.POSTCODE || i,
        num:   b.POSTCODE || (i + 1),
        name:  b.STREET_UA || b.CITY_UA || '',
        addr:  [b.STREET_UA, b.HOUSENUMBER].filter(Boolean).join(', '),
        hours: '',
        lat:   parseFloat(b.LATITUDE || 0),
        lng:   parseFloat(b.LONGITUDE || 0),
        phone: '',
        type:  'office',
        raw:   b,
      })).filter(b => b.lat && b.lng);

      this.cityName = city;
      this._renderAll();
    } catch (e) {
      this._setError('Помилка мережі: ' + e.message);
    }
  },

  // ---- RENDER ----
  filterType(type) {
    this.activeType = type;
    document.querySelectorAll('.btype-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.type === type));
    this._filterAndRender();
  },

  _filterAndRender() {
    this.filtered = this.activeType === 'all'
      ? this.branches
      : this.branches.filter(b => b.type === this.activeType);
    this._renderItems();
    this._renderMarkers();
    document.getElementById('listCount').textContent = this.filtered.length + ' відділень';
  },

  _renderAll() {
    this.filtered = [...this.branches];
    this._renderItems();
    this._renderMarkers();
    this._fitMap();

    const title = document.getElementById('listTitle');
    title.textContent = this.cityName;
    document.getElementById('listCount').textContent = this.filtered.length + ' відділень';
    document.getElementById('typeFilter').style.display = '';
  },

  _renderItems() {
    const wrap = document.getElementById('branchItems');
    if (!this.filtered.length) { this._setEmpty(); return; }

    wrap.innerHTML = this.filtered.map((b, i) => `
      <div class="branch-item${this.selectedIdx === i ? ' active' : ''}"
           id="bitem-${i}" onclick="DeliveryPage.selectBranch(${i})">
        <div class="branch-item__icon branch-item__icon--${this.carrier}">
          ${this.carrier === 'np' ? '📦' : '✉️'}
        </div>
        <div class="branch-item__info">
          <div class="branch-item__num">
            ${this.carrier === 'np' ? 'Відділення №' : 'Індекс '}${escHtml(String(b.num))}
            ${b.type === 'postamat' ? '<span class="tag tag--grey" style="margin-left:4px;font-size:.68rem">поштомат</span>' : ''}
          </div>
          <div class="branch-item__addr">${escHtml(b.addr)}</div>
          <div class="branch-item__meta">
            ${b.hours ? `<span>🕐 ${escHtml(b.hours.slice(0,40))}</span>` : ''}
            ${b.phone ? `<span>📞 ${escHtml(b.phone)}</span>` : ''}
            ${b.maxWeight ? `<span>⚖️ ${escHtml(b.maxWeight)}</span>` : ''}
          </div>
        </div>
      </div>`).join('');
  },

  _renderMarkers() {
    this._clearMarkers();
    const icon = this.carrier === 'np' ? this.npIcon : this.upIcon;
    this.filtered.forEach((b, i) => {
      if (!b.lat || !b.lng) return;
      const marker = L.marker([b.lat, b.lng], { icon })
        .addTo(this.map)
        .bindPopup(this._popupHtml(b), { maxWidth: 260 });
      marker.on('click', () => this.selectBranch(i));
      this.markers.push(marker);
    });
  },

  _popupHtml(b) {
    const tagClass = this.carrier === 'up' ? 'up' : '';
    return `
      <div class="branch-popup">
        <span class="popup-tag ${tagClass}">${this.carrier === 'np' ? 'Нова Пошта' : 'Укрпошта'}</span>
        <h4>${this.carrier === 'np' ? 'Відділення №' : ''}${escHtml(String(b.num))}</h4>
        <p>📍 ${escHtml(b.addr)}</p>
        ${b.hours ? `<p>🕐 ${escHtml(b.hours.slice(0, 60))}</p>` : ''}
        ${b.phone ? `<p>📞 ${escHtml(b.phone)}</p>` : ''}
        ${b.maxWeight ? `<p>⚖️ ${escHtml(b.maxWeight)}</p>` : ''}
        <button class="order-here" onclick="DeliveryPage.chooseForOrder('${escHtml(String(b.num))}','${escHtml(b.addr)}')">
          Обрати для замовлення
        </button>
      </div>`;
  },

  selectBranch(idx) {
    this.selectedIdx = idx;
    // Scroll list item
    const el = document.getElementById(`bitem-${idx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelectorAll('.branch-item').forEach((e, i) =>
      e.classList.toggle('active', i === idx));
    // Open popup
    const marker = this.markers[idx];
    if (marker) {
      this.map.flyTo(marker.getLatLng(), 16, { duration: 0.8 });
      marker.openPopup();
    }
  },

  chooseForOrder(num, addr) {
    const carrier = this.carrier === 'np' ? 'Нова Пошта' : 'Укрпошта';
    const branchInfo = `${carrier} №${num}: ${addr}`;
    this.map.closePopup();
    DeliveryOrderModal.open(branchInfo, num, carrier);
  },

  _fitMap() {
    if (!this.filtered.length) return;
    const pts = this.filtered.filter(b => b.lat && b.lng).map(b => [b.lat, b.lng]);
    if (pts.length) this.map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  },

  _clearMarkers() {
    this.markers.forEach(m => m.remove());
    this.markers = [];
  },

  // ---- STATES ----
  _setLoading() {
    document.getElementById('branchItems').innerHTML = `
      <div class="branch-loading">
        <div class="spinner"></div>
        <div>Завантаження відділень...</div>
      </div>`;
    document.getElementById('listTitle').textContent = 'Завантаження...';
    document.getElementById('listCount').textContent = '';
    document.getElementById('typeFilter').style.display = 'none';
  },

  _setEmpty(msg = 'Відділення не знайдено') {
    document.getElementById('branchItems').innerHTML = `
      <div class="branch-empty">
        <div class="icon">🔍</div>
        <div>${escHtml(msg)}</div>
      </div>`;
    document.getElementById('listTitle').textContent = this.cityName || 'Не знайдено';
    document.getElementById('listCount').textContent = '';
  },

  _setError(msg) {
    document.getElementById('branchItems').innerHTML = `
      <div class="branch-empty">
        <div class="icon" style="color:var(--danger)">⚠️</div>
        <div style="color:var(--danger);font-size:.85rem">${escHtml(msg)}</div>
      </div>`;
    document.getElementById('listTitle').textContent = 'Помилка';
    document.getElementById('listCount').textContent = '';
  },
};

// ---- DELIVERY ORDER MODAL ----
const DeliveryOrderModal = {
  open(branchInfo, num, carrier) {
    let el = document.getElementById('deliveryOrderOverlay');
    if (!el) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="deliveryOrderOverlay" onclick="if(event.target===this)DeliveryOrderModal.close()">
          <div class="modal" style="max-width:500px">
            <button class="modal__close" onclick="DeliveryOrderModal.close()">✕</button>
            <h3>📦 Оформити замовлення</h3>
            <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:20px">Заповніть форму — менеджер зв'яжеться і підтвердить деталі</p>

            <div class="modal-form" id="deliveryModalForm">
              <form onsubmit="DeliveryOrderModal.submit(event)">

                <div style="background:var(--bg);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:16px;border:1.5px solid var(--border)">
                  <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">Відділення доставки</div>
                  <div id="deliveryBranchDisplay" style="font-weight:600;font-size:.92rem;color:var(--text)"></div>
                  <input type="hidden" name="branch" id="deliveryBranchInput">
                </div>

                <div class="form-group">
                  <label>Ваше ім'я *</label>
                  <input type="text" name="name" placeholder="Іван Петренко" required>
                </div>
                <div class="form-group">
                  <label>Номер телефону *</label>
                  <input type="tel" name="phone" placeholder="+380 XX XXX XX XX" required>
                </div>
                <div class="form-group">
                  <label>Що хочете замовити?</label>
                  <textarea name="comment" placeholder="Назва товару, кількість, посилання або просто опишіть що потрібно..." style="min-height:90px"></textarea>
                </div>
                <div class="form-group">
                  <label>Email (необов'язково)</label>
                  <input type="email" name="email" placeholder="email@example.com">
                </div>

                <button type="submit" class="btn btn--primary btn--full btn--lg">
                  ✅ Надіслати заявку
                </button>
                <p style="text-align:center;font-size:.78rem;color:var(--text-muted);margin-top:10px">
                  Ніяких дзвінків від нас без вашого дозволу. Менеджер напише або зателефонує лише для підтвердження.
                </p>
              </form>
            </div>

            <div class="modal-success" id="deliveryModalSuccess">
              <div class="modal-success__icon">✓</div>
              <h4>Заявку прийнято!</h4>
              <p>Ми отримали вашу заявку. Менеджер зв'яжеться з вами найближчим часом для підтвердження замовлення.</p>
              <div style="background:var(--bg);border-radius:var(--radius-sm);padding:12px;margin:16px 0;font-size:.85rem">
                <strong>Доставка:</strong> <span id="deliverySuccessBranch"></span>
              </div>
              <button class="btn btn--primary" onclick="DeliveryOrderModal.close()">Закрити</button>
            </div>
          </div>
        </div>`);
      el = document.getElementById('deliveryOrderOverlay');
    }

    document.getElementById('deliveryBranchDisplay').textContent = branchInfo;
    document.getElementById('deliveryBranchInput').value = branchInfo;
    document.getElementById('deliverySuccessBranch').textContent = branchInfo;
    el.querySelector('form').reset();
    // Re-set branch after reset
    document.getElementById('deliveryBranchInput').value = branchInfo;
    document.getElementById('deliveryModalSuccess').classList.remove('show');
    document.getElementById('deliveryModalForm').style.display = '';
    el.classList.add('open');
  },

  close() {
    document.getElementById('deliveryOrderOverlay')?.classList.remove('open');
  },

  async submit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const name    = form.querySelector('[name="name"]').value.trim();
    const phone   = form.querySelector('[name="phone"]').value.trim();
    const comment = form.querySelector('[name="comment"]').value.trim();
    const email   = form.querySelector('[name="email"]').value.trim();
    const branch  = form.querySelector('[name="branch"]').value;

    if (!name || !phone) { Toast.show('Заповніть імʼя та телефон', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Відправляємо...';

    const payload = {
      type: 'delivery_order',
      name, phone, email, comment,
      delivery: { branch },
      timestamp: new Date().toISOString(),
    };

    try {
      await fetch(CONFIG.webhooks.order, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}

    document.getElementById('deliveryModalForm').style.display = 'none';
    document.getElementById('deliveryModalSuccess').classList.add('show');
    btn.disabled = false;
    btn.textContent = '✅ Надіслати заявку';
  },
};

document.addEventListener('DOMContentLoaded', () => DeliveryPage.init());
