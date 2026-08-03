// ============================================================
//  الأون لاين — رومات عبر المتصفح مباشرة (WebRTC)، بلا خادم لعب.
//
//  لا تمرّ اللعبة بأي خادم: الاتصال بين أجهزة اللاعبين مباشرةً.
//  نقطة الالتقاء (Broker) تُستخدم مرة واحدة فقط لتبادل عناوين
//  الاتصال، ثم تُهمَل — لأن متصفحَين لا يستطيعان إيجاد بعضهما من العدم.
//
//  ناقلان:
//   • local  : BroadcastChannel — لاعبون على نفس الجهاز (نوافذ متعددة).
//   • p2p    : WebRTC عبر وسيط PeerJS — لاعبون حقيقيون عبر الإنترنت.
//
//  الشكل: نجمة — أول من يدخل الروم يصير مضيفاً ويمرّر الرسائل،
//  وهو ليس خادماً بل لاعب عادي مثل الجميع.
// ============================================================
import { uid, rnd } from '../core/util.js';

export const NET_STATE = {
  IDLE: 'idle', SEARCH: 'search', WAIT: 'wait', READY: 'ready', PLAY: 'play', ERROR: 'error',
};

const ROOM_SLOTS = 8;            // عدد الرومات التي نجرّبها قبل إنشاء واحد
const CONNECT_TIMEOUT = 4500;

// ------------------------------------------------------------
//  ناقل محلي: نوافذ متعددة على نفس الجهاز (يُستخدم للاختبار واللعب المحلي)
// ------------------------------------------------------------
class LocalTransport {
  constructor(room, self) {
    this.room = room; this.self = self;
    this.ch = new BroadcastChannel('royal-room-' + room);
    this.onMessage = null; this.onPeer = null; this.onLeave = null;
    this.peers = new Set();
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.self) return;
      if (m.t === 'hello') {
        if (!this.peers.has(m.from)) { this.peers.add(m.from); this.onPeer?.(m.from); }
        this.ch.postMessage({ t: 'hi', from: this.self, to: m.from });
        return;
      }
      if (m.t === 'hi' && m.to === this.self) {
        if (!this.peers.has(m.from)) { this.peers.add(m.from); this.onPeer?.(m.from); }
        return;
      }
      if (m.t === 'bye') { this.peers.delete(m.from); this.onLeave?.(m.from); return; }
      this.onMessage?.(m.from, m.d);
    };
  }
  start() { this.ch.postMessage({ t: 'hello', from: this.self }); }
  send(d) { this.ch.postMessage({ t: 'd', from: this.self, d }); }
  close() {
    try { this.ch.postMessage({ t: 'bye', from: this.self }); this.ch.close(); } catch (e) {}
  }
}

// ------------------------------------------------------------
//  ناقل WebRTC عبر وسيط PeerJS (بروتوكول مُنفَّذ يدوياً — بلا مكتبات)
// ------------------------------------------------------------
class PeerTransport {
  constructor({ broker, key, id, onOpen, onError }) {
    this.broker = broker || 'wss://0.peerjs.com/peerjs';
    this.key = key || 'peerjs';
    this.id = id;
    this.token = Math.random().toString(36).slice(2);
    this.conns = new Map();          // peerId -> {pc, dc}
    this.onMessage = null; this.onPeer = null; this.onLeave = null;
    this.onOpen = onOpen; this.onError = onError;
    this.ice = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }

  connectBroker() {
    return new Promise((res, rej) => {
      const url = `${this.broker}?key=${this.key}&id=${encodeURIComponent(this.id)}&token=${this.token}`;
      let done = false;
      const ws = this.ws = new WebSocket(url);
      const to = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) {} rej(new Error('انتهت مهلة الوسيط')); } }, 8000);
      ws.onopen = () => { /* ننتظر رسالة OPEN */ };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(to); rej(new Error('تعذّر الوصول للوسيط')); } };
      ws.onclose = () => { if (!done) { done = true; clearTimeout(to); rej(new Error('أُغلق الوسيط')); } };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.type === 'OPEN') {
          if (!done) { done = true; clearTimeout(to); res(); }
          this.onOpen?.();
          this._hb = setInterval(() => { try { ws.send(JSON.stringify({ type: 'HEARTBEAT' })); } catch (x) {} }, 20000);
          return;
        }
        if (m.type === 'ID-TAKEN') {
          if (!done) { done = true; clearTimeout(to); rej(new Error('ID-TAKEN')); }
          return;
        }
        this._signal(m);
      };
    });
  }

  _sig(dst, payload, type) {
    this.ws?.send(JSON.stringify({ type, dst, payload }));
  }

  async _signal(m) {
    const src = m.src;
    if (m.type === 'OFFER') {
      const c = this._mk(src, false);
      await c.pc.setRemoteDescription(m.payload.sdp);
      const ans = await c.pc.createAnswer();
      await c.pc.setLocalDescription(ans);
      this._sig(src, { sdp: c.pc.localDescription, connectionId: m.payload.connectionId,
                       type: 'data', browser: 'chrome' }, 'ANSWER');
    } else if (m.type === 'ANSWER') {
      const c = this.conns.get(src);
      if (c) await c.pc.setRemoteDescription(m.payload.sdp);
    } else if (m.type === 'CANDIDATE') {
      const c = this.conns.get(src);
      if (c && m.payload.candidate) { try { await c.pc.addIceCandidate(m.payload.candidate); } catch (e) {} }
    } else if (m.type === 'EXPIRE' || m.type === 'LEAVE') {
      this._drop(src);
    }
  }

  _mk(peer, initiator) {
    let c = this.conns.get(peer);
    if (c) return c;
    const pc = new RTCPeerConnection(this.ice);
    c = { pc, dc: null, open: false };
    this.conns.set(peer, c);
    const connId = 'dc_' + Math.random().toString(36).slice(2, 9);
    pc.onicecandidate = (e) => {
      if (e.candidate) this._sig(peer, { candidate: e.candidate, connectionId: connId, type: 'data' }, 'CANDIDATE');
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._drop(peer);
    };
    const bind = (dc) => {
      c.dc = dc;
      dc.onopen = () => { c.open = true; this.onPeer?.(peer); };
      dc.onclose = () => this._drop(peer);
      dc.onmessage = (e) => {
        let d; try { d = JSON.parse(e.data); } catch (x) { return; }
        this.onMessage?.(peer, d);
      };
    };
    if (initiator) {
      bind(pc.createDataChannel(connId, { ordered: false, maxRetransmits: 0 }));
      pc.createOffer().then(async (o) => {
        await pc.setLocalDescription(o);
        this._sig(peer, { sdp: pc.localDescription, type: 'data', connectionId: connId,
                          label: connId, reliable: false, serialization: 'json',
                          browser: 'chrome' }, 'OFFER');
      });
    } else {
      pc.ondatachannel = (e) => bind(e.channel);
    }
    return c;
  }

  _drop(peer) {
    const c = this.conns.get(peer);
    if (!c) return;
    try { c.dc?.close(); c.pc.close(); } catch (e) {}
    this.conns.delete(peer);
    this.onLeave?.(peer);
  }

  /** يحاول الاتصال بمضيف معيّن، ويعود true إن نجح خلال المهلة */
  async dial(peerId, timeout = CONNECT_TIMEOUT) {
    const c = this._mk(peerId, true);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (c.open) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    this._drop(peerId);
    return false;
  }

  send(d) {
    const s = JSON.stringify(d);
    for (const c of this.conns.values()) {
      if (c.open) { try { c.dc.send(s); } catch (e) {} }
    }
  }
  sendTo(peer, d) {
    const c = this.conns.get(peer);
    if (c?.open) { try { c.dc.send(JSON.stringify(d)); } catch (e) {} }
  }
  close() {
    clearInterval(this._hb);
    for (const p of [...this.conns.keys()]) this._drop(p);
    try { this.ws?.close(); } catch (e) {}
  }
}

// ------------------------------------------------------------
//  الروم
// ------------------------------------------------------------
export class Net {
  constructor(opts = {}) {
    this.opts = opts;
    this.state = NET_STATE.IDLE;
    this.self = 'p_' + Math.random().toString(36).slice(2, 9);
    this.isHost = false;
    this.room = null;
    this.players = new Map();        // id -> {id, name, hero, state}
    this.onStateChange = opts.onStateChange || (() => {});
    this.onPlayers = opts.onPlayers || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.onLog = opts.onLog || (() => {});
  }

  set(s, info) { this.state = s; this.onStateChange(s, info); }

  /**
   * ينضم لروم: يجرّب رومات موجودة ثم ينشئ واحداً.
   * transport: 'auto' | 'p2p' | 'local'
   */
  async join({ mode = 'solo', transport = 'auto', code = null, broker = null, name = 'لاعب', hero = null } = {}) {
    this.mode = mode; this.name = name; this.hero = hero;
    this.set(NET_STATE.SEARCH, 'بحث عن روم…');

    const wantLocal = transport === 'local';
    if (!wantLocal) {
      try {
        const ok = await this._joinP2P({ mode, code, broker });
        if (ok) return true;
      } catch (e) {
        this.onLog('p2p: ' + e.message);
        if (transport === 'p2p') { this.set(NET_STATE.ERROR, e.message); return false; }
      }
    }
    // ناقل محلي: لاعبون على نفس الجهاز (نوافذ متعددة)
    return this._joinLocal({ mode, code });
  }

  async _joinP2P({ mode, code, broker }) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('المتصفح لا يدعم WebRTC');
    const base = code ? `royalx-${code}` : `royalx-${mode}`;
    const slots = code ? [0] : Array.from({ length: ROOM_SLOTS }, (_, i) => i)
      .sort(() => Math.random() - 0.5);

    for (const i of slots) {
      const roomId = code ? base : `${base}-${i}`;
      const hostId = `${roomId}-host`;

      // (1) جرّب الانضمام كعميل
      try {
        const t = new PeerTransport({ broker, id: `${roomId}-${this.self}` });
        await t.connectBroker();
        this.set(NET_STATE.SEARCH, `محاولة دخول روم ${i + 1}…`);
        const ok = await t.dial(hostId);
        if (ok) {
          this._attach(t, roomId, false);
          t.send({ t: 'join', id: this.self, name: this.name, hero: this.hero });
          this.set(NET_STATE.WAIT, 'دخلت الروم — بانتظار اللاعبين');
          return true;
        }
        t.close();
      } catch (e) { this.onLog('slot ' + i + ': ' + e.message); }

      // (2) لا يوجد مضيف → كن أنت المضيف
      try {
        const t = new PeerTransport({ broker, id: hostId });
        await t.connectBroker();
        this._attach(t, roomId, true);
        this.set(NET_STATE.WAIT, 'أنشأتَ روماً — بانتظار لاعبين');
        return true;
      } catch (e) {
        if (e.message !== 'ID-TAKEN') this.onLog('host ' + i + ': ' + e.message);
        // الروم صار مشغولاً بين اللحظتين — جرّب التالي
      }
    }
    throw new Error('تعذّر الوصول إلى وسيط الرومات');
  }

  _joinLocal({ mode, code }) {
    const roomId = code ? `local-${code}` : `local-${mode}`;
    const t = new LocalTransport(roomId, this.self);
    this._attach(t, roomId, true);
    t.start();
    t.send?.({ t: 'join', id: this.self, name: this.name, hero: this.hero });
    this.set(NET_STATE.WAIT, 'روم محلي (نوافذ هذا الجهاز)');
    return true;
  }

  _attach(t, roomId, isHost) {
    this.t = t;
    this.room = roomId;
    this.isHost = isHost;
    this.players.set(this.self, { id: this.self, name: this.name, hero: this.hero, self: true });

    t.onPeer = (peer) => {
      this.onLog('انضم: ' + peer);
      t.sendTo?.(peer, { t: 'join', id: this.self, name: this.name, hero: this.hero });
      t.send({ t: 'join', id: this.self, name: this.name, hero: this.hero });
      this.onPlayers([...this.players.values()]);
    };
    t.onLeave = (peer) => {
      for (const [id, p] of this.players) if (p.peer === peer) this.players.delete(id);
      this.onPlayers([...this.players.values()]);
    };
    t.onMessage = (peer, d) => this._recv(peer, d);
  }

  _recv(peer, d) {
    if (!d || !d.t) return;
    // المضيف يمرّر كل شيء لبقية اللاعبين (شكل النجمة)
    if (this.isHost && d.t !== 'relay') {
      this.t.send({ ...d, _r: 1 });
    }
    switch (d.t) {
      case 'join': {
        if (d.id === this.self) return;
        if (!this.players.has(d.id)) {
          this.players.set(d.id, { id: d.id, name: d.name, hero: d.hero, peer });
          this.onPlayers([...this.players.values()]);
          this.t.sendTo?.(peer, { t: 'join', id: this.self, name: this.name, hero: this.hero });
        }
        break;
      }
      case 'state': {
        const p = this.players.get(d.id);
        if (p) { p.state = d.s; p.last = performance.now(); }
        break;
      }
      case 'ev': this.onEvent(d.id, d.e); break;
      case 'start': this.onEvent(d.id, { k: 'start', seed: d.seed, path: d.path }); break;
      case 'left': {
        this.players.delete(d.id);
        this.onPlayers([...this.players.values()]);
        break;
      }
    }
  }

  /** يرسل حالة اللاعب (موضع/دوران/حركة) */
  sendState(s) { this.t?.send({ t: 'state', id: this.self, s }); }
  /** حدث لمرة واحدة: إطلاق، إصابة، موت… */
  sendEvent(e) { this.t?.send({ t: 'ev', id: this.self, e }); this.onEvent(this.self, e); }
  /** المضيف يبدأ المباراة بنفس البذرة والمسار للجميع */
  startMatch(seed, path) {
    this.t?.send({ t: 'start', id: this.self, seed, path });
    this.set(NET_STATE.PLAY, 'بدأت المباراة');
  }

  count() { return this.players.size; }

  leave() {
    try { this.t?.send({ t: 'left', id: this.self }); } catch (e) {}
    this.t?.close();
    this.t = null;
    this.players.clear();
    this.set(NET_STATE.IDLE, '');
  }
}
