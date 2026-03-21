/* =============================================
   PRODUCT.JS — Product detail page
   ============================================= */

// Get plain text from HTML, preserving newlines
function descText(html) {
  if (!html) return '';
  // Already plain text (no HTML tags) — preserve newlines
  if (!/<[^>]+>/.test(html)) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/li>/gi, '\n');
  return tmp.textContent || '';
}

// Format plain text: paragraphs + spec lists, optionally strip product name from start
function formatPlainDesc(text, productName = '') {
  if (productName) {
    const n = productName.trim();
    if (text.trimStart().startsWith(n)) text = text.trimStart().slice(n.length).trimStart();
  }
  if (!text.trim()) return '';

  // Split on newlines first (preserves XML structure), then clean up
  const lines = text
    .split(/\n+/)
    .map(l => l.replace(/	/g, ' ').replace(/[ 	]+/g, ' ').trim())
    .filter(l => l.length > 2);

  const html = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul style="margin:0 0 14px;padding-left:18px;line-height:1.9">${listItems.map(i => `<li style="margin-bottom:3px">${escHtml(i)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    // Section header: ends with colon (e.g. "Насосна частина:")
    if (/^.{2,60}:\s*$/.test(line)) {
      flushList();
      html.push(`<p style="margin:16px 0 4px;font-weight:600;color:var(--text)">${escHtml(line.replace(/:\s*$/, ''))}</p>`);
      continue;
    }
    // Spec item: "Label: value" with label ≤ 45 chars
    const isSpec = /^[^:]{2,45}:\s*.+/.test(line) && line.length < 250;
    if (isSpec) {
      listItems.push(line);
    } else {
      flushList();
      html.push(`<p style="margin:0 0 14px;line-height:1.65">${escHtml(line)}</p>`);
    }
  }
  flushList();
  return html.join('');
}

const ProductPage = {
  product: null,
  activeImg: 0,

  async init() {
    const id     = getParam('id');
    const catId  = parseInt(getParam('cat'));
    if (!id || !catId) { this._error('Товар не знайдено'); return; }

    try {
      const products = await DataLoader.category(catId);
      const product  = products.find(p => p.id === id);
      if (!product) { this._error('Товар не знайдено'); return; }
      this.product = product;
      this._render(product, catId);
      this._loadRelated(products, id, catId);
    } catch {
      this._error('Помилка завантаження');
    }
  },

  _render(p, catId) {
    document.title = `${p.name} — ${CONFIG.shop.name}`;
    // Dynamic SEO meta tags
    const _desc = descText(p.description || `Купити ${p.name} з доставкою по Україні`).slice(0, 160);
    const _img = p.pictures && p.pictures[0] ? p.pictures[0] : '';
    const _url = `${CONFIG.shop.domain}/product.html?id=${p.id}&cat=${catId}`;
    const _sm = (id, attr, val) => { const el = document.getElementById(id); if (el && val) el.setAttribute(attr, val); };
    _sm('metaDesc', 'content', _desc);
    _sm('canonical', 'href', _url);
    _sm('ogUrl', 'content', _url);
    _sm('ogTitle', 'content', `${p.name} — ${CONFIG.shop.name}`);
    _sm('ogDesc', 'content', _desc);
    _sm('ogImage', 'content', _img);
    const _ld = document.createElement('script');
    _ld.type = 'application/ld+json';
    _ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: _desc, image: _img ? [_img] : undefined, sku: String(p.id), brand: p.vendor ? { '@type': 'Brand', name: p.vendor } : undefined, offers: { '@type': 'Offer', priceCurrency: 'UAH', price: p.price || 0, availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', seller: { '@type': 'Organization', name: CONFIG.shop.name } } });
    document.head.appendChild(_ld);

    const availBadge = p.available
      ? `<span class="tag tag--green">✓ В наявності</span>`
      : `<span class="tag" style="background:#fff5f5;color:#c53030;border:1px solid #fed7d7">✕ Немає в наявності</span>`;

    const imgs = p.pictures && p.pictures.length > 0 ? p.pictures : [];
    const mainImg = imgs[0] || '';

    const thumbsHtml = imgs.length > 1
      ? imgs.map((src, i) => `
          <div class="gallery__thumb${i === 0 ? ' active' : ''}" onclick="ProductPage.setImg(${i})">
            <img src="${src}" alt="" loading="lazy" onerror="this.closest('.gallery__thumb').remove()">
          </div>`).join('')
      : '';

    const specsHtml = p.params && p.params.length > 0
      ? `<table class="specs-table">
          ${p.params.map(param => `
            <tr>
              <td>${escHtml(param.name || '')}</td>
              <td>${escHtml(param.value || '')}</td>
            </tr>`).join('')}
        </table>`
      : '';

    const catLink = `catalog.html?cat=${catId}`;

    // Description: first 3 sentences as formatted paragraphs, rest hidden
    let descHtml = '';
    if (p.description) {
      const plain = descText(p.description);
      const sections = plain.split(/\n+/).map(l => l.trim()).filter(l => l.length > 2);
      const preview = sections.slice(0, 2).join('\n');
      const hasMore = sections.length > 2;
      descHtml = `<div class="product-info__desc" id="descBlock">
        <div id="descText">${formatPlainDesc(preview, p.name)}${hasMore ? `<a href="#" style="color:var(--accent);font-size:.85rem" onclick="ProductPage.showFullDesc(event)">Читати більше →</a>` : ''}</div>
      </div>`;
    }

    document.getElementById('productLayout').innerHTML = `
      <!-- Gallery -->
      <div class="gallery">
        <nav class="breadcrumb">
          <a href="index.html">Головна</a>
          <span class="breadcrumb__sep">›</span>
          <a href="${catLink}" class="breadcrumb__current" id="catBreadcrumb">Категорія</a>
          <span class="breadcrumb__sep">›</span>
          <span style="color:var(--text-2);font-weight:500">${escHtml(p.name.slice(0, 50))}${p.name.length > 50 ? '...' : ''}</span>
        </nav>
        <div class="gallery__main" onclick="ProductPage.openLightbox()" id="galleryMain">
          ${mainImg
            ? `<img src="${mainImg}" alt="${escHtml(p.name)}" id="mainImg" onerror="this.outerHTML='<span style=\\'font-size:5rem;color:var(--border)\\'>📦</span>'">`
            : `<span style="font-size:5rem;color:var(--border)">📦</span>`}
        </div>
        ${thumbsHtml ? `<div class="gallery__thumbs">${thumbsHtml}</div>` : ''}
      </div>

      <!-- Product Info -->
      <div class="product-info">
        <div style="margin-top:48px"></div>
        <div class="product-info__meta">
          ${p.vendor ? `<span class="product-info__vendor">${escHtml(p.vendor)}</span>` : ''}
          ${p.vendorCode ? `<span class="product-info__code">Код: ${escHtml(p.vendorCode)}</span>` : ''}
          ${availBadge}
        </div>

        <h1>${escHtml(p.name)}</h1>

        <div class="product-info__price-row">
          <span class="product-info__price">${fmtPrice(p.price)}</span>
          <span class="product-info__currency">грн</span>
        </div>

        <div class="product-info__actions">
          <button class="btn btn--secondary" onclick="ProductPage.addToCart()">
            🛒 В кошик
          </button>
          <button class="btn btn--primary" onclick="window.location.href='checkout.html?id='+ProductPage.product.id+'&cat='+ProductPage.product.categoryId">
            ⚡ Замовити зараз
          </button>
        </div>

        ${descHtml}

        ${specsHtml ? `
          <div>
            <div style="font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:12px">Характеристики</div>
            ${specsHtml}
          </div>` : ''}

        <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--text-muted)">
              🚚 <span>Доставка Нова пошта</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--text-muted)">
              🔄 <span>Повернення 14 днів</span>
            </div>
          </div>
        </div>
      </div>`;

    // Load category name for breadcrumb
    DataLoader.catalog().then(cat => {
      const catObj = cat.allCats.find(c => c.id === catId);
      if (catObj) {
        const el = document.getElementById('catBreadcrumb');
        if (el) el.textContent = catObj.name;
      }
    }).catch(() => {});
  },

  setImg(idx) {
    if (!this.product?.pictures) return;
    this.activeImg = idx;
    const mainImg = document.getElementById('mainImg');
    if (mainImg) mainImg.src = this.product.pictures[idx];
    document.querySelectorAll('.gallery__thumb').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
  },

  openLightbox() {
    if (!this.product?.pictures?.[this.activeImg]) return;
    const src = this.product.pictures[this.activeImg];
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    overlay.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px">`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  },

  showFullDesc(e) {
    e.preventDefault();
    const el = document.getElementById('descText');
    if (!el || !this.product?.description) return;
    const plain = descText(this.product.description);
    el.innerHTML = formatPlainDesc(plain);
  },

  addToCart() {
    if (!this.product) return;
    Cart.add(this.product);
    toggleCart();
  },

  _loadRelated(products, currentId, catId) {
    const related = products
      .filter(p => p.id !== currentId && p.available && p.pictures?.length > 0)
      .slice(0, 4);
    if (related.length === 0) return;
    const section = document.getElementById('relatedSection');
    const grid = document.getElementById('relatedGrid');
    const link = document.getElementById('relatedLink');
    if (!section || !grid) return;
    grid.innerHTML = related.map(renderProductCard).join('');
    if (link) link.href = `catalog.html?cat=${catId}`;
    section.style.display = '';
  },

  _error(msg) {
    document.getElementById('productLayout').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state__icon">😕</div>
        <h3>${escHtml(msg)}</h3>
        <a href="catalog.html" class="btn btn--primary" style="margin-top:16px">До каталогу</a>
      </div>`;
  },
};

document.addEventListener('DOMContentLoaded', () => ProductPage.init());

// ---- AUTO TRANSLATE (ru → uk) ----
async function autoTranslateProduct(product) {
  try {
    // Collect texts to translate
    const h1 = document.querySelector('.product-info h1');
    const descEl = document.getElementById('descText');
    const specCells = [...document.querySelectorAll('.specs-table td')];

    const texts = [];
    if (h1) texts.push(h1.textContent.trim());
    if (descEl) texts.push(descEl.textContent.replace(/Читати більше →?/, '').trim());
    specCells.forEach(td => texts.push(td.textContent.trim()));

    if (!texts[0]) return;

    const { results, detectedLang } = await gtranslate(texts);
    if (detectedLang === 'uk') return; // already Ukrainian

    let i = 0;
    if (h1 && results[i]) {
      h1.textContent = results[i];
      document.title = `${results[i]} — ${CONFIG.shop.name}`;
    }
    i++;

    if (descEl && results[i]) {
      const translated = results[i];
      const hasMore = document.querySelector('#descText a');
      const tSections = translated.split(/\n+/).map(l => l.trim()).filter(l => l.length > 2);
      const preview = tSections.slice(0, 2).join('\n');
      descEl.innerHTML = formatPlainDesc(preview, h1 ? h1.textContent : '') + (hasMore ? `<a href="#" style="color:var(--accent);font-size:.85rem" onclick="ProductPage.showFullDesc(event)">Читати більше →</a>` : '');
      // Store translated full text for showFullDesc
      if (product._translatedDesc === undefined) product._translatedDesc = translated;
    }
    i++;

    specCells.forEach((td, idx) => {
      if (results[i + idx]) td.textContent = results[i + idx];
    });

  } catch (e) {
    console.warn('Translation failed:', e);
  }
}

// Hook into ProductPage._render to trigger translation after render
const _origRender = ProductPage._render.bind(ProductPage);
ProductPage._render = function(p, catId) {
  _origRender(p, catId);
  setTimeout(() => autoTranslateProduct(p), 300);
};

// Override showFullDesc to use translated text if available
const _origShowFullDesc = ProductPage.showFullDesc.bind(ProductPage);
ProductPage.showFullDesc = function(e) {
  e.preventDefault();
  const el = document.getElementById('descText');
  if (!el) return;
  const translated = this.product?._translatedDesc;
  const plain = translated || descText(this.product?.description || '');
  el.innerHTML = formatPlainDesc(plain, this.product?.name || '');
};
