/* =============================================
   APP.JS — Shared: Cart, Order Modal, Toast, Data Loader
   ============================================= */

// ---- DATA LOADER ----
const DataLoader = {
  _cache: {},
  async get(path) {
    if (this._cache[path]) return this._cache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    const data = await res.json();
    this._cache[path] = data;
    return data;
  },
  async catalog() {
    return this.get(`${CONFIG.dataPath}/catalog.json?v=2`);
  },
  async category(id) {
    return this.get(`${CONFIG.dataPath}/cat_${id}.json`);
  },
  async featured() {
    return this.get(`${CONFIG.dataPath}/featured.json`);
  },
  async search(query) {
    const cat = await this.catalog();
    const q = query.toLowerCase().trim();
    const allCatIds = cat.allCats.map(c => c.id);
    const results = [];
    for (const id of allCatIds) {
      try {
        const products = await this.category(id);
        for (const p of products) {
          if (p.available && (
            p.name.toLowerCase().includes(q) ||
            (p.vendor || '').toLowerCase().includes(q) ||
            (p.vendorCode || '').toLowerCase().includes(q)
          )) {
            results.push(p);
            if (results.length >= 60) return results;
          }
        }
      } catch {}
    }
    return results;
  }
};

// ---- CART ----
const Cart = {
  _key: 'krasa_cart',
  items: [],

  load() {
    try { this.items = JSON.parse(localStorage.getItem(this._key)) || []; }
    catch { this.items = []; }
    this._updateBadge();
  },
  save() {
    localStorage.setItem(this._key, JSON.stringify(this.items));
    this._updateBadge();
  },
  add(product) {
    const existing = this.items.find(i => i.id === product.id);
    if (existing) {
      existing.qty = (existing.qty || 1) + 1;
    } else {
      this.items.push({ ...product, qty: 1 });
    }
    this.save();
    Toast.show(`"${product.name.slice(0,40)}..." додано до кошика`, 'success');
    if (typeof gtag !== 'undefined') gtag('event', 'add_to_cart', {
      currency: 'UAH', value: product.price,
      items: [{ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 }]
    });
    this._renderSidebar();
  },
  remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save();
    this._renderSidebar();
  },
  clear() {
    this.items = [];
    this.save();
    this._renderSidebar();
  },
  setQty(id, qty) {
    if (qty <= 0) { this.remove(id); return; }
    const item = this.items.find(i => i.id === id);
    if (item) { item.qty = qty; this.save(); this._renderSidebar(); }
  },
  total() {
    return this.items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  },
  count() {
    return this.items.reduce((s, i) => s + (i.qty || 1), 0);
  },
  _updateBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const n = this.count();
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
  },
  _renderSidebar() {
    const el = document.getElementById('cartItems');
    const footer = document.getElementById('cartFooter');
    if (!el) return;
    if (this.items.length === 0) {
      el.innerHTML = `
        <div class="cart-empty">
          <div style="font-size:3rem;opacity:.2;text-align:center;margin-bottom:12px">🛒</div>
          <div style="color:var(--text-muted);text-align:center;font-size:.9rem">Кошик порожній</div>
        </div>`;
      if (footer) footer.style.display = 'none';
      return;
    }
    if (footer) footer.style.display = '';
    el.innerHTML = this.items.map(item => `
      <div class="cart-item">
        <div class="cart-item__img">
          ${item.pictures && item.pictures[0]
            ? `<img src="${item.pictures[0]}" alt="" loading="lazy">`
            : '<span style="font-size:1.5rem;color:var(--border)">📦</span>'}
        </div>
        <div class="cart-item__info">
          <div class="cart-item__name">${escHtml(item.name.slice(0, 60))}${item.name.length > 60 ? '...' : ''}</div>
          <div class="cart-item__price">${fmtPrice(item.price * (item.qty || 1))} грн</div>
          <div class="cart-item__qty">
            <button onclick="Cart.setQty('${item.id}', ${(item.qty||1) - 1})">−</button>
            <span>${item.qty || 1}</span>
            <button onclick="Cart.setQty('${item.id}', ${(item.qty||1) + 1})">+</button>
          </div>
        </div>
        <button class="cart-item__remove" onclick="Cart.remove('${item.id}')" title="Видалити">✕</button>
      </div>`).join('');
    const totalEl = document.getElementById('cartTotal');
    if (totalEl) totalEl.textContent = fmtPrice(this.total()) + ' грн';
  },
};

// ---- CART SIDEBAR ----
function toggleCart() {
  const overlay = document.getElementById('cartOverlay');
  const sidebar = document.getElementById('cartSidebar');
  if (!overlay || !sidebar) return;
  const isOpen = sidebar.classList.contains('open');
  overlay.classList.toggle('open', !isOpen);
  sidebar.classList.toggle('open', !isOpen);
  if (!isOpen) Cart._renderSidebar();
}
function closeCart() {
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.getElementById('cartSidebar')?.classList.remove('open');
}

// ---- ORDER MODAL ----
const OrderModal = {
  current: null,
  open(product) {
    this.current = product;
    const overlay = document.getElementById('orderOverlay');
    if (!overlay) return;
    overlay.querySelector('.modal__product-name').textContent = product.name;
    overlay.querySelector('.modal__product-price').textContent = fmtPrice(product.price) + ' грн';
    overlay.querySelector('form').reset();
    overlay.querySelector('.modal-success').classList.remove('show');
    overlay.querySelector('.modal-form').style.display = '';
    overlay.classList.add('open');
  },
  close() {
    document.getElementById('orderOverlay')?.classList.remove('open');
    this.current = null;
  },
  async submit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const name = form.querySelector('[name="name"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const comment = form.querySelector('[name="comment"]').value.trim();

    if (!name || !phone) { Toast.show('Заповніть імʼя та телефон', 'error'); return; }

    btn.disabled = true;
    btn.textContent = 'Відправляємо...';

    const payload = {
      type: 'order',
      name, phone, comment,
      product: {
        id: this.current?.id,
        name: this.current?.name,
        price: this.current?.price,
        vendor: this.current?.vendor,
        url: window.location.href,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await fetch(CONFIG.webhooks.order, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}

    form.closest('.modal-overlay').querySelector('.modal-form').style.display = 'none';
    form.closest('.modal-overlay').querySelector('.modal-success').classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Створити замовлення';
  },
};

// ---- TOAST ----
const Toast = {
  _container: null,
  _ensure() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'toast-container';
      document.body.appendChild(this._container);
    }
    return this._container;
  },
  show(msg, type = '') {
    const wrap = this._ensure();
    const el = document.createElement('div');
    el.className = `toast${type ? ` toast--${type}` : ''}`;
    el.textContent = msg;
    wrap.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  },
};

// ---- HEADER SCROLL ----
function initHeader() {
  const header = document.getElementById('header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---- HEADER SEARCH ----
function initHeaderSearch() {
  const input = document.getElementById('headerSearchInput');
  const btn = document.getElementById('headerSearchBtn');
  if (!input) return;
  const doSearch = () => {
    const q = input.value.trim();
    if (q) window.location.href = `catalog.html?search=${encodeURIComponent(q)}`;
  };
  btn?.addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
}

// ---- PRODUCT CARD HELPER ----
function renderProductCard(p) {
  const img = p.pictures && p.pictures[0]
    ? `<img src="${p.pictures[0]}" alt="${escHtml(p.name)}" loading="lazy">`
    : `<span class="product-card__img--empty">📦</span>`;
  const productUrl = `product.html?id=${p.id}&cat=${p.categoryId}`;
  const footer = p.available
    ? `<button class="btn btn--secondary btn--sm" onclick='Cart.add(${JSON.stringify({id:p.id,name:p.name,price:p.price,pictures:p.pictures,vendor:p.vendor,categoryId:p.categoryId})})'>В кошик</button>
       <a href="checkout.html?id=${p.id}&cat=${p.categoryId}" class="btn btn--primary btn--sm">Замовити</a>`
    : `<span class="product-card__unavailable">Немає в наявності</span>`;
  return `
    <div class="product-card${p.available ? '' : ' product-card--unavailable'}">
      <a href="${productUrl}" class="product-card__img">${img}</a>
      <div class="product-card__body">
        <div class="product-card__vendor">${escHtml(p.vendor || '')}</div>
        <a href="${productUrl}" class="product-card__name" title="${escHtml(p.name)}">${escHtml(p.name)}</a>
        <div class="product-card__price">${fmtPrice(p.price)} <span class="product-card__price-sub">грн</span></div>
      </div>
      <div class="product-card__footer">${footer}</div>
    </div>`;
}

// ---- SKELETON CARDS ----
function renderSkeletons(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="product-card product-card--skeleton">
      <div class="product-card__img"><div class="skeleton" style="width:100%;height:100%"></div></div>
      <div class="product-card__body">
        <div class="skeleton skeleton-line skeleton-line--short"></div>
        <div class="skeleton skeleton-line skeleton-line--title"></div>
        <div class="skeleton skeleton-line skeleton-line--short"></div>
      </div>
      <div class="product-card__footer"><div class="skeleton" style="height:32px;width:100%;border-radius:6px"></div></div>
    </div>`).join('');
}

// ---- AUTO TRANSLATE ----
async function gtranslate(texts, toLang = 'uk') {
  const SEP = ' ||| ';
  const joined = texts.join(SEP);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${toLang}&dt=t&dt=ld&q=${encodeURIComponent(joined)}`;
  const res = await fetch(url);
  const data = await res.json();
  const detectedLang = data[2];
  const translatedJoined = (data[0] || []).map(c => c[0]).join('');
  const results = translatedJoined.split(SEP).map(s => s.trim());
  return { results, detectedLang };
}

// ---- UTILITIES ----
function fmtPrice(n) {
  return Number(n).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ---- ORDER MODAL HTML ----
function injectOrderModal() {
  if (document.getElementById('orderOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="orderOverlay" onclick="if(event.target===this)OrderModal.close()">
      <div class="modal">
        <button class="modal__close" onclick="OrderModal.close()">✕</button>
        <h3>Оформити замовлення</h3>
        <p class="modal__product-name"></p>
        <div style="font-size:1.2rem;font-weight:800;color:var(--accent);margin-bottom:20px" class="modal__product-price"></div>
        <div class="modal-form">
          <form onsubmit="OrderModal.submit(event)">
            <div class="form-group">
              <label>Ваше ім'я *</label>
              <input type="text" name="name" placeholder="Іван Петренко" required>
            </div>
            <div class="form-group">
              <label>Телефон *</label>
              <input type="tel" name="phone" placeholder="+380 XX XXX XX XX" required>
            </div>
            <div class="form-group">
              <label>Коментар</label>
              <textarea name="comment" placeholder="Додаткові побажання..."></textarea>
            </div>
            <button type="submit" class="btn btn--primary btn--full btn--lg">Створити замовлення</button>
            <p class="hint text-center" style="margin-top:10px;color:var(--text-muted);font-size:.78rem">Менеджер зв'яжеться з вами протягом 30 хвилин</p>
          </form>
        </div>
        <div class="modal-success">
          <div class="modal-success__icon">✓</div>
          <h4>Заявку прийнято!</h4>
          <p>Наш менеджер зв'яжеться з вами найближчим часом.</p>
          <button class="btn btn--primary" style="margin-top:20px" onclick="OrderModal.close()">Закрити</button>
        </div>
      </div>
    </div>`);
}

// ---- CART HTML ----
function injectCart() {
  if (document.getElementById('cartSidebar')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="cart-overlay" id="cartOverlay" onclick="closeCart()"></div>
    <div class="cart-sidebar" id="cartSidebar">
      <div class="cart-header">
        <h3>🛒 Кошик</h3>
        <button class="cart-close" onclick="closeCart()">✕</button>
      </div>
      <div class="cart-items" id="cartItems"></div>
      <div class="cart-footer" id="cartFooter">
        <div class="cart-total">
          <span>Разом:</span>
          <strong id="cartTotal">0 грн</strong>
        </div>
        <a href="checkout.html?cart=1" class="btn btn--primary btn--full" style="justify-content:center">Оформити замовлення</a>
      </div>
    </div>`);
}

function checkoutFromCart() {
  if (Cart.items.length === 0) return;
  const names = Cart.items.map(i => `${i.name.slice(0,40)} × ${i.qty}`).join('\n');
  OrderModal.open({
    id: 'cart',
    name: `Замовлення з кошика (${Cart.count()} позицій):\n${names}`,
    price: Cart.total(),
  });
  closeCart();
}

// ---- MOBILE MENU ----
function injectMobileMenu() {
  if (document.getElementById('mobileMenu')) return;
  // Add burger + search buttons to header actions
  const actions = document.querySelector('.header__actions');
  if (actions) {
    actions.insertAdjacentHTML('afterbegin', `
      <button class="mobile-search-btn" id="mobileSearchBtn" onclick="toggleMobileSearch()" title="Пошук">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
      <button class="burger-btn" id="burgerBtn" onclick="toggleMobileMenu()" title="Меню">
        <span></span><span></span><span></span>
      </button>`);
  }
  // Inject mobile menu drawer
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = [
    { href: 'index.html', label: '🏠 Головна' },
    { href: 'catalog.html', label: '📦 Каталог' },
    { href: 'delivery.html', label: '🚚 Доставка' },
  ];
  document.body.insertAdjacentHTML('beforeend', `
    <div class="mobile-overlay" id="mobileOverlay" onclick="closeMobileMenu()"></div>
    <div class="mobile-menu" id="mobileMenu">
      <div class="mobile-menu__head">
        <a href="index.html" class="logo">
          <div class="logo__mark">К</div>
          <div><span class="logo__text">Краса.ua</span></div>
        </a>
        <button onclick="closeMobileMenu()">✕</button>
      </div>
      <div class="mobile-menu__search">
        <input type="text" id="mobileMenuSearch" placeholder="Пошук товарів..." onkeydown="if(event.key==='Enter')doMobileSearch()">
        <button onclick="doMobileSearch()">Знайти</button>
      </div>
      <nav class="mobile-menu__nav">
        ${navLinks.map(l => `<a href="${l.href}"${l.href === currentPage ? ' class="active"' : ''}>${l.label}</a>`).join('')}
      </nav>
    </div>`);
}

function toggleMobileMenu() {
  document.getElementById('mobileMenu')?.classList.toggle('open');
  document.getElementById('mobileOverlay')?.classList.toggle('open');
  document.body.classList.toggle('menu-open');
}
function closeMobileMenu() {
  document.getElementById('mobileMenu')?.classList.remove('open');
  document.getElementById('mobileOverlay')?.classList.remove('open');
  document.body.classList.remove('menu-open');
}
function toggleMobileSearch() {
  const wrap = document.querySelector('.header__search');
  if (!wrap) return;
  const isOpen = wrap.classList.toggle('mobile-open');
  if (isOpen) wrap.querySelector('input')?.focus();
}
function doMobileSearch() {
  const q = document.getElementById('mobileMenuSearch')?.value.trim();
  if (q) window.location.href = `catalog.html?search=${encodeURIComponent(q)}`;
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initHeaderSearch();
  injectOrderModal();
  injectCart();
  injectMobileMenu();
  Cart.load();
});
