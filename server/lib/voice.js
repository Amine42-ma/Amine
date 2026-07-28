'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - VOICE CHAT (WebRTC signalling + routing policy)
 * ============================================================================
 *  Audio itself travels peer-to-peer over WebRTC (Opus, 48 kHz, with the
 *  browser's echo cancellation, noise suppression and auto gain enabled), so
 *  quality stays high and the game server never becomes an audio bottleneck.
 *
 *  What the server *does* own - and what makes this cheat-resistant:
 *    - who is allowed to hear whom (team / proximity / all, per game mode)
 *    - the peer list each client may negotiate with
 *    - relaying SDP offers/answers and ICE candidates, validating both ends
 *    - mute state (self mute, and per-player mutes that persist across a match)
 *
 *  A client cannot subscribe to an enemy squad's audio because the server
 *  refuses to relay signalling between peers that share no channel.
 * ============================================================================
 */

const MAX_SIGNAL_BYTES = 16 * 1024;
const SIGNAL_RATE_WINDOW_MS = 1000;
const SIGNAL_RATE_MAX = 40;

class VoiceHub {
  /**
   * @param {(userId:string, msg:object)=>void} push
   */
  constructor(push) {
    this.push = push;
    /** roomId -> {id, kind, members:Set<userId>, mode} */
    this.rooms = new Map();
    /** userId -> {roomId, muted, deafened, mutes:Set, speaking, lastSignal:[], channel} */
    this.states = new Map();
  }

  // -- state -----------------------------------------------------------------
  stateOf(userId) {
    let s = this.states.get(userId);
    if (!s) {
      s = {
        userId,
        roomId: null,
        micEnabled: false,
        muted: true,
        deafened: false,
        mutes: new Set(),
        speaking: false,
        channel: null,
        signalTimes: [],
      };
      this.states.set(userId, s);
    }
    return s;
  }

  createRoom(roomId, kind, mode) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { id: roomId, kind, mode, members: new Set(), createdAt: Date.now() };
      this.rooms.set(roomId, room);
    }
    room.mode = mode || room.mode;
    return room;
  }

  destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const uid of room.members) {
      const s = this.states.get(uid);
      if (s && s.roomId === roomId) {
        s.roomId = null;
        s.channel = null;
        this.push(uid, { t: 'voice.room', roomId: null, peers: [] });
      }
    }
    this.rooms.delete(roomId);
  }

  joinRoom(userId, roomId, kind, mode) {
    const room = this.createRoom(roomId, kind, mode);
    const state = this.stateOf(userId);
    if (state.roomId && state.roomId !== roomId) this.leaveRoom(userId);
    room.members.add(userId);
    state.roomId = roomId;
    return room;
  }

  leaveRoom(userId) {
    const state = this.states.get(userId);
    if (!state || !state.roomId) return;
    const room = this.rooms.get(state.roomId);
    if (room) {
      room.members.delete(userId);
      // Tell remaining peers to tear down their connection to this user.
      for (const uid of room.members) {
        this.push(uid, { t: 'voice.peerLeft', userId });
      }
      if (room.members.size === 0 && room.kind !== 'match') this.rooms.delete(room.id);
    }
    state.roomId = null;
    state.channel = null;
    state.speaking = false;
    this.push(userId, { t: 'voice.room', roomId: null, peers: [] });
  }

  // -- permissions -----------------------------------------------------------
  /**
   * Publishes the authoritative peer list for a user. `peers` comes from the
   * match (team/proximity/all) or from the party in the lobby.
   */
  publishPeers(userId, peers, channel) {
    const state = this.stateOf(userId);
    state.channel = channel;
    state.allowed = new Set(peers.map((p) => p.userId));
    this.push(userId, {
      t: 'voice.peers',
      channel,
      peers: peers.map((p) => ({
        userId: p.userId,
        entityId: p.entityId ?? null,
        name: p.name ?? null,
        channel: p.channel || channel,
        muted: state.mutes.has(p.userId),
        // Deterministic tie-break decides which side sends the WebRTC offer,
        // so two peers never glare with simultaneous offers.
        initiator: userId < p.userId,
      })),
    });
  }

  canSignal(fromId, toId) {
    const a = this.states.get(fromId);
    const b = this.states.get(toId);
    if (!a || !b) return false;
    if (!a.roomId || a.roomId !== b.roomId) return false;
    if (a.allowed && !a.allowed.has(toId)) return false;
    return true;
  }

  _rateOk(state) {
    const now = Date.now();
    state.signalTimes = state.signalTimes.filter((t) => now - t < SIGNAL_RATE_WINDOW_MS);
    if (state.signalTimes.length >= SIGNAL_RATE_MAX) return false;
    state.signalTimes.push(now);
    return true;
  }

  // -- signalling ------------------------------------------------------------
  relay(fromUser, { to, kind, data }) {
    const state = this.stateOf(fromUser.id);
    if (!this._rateOk(state)) return { error: 'Voice signalling rate exceeded.' };
    if (typeof to !== 'string' || !to) return { error: 'Missing peer.' };
    if (!['offer', 'answer', 'candidate', 'bye'].includes(kind)) return { error: 'Unknown signal.' };

    const encoded = JSON.stringify(data || null);
    if (encoded.length > MAX_SIGNAL_BYTES) return { error: 'Signal payload too large.' };
    if (!this.canSignal(fromUser.id, to)) return { error: 'Not permitted to reach that peer.' };

    this.push(to, {
      t: 'voice.signal',
      from: fromUser.id,
      fromName: fromUser.name,
      kind,
      data,
    });
    return { ok: true };
  }

  // -- controls --------------------------------------------------------------
  setMicEnabled(userId, enabled) {
    const s = this.stateOf(userId);
    s.micEnabled = !!enabled;
    if (!enabled) s.muted = true;
    return { ok: true, micEnabled: s.micEnabled, muted: s.muted };
  }

  setSelfMute(userId, muted) {
    const s = this.stateOf(userId);
    if (!s.micEnabled) {
      s.muted = true;
      return { ok: true, muted: true, reason: 'microphone permission not granted' };
    }
    s.muted = !!muted;
    this._broadcastRoom(userId, { t: 'voice.state', userId, muted: s.muted, speaking: false });
    return { ok: true, muted: s.muted };
  }

  setDeafened(userId, deafened) {
    const s = this.stateOf(userId);
    s.deafened = !!deafened;
    if (s.deafened) s.muted = true;
    return { ok: true, deafened: s.deafened, muted: s.muted };
  }

  mutePlayer(userId, targetId, muted) {
    const s = this.stateOf(userId);
    if (muted) s.mutes.add(targetId);
    else s.mutes.delete(targetId);
    return { ok: true, mutes: Array.from(s.mutes) };
  }

  setSpeaking(userId, speaking) {
    const s = this.stateOf(userId);
    if (s.speaking === !!speaking) return;
    s.speaking = !!speaking;
    this._broadcastRoom(userId, { t: 'voice.state', userId, speaking: s.speaking, muted: s.muted });
  }

  _broadcastRoom(userId, msg) {
    const s = this.states.get(userId);
    if (!s || !s.roomId) return;
    const room = this.rooms.get(s.roomId);
    if (!room) return;
    for (const uid of room.members) {
      if (uid !== userId) this.push(uid, msg);
    }
  }

  cleanupUser(userId) {
    this.leaveRoom(userId);
    this.states.delete(userId);
  }

  stats() {
    return {
      rooms: this.rooms.size,
      speakers: Array.from(this.states.values()).filter((s) => s.speaking).length,
      connected: this.states.size,
    };
  }
}

module.exports = { VoiceHub };
