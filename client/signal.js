/**
 * =============================================================================
 *  SIGNALLING - MQTT 3.1.1 over WebSocket, implemented from scratch
 * =============================================================================
 *
 *  Two browsers cannot find each other on their own. Before a direct WebRTC
 *  connection exists there has to be some third party that both can reach, to
 *  pass the offer and answer through. That is all this file is for: a postbox.
 *  Once the peer connection is up the postbox is idle - no game traffic ever
 *  goes through it, and it never sees anything but connection handshakes.
 *
 *  MQTT was chosen because it is a small protocol with several free public
 *  brokers that need no account, so the game can fail over between them
 *  instead of depending on one operator staying up. Only QoS 0 is used:
 *  signalling messages are retried at a higher level anyway, so the
 *  acknowledgement machinery would be dead weight.
 *
 *  This file is written to run unmodified in a browser and in Node (which has
 *  had a global WebSocket since v22), so the framing can be unit tested.
 * =============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Signal = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Free brokers that speak MQTT over TLS WebSocket without an account.
   * Tried in order; the first that completes a handshake wins. They are all
   * public test infrastructure run as a courtesy by other people, so the game
   * keeps its traffic to a handful of tiny JSON messages per join.
   */
  const DEFAULT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://mqtt.eclipseprojects.io/mqtt',
  ];

  // --- packet types ----------------------------------------------------------
  const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8, SUBACK = 9;
  const UNSUBSCRIBE = 10, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

  const KEEPALIVE_S = 45;

  /* ------------------------------------------------------------- encoding -- */

  /** MQTT's variable-length integer: 7 bits per byte, high bit = continue. */
  function encodeLength(n) {
    const out = [];
    do {
      let byte = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) byte |= 0x80;
      out.push(byte);
    } while (n > 0);
    return out;
  }

  function decodeLength(bytes, offset) {
    let multiplier = 1;
    let value = 0;
    let i = offset;
    let byte;
    do {
      // The field is four bytes at most; a fifth continuation bit is a
      // malformed packet, not a very large number.
      if (i - offset >= 4) return null;
      if (i >= bytes.length) return null;           // packet not fully arrived
      byte = bytes[i++];
      value += (byte & 127) * multiplier;
      multiplier *= 128;
    } while ((byte & 0x80) !== 0);
    return { value, size: i - offset };
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  /** MQTT strings are length-prefixed with a 16-bit big-endian byte count. */
  function encodeString(s) {
    const bytes = utf8(s);
    return [bytes.length >> 8, bytes.length & 255, ...bytes];
  }

  function buildPacket(type, flags, body) {
    const header = [(type << 4) | flags, ...encodeLength(body.length)];
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    return out;
  }

  /* ---------------------------------------------------------------- client -- */

  class MqttClient {
    constructor(url, clientId) {
      this.url = url;
      this.clientId = clientId;
      this.ws = null;
      this.connected = false;
      this.buffer = new Uint8Array(0);
      this.packetId = 1;
      this._pingTimer = null;
      this.onMessage = null;     // (topic, payloadString)
      this.onClose = null;
    }

    /** Resolves once the broker has sent CONNACK, rejects on any failure. */
    connect(timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) { this.close(); reject(err); } else resolve(this);
        };
        const timer = setTimeout(() => done(new Error('timeout')), timeoutMs);

        try {
          // The 'mqtt' subprotocol is mandatory for MQTT over WebSocket.
          this.ws = new WebSocket(this.url, 'mqtt');
        } catch (err) {
          return done(err);
        }
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          const body = [
            ...encodeString('MQTT'),
            4,          // protocol level 3.1.1
            0x02,       // clean session, no will, no auth
            KEEPALIVE_S >> 8, KEEPALIVE_S & 255,
            ...encodeString(this.clientId),
          ];
          this._send(buildPacket(CONNECT, 0, body));
        };

        this.ws.onmessage = (ev) => {
          this._feed(new Uint8Array(ev.data));
          if (this.connected && !settled) done(null);
        };
        this.ws.onerror = () => done(new Error('socket error'));
        this.ws.onclose = () => {
          this.connected = false;
          this._stopPing();
          if (!settled) done(new Error('closed before connack'));
          else if (this.onClose) this.onClose();
        };
      });
    }

    /** Accumulates bytes and dispatches every whole packet available. */
    _feed(chunk) {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;

      for (;;) {
        if (this.buffer.length < 2) return;
        const len = decodeLength(this.buffer, 1);
        if (!len) return;
        const total = 1 + len.size + len.value;
        if (this.buffer.length < total) return;

        const type = this.buffer[0] >> 4;
        const flags = this.buffer[0] & 0x0f;
        const body = this.buffer.subarray(1 + len.size, total);
        this.buffer = this.buffer.subarray(total);
        this._handle(type, flags, body);
      }
    }

    _handle(type, flags, body) {
      switch (type) {
        case CONNACK:
          // body[1] is the return code; anything non-zero is a refusal.
          if (body.length >= 2 && body[1] === 0) {
            this.connected = true;
            this._startPing();
          }
          break;

        case PUBLISH: {
          const topicLen = (body[0] << 8) | body[1];
          const topic = new TextDecoder().decode(body.subarray(2, 2 + topicLen));
          let offset = 2 + topicLen;
          const qos = (flags >> 1) & 3;
          if (qos > 0) offset += 2;               // packet id we never ack
          const payload = new TextDecoder().decode(body.subarray(offset));
          if (this.onMessage) this.onMessage(topic, payload);
          break;
        }

        case PINGRESP:
        case SUBACK:
          break;

        default:
          break;
      }
    }

    subscribe(topic) {
      const id = this._nextPacketId();
      const body = [id >> 8, id & 255, ...encodeString(topic), 0];
      // The SUBSCRIBE fixed-header flags are reserved and must be 0b0010.
      this._send(buildPacket(SUBSCRIBE, 0x02, body));
    }

    unsubscribe(topic) {
      const id = this._nextPacketId();
      const body = [id >> 8, id & 255, ...encodeString(topic)];
      this._send(buildPacket(UNSUBSCRIBE, 0x02, body));
    }

    /**
     * `retain` asks the broker to keep this as the topic's last known value
     * and hand it to anyone who subscribes later. That is what makes room
     * discovery instant and stateless: a browser that has only just opened
     * learns about every room already waiting, without the hosts having to be
     * awake at that exact moment to answer. Publishing an empty payload with
     * retain set is how a retained value is cleared.
     */
    publish(topic, payload, retain = false) {
      const body = [...encodeString(topic), ...utf8(payload)];
      this._send(buildPacket(PUBLISH, retain ? 0x01 : 0, body));
    }

    _nextPacketId() {
      this.packetId = (this.packetId % 65535) + 1;
      return this.packetId;
    }

    _send(bytes) {
      if (this.ws && this.ws.readyState === 1) {
        try { this.ws.send(bytes); } catch { /* socket closed under us */ }
      }
    }

    _startPing() {
      this._stopPing();
      this._pingTimer = setInterval(() => {
        this._send(buildPacket(PINGREQ, 0, []));
      }, KEEPALIVE_S * 500);        // ping at half the keepalive window
    }

    _stopPing() {
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = null;
    }

    close() {
      this._stopPing();
      this.connected = false;
      try {
        this._send(buildPacket(DISCONNECT, 0, []));
        this.ws?.close();
      } catch { /* already gone */ }
      this.ws = null;
    }
  }

  /* -------------------------------------------------------------- Signal -- */

  /**
   * Room-scoped postbox on top of MqttClient. Handles broker failover and
   * addressing, and hands plain objects to the caller.
   */
  class Signal {
    constructor({ brokers = DEFAULT_BROKERS, prefix = 'dinoroyale/v1', selfId } = {}) {
      this.brokers = brokers.slice();
      this.prefix = prefix;
      this.selfId = selfId;
      this.client = null;
      this.room = null;
      this.broker = null;
      this.onRoomMessage = null;    // (msg)
      this.onLobbyMessage = null;   // (msg)
      this._closed = false;
    }

    get lobbyTopic() { return `${this.prefix}/lobby`; }
    /** One topic per open room, so each can be retained independently. */
    get lobbyWildcard() { return `${this.prefix}/lobby/+`; }
    listingTopic(code) { return `${this.prefix}/lobby/${code}`; }
    roomTopic(room) { return `${this.prefix}/room/${room}`; }

    /**
     * Connects to the first broker that answers. Every public broker is
     * someone else's free service and any of them can be down, so a failure
     * to reach one is expected rather than exceptional.
     */
    async connect() {
      const errors = [];
      for (const url of this.brokers) {
        if (this._closed) return null;
        try {
          const client = new MqttClient(url, `dre_${this.selfId}_${Math.random().toString(36).slice(2, 8)}`);
          await client.connect();
          client.onMessage = (topic, payload) => this._route(topic, payload);
          client.onClose = () => { if (!this._closed) this._reconnect(); };
          this.client = client;
          this.broker = url;
          return url;
        } catch (err) {
          errors.push(`${url}: ${err.message}`);
        }
      }
      throw new Error(`no signalling broker reachable (${errors.join('; ')})`);
    }

    async _reconnect() {
      const room = this.room;
      this.client = null;
      try {
        await this.connect();
        this.subscribeLobby();
        if (room) this.joinRoom(room);
      } catch { /* caller surfaces the outage through its own timeout */ }
    }

    subscribeLobby() {
      this.client?.subscribe(this.lobbyTopic);
      this.client?.subscribe(this.lobbyWildcard);
    }

    /** Advertises an open room, or withdraws it when `listing` is null. */
    publishListing(code, listing) {
      this.client?.publish(
        this.listingTopic(code),
        listing ? JSON.stringify({ ...listing, from: this.selfId }) : '',
        true,
      );
    }

    joinRoom(room) {
      this.room = room;
      this.client?.subscribe(this.roomTopic(room));
    }

    leaveRoom() {
      if (this.room) this.client?.unsubscribe(this.roomTopic(this.room));
      this.room = null;
    }

    /** Broadcasts to the room; `to` narrows it to one peer at the receiver. */
    sendRoom(msg) {
      if (!this.room) return;
      this.client?.publish(this.roomTopic(this.room), JSON.stringify({ ...msg, from: this.selfId }));
    }

    sendLobby(msg) {
      this.client?.publish(this.lobbyTopic, JSON.stringify({ ...msg, from: this.selfId }));
    }

    _route(topic, payload) {
      // A cleared retained listing arrives as an empty payload.
      if (payload === '' && topic.startsWith(`${this.prefix}/lobby/`)) {
        this.onLobbyMessage?.({ t: 'room.closed', code: topic.slice(topic.lastIndexOf('/') + 1) });
        return;
      }
      let msg;
      try { msg = JSON.parse(payload); } catch { return; }
      // Brokers echo our own publishes back to us; nothing here wants them.
      if (!msg || msg.from === this.selfId) return;
      if (topic === this.lobbyTopic || topic.startsWith(`${this.prefix}/lobby/`)) this.onLobbyMessage?.(msg);
      else if (this.room && topic === this.roomTopic(this.room)) {
        if (msg.to && msg.to !== this.selfId) return;
        this.onRoomMessage?.(msg);
      }
    }

    close() {
      this._closed = true;
      this.client?.close();
      this.client = null;
    }
  }

  Signal.MqttClient = MqttClient;
  Signal.DEFAULT_BROKERS = DEFAULT_BROKERS;
  Signal._internals = { encodeLength, decodeLength, encodeString, buildPacket };
  return Signal;
});
