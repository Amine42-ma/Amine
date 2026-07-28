'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - RFC 6455 WebSocket server (zero dependencies)
 * ============================================================================
 *  Implements the server half of the WebSocket protocol directly on top of
 *  node:http upgrade sockets. Supports:
 *    - Handshake + Sec-WebSocket-Accept
 *    - Continuation frames (fragmented messages)
 *    - Text / Binary payloads
 *    - Ping / Pong keepalive with dead-peer detection
 *    - Close handshake with status codes
 *    - Back-pressure aware writes
 *
 *  Deliberately dependency free so the whole stack runs with `node server`.
 * ============================================================================
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

const MAX_MESSAGE = 4 * 1024 * 1024; // 4 MiB hard cap per message
const MAX_BACKLOG = 8 * 1024 * 1024; // drop connections that cannot keep up

function acceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + WS_GUID, 'binary')
    .digest('base64');
}

/**
 * A single connected peer.
 */
class WSConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.remoteAddress =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      socket.remoteAddress ||
      '0.0.0.0';
    this.open = true;
    this.alive = true;
    this.id = crypto.randomBytes(9).toString('base64url');

    // Attached by the application layer.
    this.user = null;
    this.session = null;
    this.match = null;
    this.data = Object.create(null);

    this._buf = Buffer.alloc(0);
    this._fragOp = 0;
    this._fragChunks = [];
    this._fragLen = 0;
    this._closing = false;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this._onSocketClose());
    socket.on('end', () => this.destroy());
  }

  _onSocketClose() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    if (!this.open) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    // Parse as many complete frames as the buffer holds.
    for (;;) {
      const frame = this._readFrame();
      if (!frame) break;
      try {
        this._handleFrame(frame);
      } catch (err) {
        this.close(1011, 'internal error');
        break;
      }
    }
  }

  _readFrame() {
    const buf = this._buf;
    if (buf.length < 2) return null;

    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (rsv !== 0) {
      this.close(1002, 'rsv bits must be clear');
      return null;
    }
    // Clients MUST mask (RFC 6455 §5.1).
    if (!masked) {
      this.close(1002, 'unmasked client frame');
      return null;
    }

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_MESSAGE)) {
        this.close(1009, 'message too large');
        return null;
      }
      len = Number(big);
      offset += 8;
    }

    if (buf.length < offset + 4 + len) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;

    const payload = Buffer.allocUnsafe(len);
    buf.copy(payload, 0, offset, offset + len);
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];

    this._buf = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;

    switch (opcode) {
      case OP_PING:
        this._send(OP_PONG, payload);
        return;
      case OP_PONG:
        this.alive = true;
        this.emit('pong');
        return;
      case OP_CLOSE: {
        let code = 1005;
        let reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString('utf8');
        }
        if (!this._closing) this._send(OP_CLOSE, payload);
        this.emit('closing', code, reason);
        this.destroy();
        return;
      }
      case OP_CONT:
        if (!this._fragOp) {
          this.close(1002, 'unexpected continuation');
          return;
        }
        this._pushFragment(payload);
        if (fin) this._finishFragment();
        return;
      case OP_TEXT:
      case OP_BIN:
        if (this._fragOp) {
          this.close(1002, 'interleaved data frame');
          return;
        }
        if (fin) {
          this._deliver(opcode, payload);
        } else {
          this._fragOp = opcode;
          this._fragChunks = [];
          this._fragLen = 0;
          this._pushFragment(payload);
        }
        return;
      default:
        this.close(1002, 'unknown opcode');
    }
  }

  _pushFragment(payload) {
    this._fragLen += payload.length;
    if (this._fragLen > MAX_MESSAGE) {
      this.close(1009, 'message too large');
      return;
    }
    this._fragChunks.push(payload);
  }

  _finishFragment() {
    const op = this._fragOp;
    const payload = Buffer.concat(this._fragChunks, this._fragLen);
    this._fragOp = 0;
    this._fragChunks = [];
    this._fragLen = 0;
    this._deliver(op, payload);
  }

  _deliver(opcode, payload) {
    if (opcode === OP_TEXT) {
      let msg = null;
      try {
        msg = JSON.parse(payload.toString('utf8'));
      } catch {
        this.close(1007, 'invalid json');
        return;
      }
      if (msg && typeof msg === 'object') this.emit('json', msg);
    } else {
      this.emit('binary', payload);
    }
  }

  _send(opcode, payload) {
    if (!this.open) return false;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;

    const sock = this.socket;
    if (sock.writableLength > MAX_BACKLOG) {
      // Peer cannot drain our stream; drop it rather than exhaust memory.
      this.destroy();
      return false;
    }
    try {
      sock.write(header);
      if (len) sock.write(payload);
      return true;
    } catch {
      this.destroy();
      return false;
    }
  }

  /** Send a JSON control message. */
  send(obj) {
    if (!this.open) return false;
    let text;
    try {
      text = JSON.stringify(obj);
    } catch {
      return false;
    }
    return this._send(OP_TEXT, Buffer.from(text, 'utf8'));
  }

  /** Send a raw binary game packet. */
  sendBinary(buf) {
    if (!this.open) return false;
    const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
    return this._send(OP_BIN, payload);
  }

  ping() {
    this._send(OP_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open || this._closing) return;
    this._closing = true;
    const reasonBuf = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this._send(OP_CLOSE, payload);
    setTimeout(() => this.destroy(), 250).unref?.();
  }

  destroy() {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
    this.emit('close');
  }
}

/**
 * Attaches a WebSocket endpoint to an existing http.Server.
 */
class WSServer extends EventEmitter {
  constructor(httpServer, { path = '/ws', heartbeatMs = 15000, protocols = null } = {}) {
    super();
    this.path = path;
    // Subprotocols this endpoint is willing to speak. Some clients - MQTT
    // over WebSocket among them - refuse a handshake that does not echo the
    // one they asked for.
    this.protocols = protocols;
    this.clients = new Set();

    httpServer.on('upgrade', (req, socket, head) => this._onUpgrade(req, socket, head));

    this._heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          client.destroy();
          continue;
        }
        client.alive = false;
        client.ping();
      }
    }, heartbeatMs);
    this._heartbeat.unref?.();
  }

  _onUpgrade(req, socket, head) {
    const url = req.url || '/';
    const pathOnly = url.split('?')[0];
    if (pathOnly !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();

    if (upgrade !== 'websocket' || !key || String(version) !== '13') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    ];

    if (this.protocols) {
      const offered = String(req.headers['sec-websocket-protocol'] || '')
        .split(',').map((p) => p.trim()).filter(Boolean);
      const agreed = offered.find((p) => this.protocols.includes(p));
      if (agreed) headers.push(`Sec-WebSocket-Protocol: ${agreed}`);
    }

    headers.push('\r\n');
    socket.write(headers.join('\r\n'));

    const conn = new WSConnection(socket, req);
    if (head && head.length) conn._onData(head);

    this.clients.add(conn);
    conn.on('close', () => this.clients.delete(conn));
    this.emit('connection', conn, req);
  }

  broadcast(obj) {
    for (const c of this.clients) c.send(obj);
  }

  shutdown() {
    clearInterval(this._heartbeat);
    for (const c of this.clients) c.close(1001, 'server shutting down');
  }
}

module.exports = { WSServer, WSConnection, acceptKey, WS_GUID };
