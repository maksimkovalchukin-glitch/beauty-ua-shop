/* =============================================
   CHAT.JS — Sidebar chat assistant via n8n webhook
   ============================================= */

const Chat = {
  isOpen: false,
  sessionId: null,
  _msgCount: 0,
  _pollTimer: null,

  init() {
    this.sessionId = 'sess_' + Math.random().toString(36).slice(2);
    this._inject();
    this._bindEvents();
    setTimeout(() => this._showWelcome(), 800);
  },

  _inject() {
    document.body.insertAdjacentHTML('beforeend', `
      <button class="chat-fab" id="chatFab" onclick="Chat.toggle()" title="Онлайн-консультант">
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="badge"></div>
      </button>

      <div class="chat-panel" id="chatPanel">
        <div class="chat-panel__head">
          <div class="chat-panel__avatar">💬</div>
          <div>
            <div class="chat-panel__name">Консультант</div>
            <div class="chat-panel__status">онлайн</div>
          </div>
          <button class="chat-panel__close" onclick="Chat.toggle()">✕</button>
        </div>
        <div class="chat-messages" id="chatMessages"></div>
        <div class="chat-input-row">
          <input type="text" id="chatInput" placeholder="Напишіть повідомлення...">
          <button class="chat-send" id="chatSendBtn" onclick="Chat.send()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>`);
  },

  _bindEvents() {
    const input = document.getElementById('chatInput');
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
  },

  toggle() {
    this.isOpen = !this.isOpen;
    document.getElementById('chatPanel')?.classList.toggle('open', this.isOpen);
    if (!this.isOpen) this._stopPoll();
    const fab = document.getElementById('chatFab');
    if (fab) fab.querySelector('.badge').style.display = this.isOpen ? 'none' : '';
    if (this.isOpen) {
      document.getElementById('chatInput')?.focus();
      this._scrollToBottom();
    }
  },

  _showWelcome() {
    this._addBotMessage('Привіт! 👋 Я консультант <b>Техно.ua</b>. Допоможу обрати гаджет, дізнатися про наявність або умови доставки.');
    setTimeout(() => {
      this._addQuickReplies([
        'Умови доставки',
        'Способи оплати',
        'Гарантія та повернення',
        'Є питання по товару',
      ]);
    }, 400);
    // Show badge on fab
    const badge = document.querySelector('#chatFab .badge');
    if (badge) badge.style.display = 'block';
  },

  _addBotMessage(html) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const time = new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg--bot';
    el.innerHTML = `
      <div class="chat-msg__bubble">${html}</div>
      <div class="chat-msg__time">${time}</div>`;
    msgs.appendChild(el);
    this._scrollToBottom();
  },

  _addUserMessage(text) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const time = new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg--user';
    el.innerHTML = `
      <div class="chat-msg__bubble">${escHtml(text)}</div>
      <div class="chat-msg__time">${time}</div>`;
    msgs.appendChild(el);
    this._scrollToBottom();
  },

  _addQuickReplies(options) {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return;
    const el = document.createElement('div');
    el.className = 'chat-quick';
    el.innerHTML = options.map(opt =>
      `<button class="chat-quick-btn" onclick="Chat._onQuickReply('${escHtml(opt)}', this.parentElement)">${escHtml(opt)}</button>`
    ).join('');
    msgs.appendChild(el);
    this._scrollToBottom();
  },

  _onQuickReply(text, container) {
    container?.remove();
    this._addUserMessage(text);
    this._sendToWebhook(text);
  },

  _showTyping() {
    const msgs = document.getElementById('chatMessages');
    if (!msgs) return null;
    const el = document.createElement('div');
    el.className = 'chat-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(el);
    this._scrollToBottom();
    return el;
  },

  _scrollToBottom() {
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  },

  send() {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    this._addUserMessage(text);
    this._sendToWebhook(text);
  },

  async _sendToWebhook(message) {
    const typing = this._showTyping();

    const payload = {
      message,
      sessionId: this.sessionId,
      shop: 'Краса.ua',
      page: window.location.pathname + window.location.search,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(CONFIG.webhooks.chat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      typing?.remove();

      typing?.remove();
      this._startPoll();
    } catch {
      typing?.remove();
    }
  },
  _startPoll() {
    this._stopPoll();
    if (!CONFIG.webhooks.chatPoll) return;
    this._pollTimer = setInterval(async () => {
      try {
        const res = await fetch(CONFIG.webhooks.chatPoll + '?sessionId=' + this.sessionId);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.reply) {
          this._addBotMessage(escHtml(data.reply).replace(/\n/g, '<br>'));
          const badge = document.querySelector('#chatFab .badge');
          if (badge && !this.isOpen) badge.style.display = 'block';
        }
      } catch {}
    }, 5000);
  },

  _stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

};

document.addEventListener('DOMContentLoaded', () => Chat.init());
