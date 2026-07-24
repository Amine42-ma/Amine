/* =========================================================================
 * network.js — Online multiplayer (peer-to-peer, host-authoritative)
 *
 * Uses Trystero (loaded on demand from a CDN) for serverless WebRTC:
 *   • Create Room  → a short code; a friend joins with that code.
 *   • Join Room    → enter a friend's code.
 *   • Quick Match  → everyone joins a shared lobby and gets paired with the
 *                    next available online player.
 *
 * The HOST runs the authoritative physics simulation and streams compact
 * world snapshots to the GUEST; the GUEST streams its input back. If the
 * networking library can't be loaded (offline / blocked), online is disabled
 * gracefully and the rest of the game is unaffected.
 * ========================================================================= */
'use strict';

class NetworkManager extends Utils.Emitter {
  constructor() {
    super();
    this.lib = null;             // Trystero module
    this.room = null;
    this.role = null;            // 'host' | 'guest'
    this.selfId = null;
    this.peerId = null;
    this.connected = false;
    this.roomCode = null;
    this.appId = 'stickman-duel-arena-2026';
    // action send/receive handles
    this._send = {};
    this._loading = null;
  }

  /** Dynamically import Trystero (tries a couple of strategies/CDNs). */
  async load() {
    if (this.lib) return this.lib;
    if (this._loading) return this._loading;
    const sources = [
      'https://esm.run/trystero/nostr',
      'https://esm.sh/trystero/nostr',
      'https://cdn.jsdelivr.net/npm/trystero/nostr/index.min.js',
      'https://esm.run/trystero/mqtt',
    ];
    this._loading = (async () => {
      let lastErr;
      for (const src of sources) {
        try {
          const mod = await import(/* @vite-ignore */ src);
          if (mod && mod.joinRoom) { this.lib = mod; return mod; }
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('Trystero unavailable');
    })();
    return this._loading;
  }

  _randomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit
  }

  /** Wire up the room's actions and peer events. */
  _setupRoom(roomId) {
    const { joinRoom, selfId } = this.lib;
    this.selfId = selfId;
    this.room = joinRoom({ appId: this.appId }, roomId);

    const [sendState, getState] = this.room.makeAction('state');
    const [sendInput, getInput] = this.room.makeAction('input');
    const [sendMeta, getMeta] = this.room.makeAction('meta');
    this._send = { state: sendState, input: sendInput, meta: sendMeta };

    getState((data) => this.emit('state', data));
    getInput((data) => this.emit('input', data));
    getMeta((data, peer) => this.emit('meta', data, peer));

    this.room.onPeerJoin((peer) => {
      this.peerId = peer;
      this.connected = true;
      // Quick-match role resolution: lower id hosts (deterministic)
      if (this.role === 'pending') {
        this.role = this.selfId < peer ? 'host' : 'guest';
      }
      this.emit('peerjoin', peer);
    });
    this.room.onPeerLeave((peer) => {
      if (peer === this.peerId) {
        this.connected = false;
        this.peerId = null;
        this.emit('peerleave', peer);
      }
    });
  }

  async host() {
    await this.load();
    this.role = 'host';
    this.roomCode = this._randomCode();
    this._setupRoom('ROOM-' + this.roomCode);
    return this.roomCode;
  }

  async join(code) {
    await this.load();
    this.role = 'guest';
    this.roomCode = String(code).trim();
    this._setupRoom('ROOM-' + this.roomCode);
    return this.roomCode;
  }

  async quick() {
    await this.load();
    this.role = 'pending'; // decided when a peer joins
    this.roomCode = 'QUICK';
    this._setupRoom('LOBBY-QUICK');
    return this.roomCode;
  }

  sendState(s) { if (this._send.state) this._send.state(s); }
  sendInput(i) { if (this._send.input) this._send.input(i); }
  sendMeta(m) { if (this._send.meta) this._send.meta(m); }

  leave() {
    try { if (this.room) this.room.leave(); } catch (e) {}
    this.room = null;
    this.connected = false;
    this.role = null;
    this.peerId = null;
    this._send = {};
  }
}
