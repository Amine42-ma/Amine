/**
 * =============================================================================
 *  Minimal MQTT 3.1.1 broker over WebSocket - test fixture only
 * =============================================================================
 *
 *  Exists so the signalling client can be exercised against a real broker
 *  instead of a mock: same framing, same handshake, same subscription
 *  routing. It implements exactly the subset the game uses - CONNECT,
 *  SUBSCRIBE, UNSUBSCRIBE, PUBLISH at QoS 0, PINGREQ, DISCONNECT - and
 *  nothing else. It is not a general purpose broker and is never shipped.
 * =============================================================================
 */

'use strict';

const http = require('node:http');
const { WSServer } = require('../server/lib/ws.js');

const CONNECT = 1, CONNACK = 2, PUBLISH = 3, SUBSCRIBE = 8, SUBACK = 9;
const UNSUBSCRIBE = 10, UNSUBACK = 11, PINGREQ = 12, PINGRESP = 13, DISCONNECT = 14;

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
    if (i >= bytes.length) return null;
    byte = bytes[i++];
    value += (byte & 127) * multiplier;
    multiplier *= 128;
  } while ((byte & 0x80) !== 0);
  return { value, size: i - offset };
}

function encodeString(s) {
  const bytes = Buffer.from(s, 'utf8');
  return [bytes.length >> 8, bytes.length & 255, ...bytes];
}

function packet(type, flags, body) {
  return Buffer.from([(type << 4) | flags, ...encodeLength(body.length), ...body]);
}

/** MQTT wildcards: `+` matches one level, `#` matches the rest. */
function topicMatches(filter, topic) {
  if (filter === topic) return true;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

class TestBroker {
  constructor() {
    this.clients = new Set();
    this.server = null;
    this.wss = null;
    this.published = 0;
    /** topic -> payload, replayed to anyone who subscribes later */
    this.retained = new Map();
  }

  listen(port) {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('test broker\n');
      });
      this.wss = new WSServer(this.server, { path: '/mqtt', protocols: ['mqtt'] });
      this.wss.on('connection', (socket) => this._attach(socket));
      this.server.listen(port, '127.0.0.1', () => resolve(port));
    });
  }

  _attach(socket) {
    const client = { socket, subs: new Set(), buffer: Buffer.alloc(0) };
    this.clients.add(client);

    socket.on('binary', (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      client.buffer = Buffer.concat([client.buffer, chunk]);
      for (;;) {
        if (client.buffer.length < 2) break;
        const len = decodeLength(client.buffer, 1);
        if (!len) break;
        const total = 1 + len.size + len.value;
        if (client.buffer.length < total) break;
        const type = client.buffer[0] >> 4;
        const flags = client.buffer[0] & 0x0f;
        const body = client.buffer.subarray(1 + len.size, total);
        client.buffer = client.buffer.subarray(total);
        this._handle(client, type, body, flags);
      }
    });

    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  _handle(client, type, body, flags = 0) {
    switch (type) {
      case CONNECT:
        client.socket.sendBinary(packet(CONNACK, 0, [0, 0]));
        break;

      case SUBSCRIBE: {
        const id = (body[0] << 8) | body[1];
        let offset = 2;
        const granted = [];
        const filters = [];
        while (offset < body.length) {
          const len = (body[offset] << 8) | body[offset + 1];
          const filter = body.subarray(offset + 2, offset + 2 + len).toString('utf8');
          offset += 2 + len + 1;                       // + requested qos byte
          client.subs.add(filter);
          filters.push(filter);
          granted.push(0);
        }
        client.socket.sendBinary(packet(SUBACK, 0, [id >> 8, id & 255, ...granted]));
        // Retained values are delivered immediately on subscribe - that is
        // the whole point of them.
        for (const [topic, payload] of this.retained) {
          if (filters.some((f) => topicMatches(f, topic))) {
            client.socket.sendBinary(packet(PUBLISH, 0x01, [...encodeString(topic), ...payload]));
          }
        }
        break;
      }

      case UNSUBSCRIBE: {
        const id = (body[0] << 8) | body[1];
        let offset = 2;
        while (offset < body.length) {
          const len = (body[offset] << 8) | body[offset + 1];
          client.subs.delete(body.subarray(offset + 2, offset + 2 + len).toString('utf8'));
          offset += 2 + len;
        }
        client.socket.sendBinary(packet(UNSUBACK, 0, [id >> 8, id & 255]));
        break;
      }

      case PUBLISH: {
        const topicLen = (body[0] << 8) | body[1];
        const topic = body.subarray(2, 2 + topicLen).toString('utf8');
        const payload = body.subarray(2 + topicLen);
        this.published++;
        if (flags & 0x01) {
          // An empty retained payload clears the stored value.
          if (payload.length === 0) this.retained.delete(topic);
          else this.retained.set(topic, Buffer.from(payload));
        }
        const out = packet(PUBLISH, 0, [...encodeString(topic), ...payload]);
        for (const other of this.clients) {
          for (const filter of other.subs) {
            if (topicMatches(filter, topic)) { other.socket.sendBinary(out); break; }
          }
        }
        break;
      }

      case PINGREQ:
        client.socket.sendBinary(packet(PINGRESP, 0, []));
        break;

      case DISCONNECT:
        try { client.socket.close(); } catch { /* already closing */ }
        this.clients.delete(client);
        break;

      default:
        break;
    }
  }

  close() {
    for (const c of this.clients) { try { c.socket.close(); } catch { /* gone */ } }
    this.clients.clear();
    this.wss?.close?.();
    this.server?.close();
  }
}

module.exports = { TestBroker, topicMatches };
