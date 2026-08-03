// ============================================================
//  زمن التشغيل — القائمة الرئيسية ← المباراة ← العودة
//  يُستخدم في «تجربة اللعبة» داخل المحرّر وفي الملف المُصدَّر
// ============================================================
import { el, toast } from './core/util.js';
import * as A from './core/audio.js';
import { Lobby, friendsPanel, shopPanel, settingsPanel, heroesPanel } from './game/lobby.js';
import { Game } from './game/game.js';
import { Net, NET_STATE } from './game/net.js';
import { currentHero } from './core/store.js';

const PREFS_KEY = 'royal-game-prefs-v1';

/** يدمج تفضيلات محفوظة سابقاً في هذا المتصفح */
export function loadPrefs(project) {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return project;
    const d = JSON.parse(raw);
    if (d.match) Object.assign(project.match, d.match);
    if (d.player) Object.assign(project.player, d.player);
    if (d.friends) project.lobby.friends = d.friends;
    if (d.selectedHero && project.lobby.heroes?.find((h) => h.id === d.selectedHero)) {
      project.lobby.selectedHero = d.selectedHero;
    }
  } catch (e) { /* تجاهل */ }
  return project;
}

export async function launchRuntime(host, project, { onExit, onEditChar } = {}) {
  A.applySettings(project.match);
  const app = new Runtime(host, project, { onExit, onEditChar });
  await app.showLobby();
  return app;
}

class Runtime {
  constructor(host, project, opts) {
    this.host = host;
    this.P = project;
    this.opts = opts || {};
    this.node = el('div', { style: { position: 'absolute', inset: '0', overflow: 'hidden' } });
    host.append(this.node);
    window.__runtime = this;    // للتشخيص
    this._unlock = () => { A.unlock(); if (this.P.match.music && this.lobby) A.startMusic(); };
    addEventListener('pointerdown', this._unlock, { once: true });
  }

  async showLobby() {
    this.game?.dispose(); this.game = null;
    this.lobby?.dispose();
    this.node.innerHTML = '';
    if (this.P.match.music) A.startMusic();
    this.lobby = new Lobby(this.node, this.P, {
      onAction: (b) => this.action(b),
    });
  }

  action(b) {
    switch (b.kind) {
      case 'play': this.play(); break;
      case 'friends': friendsPanel(this.P, () => this.savePrefs()); break;
      case 'shop': shopPanel(this.P, () => {}, false); break;
      case 'settings': settingsPanel(this.P, () => this.savePrefs()); break;
      case 'brawlers': case 'skins':
        heroesPanel(this.P, () => this.savePrefs(),
          () => this.lobby?.preview?.setHero(currentHero(this.P)));
        break;
      case 'club': toast('الاتحاد: قريباً 🛡️'); break;
      case 'news': toast('📰 مرحباً بك في بطل رويال!'); break;
      case 'quests': toast('📋 المهام: أسقِط 3 خصوم'); break;
      default: toast(b.label);
    }
  }

  async play() {
    A.stopMusic();
    this.lobby?.dispose(); this.lobby = null;
    this.node.innerHTML = '';
    if (this.P.match.online) { await this.playOnline(); return; }
    await this.startMatch(null);
  }

  /** أون لاين: ابحث عن روم، انتظر اللاعبين، ثم ابدأ */
  async playOnline() {
    const M = this.P.match;
    const box = el('div', { class: 'netbox' });
    const title = el('div', { class: 'nt' }, '🌐 البحث عن روم…');
    const sub = el('div', { class: 'ns' }, 'جارٍ الاتصال…');
    const list = el('div', { class: 'nplayers' });
    const log = el('div', { class: 'nlog' });
    const codeIn = el('input', { type: 'text', placeholder: 'رمز روم للأصدقاء (اختياري)',
      value: this._lastCode || '' });
    const bar = el('div', { class: 'bar' }, el('i'));
    const btnStart = el('button', { class: 'btn y', style: { display: 'none' } }, '▶️ ابدأ الآن');
    const btnCancel = el('button', { class: 'btn ghost' }, '✕ إلغاء');
    const btnBots = el('button', { class: 'btn ghost' }, '🤖 العب ضد الروبوتات بدلاً من ذلك');
    box.append(title, sub, bar, list,
      el('div', { class: 'field', style: { marginTop: '12px' } },
        el('label', {}, 'رمز الروم — أدخل نفس الرمز مع أصدقائك للّعب معاً'), codeIn),
      el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, btnStart, btnCancel, btnBots),
      log);
    const host = el('div', { id: 'netscreen' }, el('div', { class: 'scene-bg' }), box);
    this.node.append(host);

    const net = this.net = new Net({
      onStateChange: (st, info) => {
        sub.textContent = info || st;
        bar.querySelector('i').style.width =
          ({ search: 35, wait: 70, ready: 90, play: 100 }[st] || 10) + '%';
        if (st === NET_STATE.ERROR) { title.textContent = '⚠️ تعذّر الاتصال'; btnStart.style.display = 'none'; }
      },
      onPlayers: (ps) => {
        list.innerHTML = '';
        for (const p of ps) {
          list.append(el('div', { class: 'nplayer' + (p.self ? ' me' : '') },
            el('span', {}, '🙂'), el('b', {}, p.name || 'لاعب'), p.self ? el('i', {}, 'أنت') : null));
        }
        title.textContent = `🌐 الروم: ${ps.length} لاعب`;
        btnStart.style.display = net.isHost && ps.length >= 1 ? '' : 'none';
      },
      onLog: (m) => { log.textContent = m; },
    });

    let cancelled = false;
    btnCancel.onclick = () => { cancelled = true; net.leave(); this.net = null; this.showLobby(); };
    btnBots.onclick = () => {
      cancelled = true; net.leave(); this.net = null;
      this.P.match.online = false; this.P.match.mode = 'solo';
      this.node.innerHTML = ''; this.startMatch(null);
    };
    btnStart.onclick = () => { if (!cancelled) go(); };

    const code = (codeIn.value || '').trim() || null;
    this._lastCode = code;
    const okJoin = await net.join({
      mode: M.mode, transport: M.netTransport || 'auto', code,
      broker: M.netBroker || null, name: this.P.player.name,
      hero: currentHero(this.P),
    });
    if (cancelled) return;
    if (!okJoin) { sub.textContent = 'لم أستطع الوصول لأي روم. جرّب رمزاً أو العب ضد الروبوتات.'; return; }

    // عدّاد انتظار: يبدأ تلقائياً بعد المهلة
    let left = M.netWait || 25;
    const go = async () => {
      clearInterval(tick);
      if (cancelled) return;
      host.remove();
      await this.startMatch(net);
    };
    const tick = setInterval(() => {
      if (cancelled) { clearInterval(tick); return; }
      left--;
      const n = net.count();
      sub.textContent = n >= (M.netMinPlayers || 2)
        ? `يبدأ خلال ${left}ث — ${n} لاعبين`
        : `بانتظار لاعبين… (${left}ث) — أنت وحدك حتى الآن`;
      if (left <= 0) go();
    }, 1000);
    net.onEvent = (from, e) => {
      if (e?.k === 'start') go();
      this.game?.netEvent(from, e);
    };
  }

  async startMatch(net) {
    this.node.innerHTML = '';

    const loader = el('div', { id: 'loader', style: { position: 'absolute' } },
      el('div', { class: 'box' },
        el('div', { class: 'ttl' }, '👑 ' + (this.P.meta.name || 'بطل رويال')),
        el('div', { class: 'sub' }, 'تحضير المعركة…'),
        el('div', { class: 'bar' }, el('i'))));
    this.node.append(loader);
    const setP = (p, t) => {
      loader.querySelector('.bar>i').style.width = (p * 100) + '%';
      if (t) loader.querySelector('.sub').textContent = t;
    };

    try {
      this.game = new Game(this.node, this.P, {
        onExit: () => { this.net?.leave(); this.net = null; this.showLobby(); },
        onRestart: () => this.play(),
        net,
      });
      if (net) net.onEvent = (from, e) => this.game?.netEvent(from, e);
      window.__game = this.game;   // للتشخيص
      await this.game.start(setP);
      setTimeout(() => loader.remove(), 420);
    } catch (e) {
      console.error(e);
      loader.querySelector('.sub').textContent = 'خطأ: ' + e.message;
      loader.querySelector('.sub').style.color = '#ff8a95';
      const back = el('button', { class: 'btn ghost', style: { marginTop: '14px' },
        onclick: () => this.showLobby() }, '← رجوع');
      loader.querySelector('.box').append(back);
    }
  }

  /** حفظ تفضيلات اللاعب داخل المتصفح (يعمل في الملف المُصدَّر أيضاً) */
  savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        match: this.P.match,
        friends: this.P.lobby.friends,
        selectedHero: this.P.lobby.selectedHero,
        player: this.P.player,
      }));
    } catch (e) { /* تجاهل */ }
    A.applySettings(this.P.match);
  }

  dispose() {
    removeEventListener('pointerdown', this._unlock);
    A.stopMusic();
    this.game?.dispose();
    this.lobby?.dispose();
    this.node.remove();
  }
}
