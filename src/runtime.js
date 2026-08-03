// ============================================================
//  زمن التشغيل — القائمة الرئيسية ← المباراة ← العودة
//  يُستخدم في «تجربة اللعبة» داخل المحرّر وفي الملف المُصدَّر
// ============================================================
import { el, toast } from './core/util.js';
import * as A from './core/audio.js';
import { Lobby, friendsPanel, shopPanel, settingsPanel, characterPanel } from './game/lobby.js';
import { Game } from './game/game.js';

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
    if (d.character) {
      const at = project.lobby.character.attachments;
      Object.assign(project.lobby.character, d.character);
      project.lobby.character.attachments = at;
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
        characterPanel(this.P, () => this.savePrefs(), () => this.lobby?.preview?.refreshAll());
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
        onExit: () => this.showLobby(),
        onRestart: () => this.play(),
      });
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
        character: { ...this.P.lobby.character, attachments: undefined },
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
