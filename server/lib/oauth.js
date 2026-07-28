'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SOCIAL SIGN-IN (Google / Facebook)
 * ============================================================================
 *  Standard OAuth 2.0 authorisation-code flow, implemented directly on
 *  node:https so the server keeps its zero-dependency promise.
 *
 *      GET /auth/google/start      -> redirect to the provider
 *      GET /auth/google/callback   -> exchange code, link/create account,
 *                                     redirect back with a one-time ticket
 *      ws  {t:'auth.ticket'}       -> exchange the ticket for a session token
 *
 *  Why a ticket instead of putting the session token in the URL: the ticket is
 *  single-use, expires in 60 seconds, and is swapped over the already-open
 *  WebSocket, so the long-lived token never lands in browser history, referrer
 *  headers or server access logs.
 *
 *  CSRF protection: the `state` parameter is an HMAC-signed, timestamped nonce.
 *  A callback whose state is missing, forged or older than 10 minutes is
 *  rejected before any token exchange happens.
 *
 *  Providers are OFF until credentials are supplied - see .env.example. The
 *  client only renders a button for a provider the server reports as ready.
 * ============================================================================
 */

const crypto = require('node:crypto');
const https = require('node:https');

const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;

const PROVIDERS = {
  google: {
    key: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenHost: 'oauth2.googleapis.com',
    tokenPath: '/token',
    profileHost: 'openidconnect.googleapis.com',
    profilePath: '/v1/userinfo',
    scope: 'openid email profile',
    idEnv: 'GOOGLE_CLIENT_ID',
    secretEnv: 'GOOGLE_CLIENT_SECRET',
    extraAuthParams: { access_type: 'online', prompt: 'select_account' },
    /** Normalises the provider's profile shape into our own. */
    normalise(profile) {
      return {
        id: profile.sub,
        email: profile.email_verified ? profile.email : null,
        name: profile.name || profile.given_name || null,
      };
    },
  },
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenHost: 'graph.facebook.com',
    tokenPath: '/v19.0/oauth/access_token',
    profileHost: 'graph.facebook.com',
    profilePath: '/v19.0/me?fields=id,name,email',
    scope: 'public_profile,email',
    idEnv: 'FACEBOOK_APP_ID',
    secretEnv: 'FACEBOOK_APP_SECRET',
    extraAuthParams: {},
    normalise(profile) {
      return {
        id: profile.id,
        // Facebook only returns an email when the user granted it and the
        // account has a confirmed address.
        email: profile.email || null,
        name: profile.name || null,
      };
    },
  },
};

class OAuth {
  /**
   * @param {import('./accounts.js').Accounts} accounts
   * @param {object} options {publicUrl, secret}
   */
  constructor(accounts, options = {}) {
    this.accounts = accounts;
    this.publicUrl = (options.publicUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
    this.secret = options.secret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    /** ticket -> {userId, expires} */
    this.tickets = new Map();

    this.configured = {};
    for (const [key, provider] of Object.entries(PROVIDERS)) {
      const clientId = process.env[provider.idEnv];
      const clientSecret = process.env[provider.secretEnv];
      this.configured[key] = !!(clientId && clientSecret);
      if (this.configured[key]) {
        console.log(`[oauth] ${provider.label} sign-in enabled`);
      }
    }

    setInterval(() => this._pruneTickets(), 60 * 1000).unref?.();
  }

  /** Providers the client may show a button for. */
  availableProviders() {
    return Object.values(PROVIDERS)
      .filter((p) => this.configured[p.key])
      .map((p) => ({ key: p.key, label: p.label }));
  }

  isEnabled(key) {
    return !!this.configured[key];
  }

  /** Absolute redirect URI, derived from PUBLIC_URL or the incoming request. */
  redirectUri(providerKey, req) {
    if (this.publicUrl) return `${this.publicUrl}/auth/${providerKey}/callback`;
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    return `${proto}://${host}/auth/${providerKey}/callback`;
  }

  // -- state (CSRF) ----------------------------------------------------------
  _signState(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  _verifyState(state) {
    if (typeof state !== 'string' || !state.includes('.')) return null;
    const [body, mac] = state.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || Date.now() - payload.t > STATE_TTL_MS) return null;
    return payload;
  }

  // -- tickets ---------------------------------------------------------------
  issueTicket(userId) {
    const ticket = crypto.randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { userId, expires: Date.now() + TICKET_TTL_MS });
    return ticket;
  }

  /** Single-use: the ticket is consumed whether or not it was still valid. */
  redeemTicket(ticket) {
    if (typeof ticket !== 'string') return null;
    const rec = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!rec || rec.expires < Date.now()) return null;
    return rec.userId;
  }

  _pruneTickets() {
    const now = Date.now();
    for (const [ticket, rec] of this.tickets) {
      if (rec.expires < now) this.tickets.delete(ticket);
    }
  }

  // -- HTTP entry points -----------------------------------------------------
  /**
   * Handles /auth/* routes. Returns true when the request was consumed.
   */
  handleRequest(req, res, url) {
    const match = url.pathname.match(/^\/auth\/([a-z]+)\/(start|callback)$/);
    if (!match) return false;
    const [, providerKey, action] = match;
    const provider = PROVIDERS[providerKey];

    if (!provider || !this.configured[providerKey]) {
      this._redirectWithError(res, 'provider_unavailable');
      return true;
    }
    if (action === 'start') this._start(req, res, provider);
    else this._callback(req, res, provider, url);
    return true;
  }

  _start(req, res, provider) {
    const state = this._signState({ p: provider.key, n: crypto.randomBytes(9).toString('base64url'), t: Date.now() });
    const params = new URLSearchParams({
      client_id: process.env[provider.idEnv],
      redirect_uri: this.redirectUri(provider.key, req),
      response_type: 'code',
      scope: provider.scope,
      state,
      ...provider.extraAuthParams,
    });
    res.writeHead(302, {
      Location: `${provider.authorizeUrl}?${params.toString()}`,
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  async _callback(req, res, provider, url) {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const denied = url.searchParams.get('error');

    if (denied) return this._redirectWithError(res, 'cancelled');
    if (!code) return this._redirectWithError(res, 'missing_code');

    const payload = this._verifyState(state);
    if (!payload || payload.p !== provider.key) return this._redirectWithError(res, 'bad_state');

    try {
      const token = await this._exchangeCode(provider, code, this.redirectUri(provider.key, req));
      if (!token) return this._redirectWithError(res, 'token_exchange_failed');

      const raw = await this._fetchProfile(provider, token);
      const profile = provider.normalise(raw || {});
      if (!profile.id) return this._redirectWithError(res, 'no_profile');

      const result = this.accounts.findOrCreateFromProvider(provider.key, profile);
      if (result.error) return this._redirectWithError(res, 'link_failed', result.error);

      const ticket = this.issueTicket(result.user.id);
      res.writeHead(302, {
        Location: `/?auth=${encodeURIComponent(ticket)}`,
        'Cache-Control': 'no-store',
      });
      res.end();
    } catch (err) {
      console.error(`[oauth] ${provider.key} callback failed:`, err.message);
      this._redirectWithError(res, 'provider_error');
    }
  }

  _redirectWithError(res, code, detail) {
    const params = new URLSearchParams({ auth_error: code });
    if (detail) params.set('auth_detail', String(detail).slice(0, 140));
    res.writeHead(302, { Location: `/?${params.toString()}`, 'Cache-Control': 'no-store' });
    res.end();
  }

  // -- provider calls --------------------------------------------------------
  _exchangeCode(provider, code, redirectUri) {
    const body = new URLSearchParams({
      client_id: process.env[provider.idEnv],
      client_secret: process.env[provider.secretEnv],
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString();

    return this._request({
      host: provider.tokenHost,
      path: provider.tokenPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
    }, body).then((json) => (json && json.access_token) || null);
  }

  _fetchProfile(provider, accessToken) {
    const sep = provider.profilePath.includes('?') ? '&' : '?';
    return this._request({
      host: provider.profileHost,
      path: `${provider.profilePath}${sep}access_token=${encodeURIComponent(accessToken)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  }

  _request(options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request({ ...options, timeout: 12000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) {
            reject(new Error(`${options.host} responded ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            // Facebook can answer form-encoded on older API versions.
            const params = new URLSearchParams(text);
            resolve(Object.fromEntries(params));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('provider request timed out')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = { OAuth, PROVIDERS };
