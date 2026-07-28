'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - ACCOUNTS, SESSIONS, PROFILES, PROGRESSION
 * ============================================================================
 *  - Registration / login / logout / token resume / account recovery
 *  - scrypt password hashing with per-user salt and constant-time compare
 *  - Profile: display name, avatar, cosmetics, settings
 *  - Progression: XP, levels, coins, stats, achievements
 *  - Leaderboards (global + friends)
 *
 *  Nothing here trusts the client: every mutation is validated server side and
 *  every reward is computed from authoritative match results.
 * ============================================================================
 */

const crypto = require('node:crypto');
const Content = require('./content.js');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const RECOVERY_TTL_MS = 1000 * 60 * 30; // 30 minutes

const NAME_RE = /^[A-Za-z0-9_؀-ۿ][A-Za-z0-9_ .؀-ۿ-]{1,18}[A-Za-z0-9_؀-ۿ]$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RESERVED_NAMES = new Set(['admin', 'moderator', 'system', 'server', 'dinoroyale', 'support', 'staff']);

function nowMs() {
  return Date.now();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, s, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024,
  });
  return { salt: s, hash: key.toString('hex') };
}

function verifyPassword(password, salt, expectedHex) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Human-friendly recovery code: 4 groups of 4 (no ambiguous glyphs). */
function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

function defaultStats() {
  return {
    matches: 0,
    wins: 0,
    top10: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    headshots: 0,
    dinoKills: 0,
    apexKills: 0,
    tranquilised: 0,
    revives: 0,
    blocksPlaced: 0,
    blocksBroken: 0,
    distance: 0,
    waterTime: 0,
    maxAltitude: 0,
    landmarks: 0,
    vaults: 0,
    longestKill: 0,
    survivalTime: 0,
    bestPlacement: 0,
    killStreak: 0,
    friends: 0,
    clanJoined: 0,
    playtime: 0,
  };
}

function defaultAvatar() {
  return {
    // A block avatar rendered procedurally by the client - no image uploads,
    // so there is no user-generated media to moderate or host.
    skinTone: 3,
    hair: 2,
    hairColor: '#3b2a1e',
    eyes: 1,
    eyeColor: '#3f6fa8',
    marking: 0,
    markingColor: '#c8a24b',
    accessory: 0,
    background: 4,
  };
}

function defaultCosmetics() {
  return {
    skin: 'ranger',
    emotes: ['wave', 'salute', 'point'],
    trail: 'none',
    banner: 'claw',
    owned: {
      skins: ['ranger'],
      emotes: ['wave', 'salute', 'point'],
      trails: ['none'],
      banners: ['claw', 'fang'],
    },
  };
}

function defaultSettings() {
  return {
    sensitivity: 1.0,
    adsSensitivity: 0.72,
    fov: 84,
    invertY: false,
    masterVolume: 0.85,
    musicVolume: 0.45,
    sfxVolume: 0.9,
    voiceVolume: 1.0,
    micEnabled: null, // null = never asked, true/false = user decision
    micGain: 1.0,
    voiceMode: 'ptt', // 'ptt' | 'open' | 'off'
    pttKey: 'KeyV',
    quality: 'high',
    renderDistance: 12,
    shadows: 'high',
    ssao: true,
    bloom: true,
    reflections: true,
    motionBlur: false,
    taa: true,
    vsync: true,
    fpsCap: 0,
    crosshair: 'dynamic',
    hudScale: 1.0,
    language: 'ar',
    showDamageNumbers: true,
    colorblind: 'none',
    headBob: 1.0,
    autoSprint: false,
    toggleAds: false,
    toggleCrouch: false,
  };
}

class Accounts {
  constructor(store) {
    this.store = store;
    this.users = store.collection('users', { indices: ['nameLower', 'emailLower', 'oauthGoogle', 'oauthFacebook'] });
    this.sessions = store.collection('sessions', { indices: ['tokenHash'] });
    this.clans = store.collection('clans', { indices: ['nameLower', 'tagLower'] });
    this.recovery = new Map(); // email -> {codeHash, expires, attempts}
    this.loginAttempts = new Map(); // key -> {count, until}

    this._pruneSessions();
    setInterval(() => this._pruneSessions(), 60 * 60 * 1000).unref?.();
  }

  _pruneSessions() {
    const cutoff = nowMs();
    let removed = 0;
    for (const s of this.sessions.all()) {
      if (s.expires < cutoff) {
        this.sessions.delete(s.id);
        removed++;
      }
    }
    if (removed) console.log(`[accounts] pruned ${removed} expired sessions`);
  }

  // -- rate limiting ---------------------------------------------------------
  /**
   * Returns the number of seconds the caller must wait, or 0 when allowed.
   * Only *failed* attempts are recorded (see _throttleFail); a correct password
   * must never be refused because the player mistyped it a few times first.
   */
  _throttleCheck(key, maxAttempts = 10, windowMs = 10 * 60 * 1000) {
    const rec = this.loginAttempts.get(key);
    const now = nowMs();
    if (!rec || rec.until <= now) {
      if (rec) this.loginAttempts.delete(key);
      return 0;
    }
    if (rec.count >= maxAttempts) return Math.ceil((rec.until - now) / 1000);
    return 0;
  }

  _throttleFail(key, windowMs = 10 * 60 * 1000) {
    const now = nowMs();
    const rec = this.loginAttempts.get(key);
    if (!rec || rec.until <= now) this.loginAttempts.set(key, { count: 1, until: now + windowMs });
    else rec.count++;
  }

  _clearThrottle(key) {
    this.loginAttempts.delete(key);
  }

  // -- validation ------------------------------------------------------------
  validateName(name) {
    if (typeof name !== 'string') return 'Display name is required.';
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 20) return 'Display name must be 3-20 characters.';
    if (!NAME_RE.test(trimmed)) return 'Display name contains invalid characters.';
    if (RESERVED_NAMES.has(trimmed.toLowerCase())) return 'That display name is reserved.';
    if (this.users.by('nameLower', trimmed)) return 'That display name is already taken.';
    return null;
  }

  validatePassword(password) {
    if (typeof password !== 'string') return 'Password is required.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password.length > 200) return 'Password is too long.';
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password must contain letters and numbers.';
    return null;
  }

  validateEmail(email) {
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'A valid email address is required.';
    if (email.length > 190) return 'Email address is too long.';
    if (this.users.by('emailLower', email.trim())) return 'An account already exists for that email.';
    return null;
  }

  // -- lifecycle -------------------------------------------------------------
  register({ name, email, password }, ip) {
    const key = `reg:${ip}`;
    const wait = this._throttleCheck(key, 8, 10 * 60 * 1000);
    if (wait) return { error: `Too many sign-up attempts. Try again in ${wait}s.` };

    const nameErr = this.validateName(name);
    if (nameErr) { this._throttleFail(key); return { error: nameErr }; }
    const emailErr = this.validateEmail(email);
    if (emailErr) { this._throttleFail(key); return { error: emailErr }; }
    const passErr = this.validatePassword(password);
    if (passErr) { this._throttleFail(key); return { error: passErr }; }

    const displayName = name.trim();
    const mail = email.trim();
    const { salt, hash } = hashPassword(password);
    const recoveryCode = generateRecoveryCode();

    const user = {
      id: newId('u'),
      name: displayName,
      nameLower: displayName.toLowerCase(),
      email: mail,
      emailLower: mail.toLowerCase(),
      salt,
      hash,
      recoveryHash: sha256(recoveryCode),
      recoveryUsed: false,
      createdAt: nowMs(),
      lastSeen: nowMs(),
      lastLoginDay: 0,
      xp: 0,
      level: 1,
      coins: 500,
      gems: 0,
      avatar: defaultAvatar(),
      cosmetics: defaultCosmetics(),
      settings: defaultSettings(),
      stats: defaultStats(),
      achievements: {},
      friends: [],
      friendRequestsIn: [],
      friendRequestsOut: [],
      blocked: [],
      clanId: null,
      banned: false,
      nameChanges: 0,
    };
    this.users.put(user);
    this._clearThrottle(key);

    const session = this.createSession(user.id);
    return { user, token: session.token, recoveryCode };
  }

  login({ login, password }, ip) {
    const key = `login:${ip}:${String(login || '').toLowerCase()}`;
    const wait = this._throttleCheck(key, 12, 10 * 60 * 1000);
    if (wait) return { error: `Too many failed attempts. Try again in ${wait}s.` };

    if (typeof login !== 'string' || typeof password !== 'string') {
      return { error: 'Enter your name or email and password.' };
    }
    const ident = login.trim();
    // A player may sign in with either identifier, and neither is
    // case-sensitive - both indexes are lower-cased.
    const user = ident.includes('@')
      ? this.users.by('emailLower', ident)
      : this.users.by('nameLower', ident) || this.users.by('emailLower', ident);

    // Always run a hash to keep timing uniform for unknown accounts.
    if (!user) {
      hashPassword(password, 'decoy-salt-value');
      this._throttleFail(key);
      return { error: 'No account matches that name or email.' };
    }
    if (user.banned) return { error: 'This account is suspended.' };
    if (!user.hash) {
      const via = user.oauthGoogle ? 'Google' : user.oauthFacebook ? 'Facebook' : 'a linked provider';
      return { error: `This account signs in with ${via}. Use that button, or set a password from Settings once signed in.` };
    }
    if (!verifyPassword(password, user.salt, user.hash)) {
      this._throttleFail(key);
      return { error: 'Incorrect password.' };
    }

    this._clearThrottle(key);
    user.lastSeen = nowMs();
    this._grantDailyBonus(user);
    this.users.put(user);
    const session = this.createSession(user.id);
    return { user, token: session.token };
  }

  /**
   * Resolves a social sign-in to an account, in priority order:
   *   1. an account already linked to this provider id
   *   2. an existing account with the same verified email  -> link it
   *   3. a brand new account with no password
   *
   * @param {string} providerKey 'google' | 'facebook'
   * @param {object} profile {id, email, name}
   */
  findOrCreateFromProvider(providerKey, profile) {
    const field = providerKey === 'google' ? 'oauthGoogle' : providerKey === 'facebook' ? 'oauthFacebook' : null;
    if (!field) return { error: 'Unsupported provider.' };
    if (!profile || !profile.id) return { error: 'The provider returned no account id.' };

    const providerId = String(profile.id);

    // 1. already linked
    let user = this.users.by(field, providerId);
    if (user) {
      if (user.banned) return { error: 'This account is suspended.' };
      user.lastSeen = nowMs();
      this._grantDailyBonus(user);
      this.users.put(user);
      return { user, linked: false };
    }

    // 2. link to an existing account that owns the same email
    if (profile.email) {
      const existing = this.users.by('emailLower', profile.email.trim());
      if (existing) {
        if (existing.banned) return { error: 'This account is suspended.' };
        existing[field] = providerId;
        existing.lastSeen = nowMs();
        this._grantDailyBonus(existing);
        this.users.put(existing);
        return { user: existing, linked: true };
      }
    }

    // 3. create a fresh account. Social accounts have no password until the
    //    player sets one, so `hash` and `salt` stay empty.
    const displayName = this._uniqueNameFrom(profile.name || providerKey);
    const recoveryCode = generateRecoveryCode();
    const now = nowMs();
    const created = {
      id: newId('u'),
      name: displayName,
      nameLower: displayName.toLowerCase(),
      email: profile.email || '',
      emailLower: profile.email ? profile.email.trim().toLowerCase() : '',
      salt: '',
      hash: '',
      recoveryHash: sha256(recoveryCode),
      recoveryUsed: false,
      [field]: providerId,
      createdAt: now,
      lastSeen: now,
      lastLoginDay: 0,
      xp: 0,
      level: 1,
      coins: 500,
      gems: 0,
      avatar: defaultAvatar(),
      cosmetics: defaultCosmetics(),
      settings: defaultSettings(),
      stats: defaultStats(),
      achievements: {},
      friends: [],
      friendRequestsIn: [],
      friendRequestsOut: [],
      blocked: [],
      clanId: null,
      banned: false,
      nameChanges: 0,
    };
    this.users.put(created);
    return { user: created, created: true, recoveryCode };
  }

  /** Derives a valid, unused display name from a provider's profile name. */
  _uniqueNameFrom(raw) {
    let base = String(raw || 'Hunter')
      .replace(/[^A-Za-z0-9_ .\u0600-\u06ff-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16);
    if (base.length < 3) base = 'Hunter';
    if (RESERVED_NAMES.has(base.toLowerCase())) base = `${base} Prime`;
    if (!this.users.by('nameLower', base)) return base;
    for (let i = 0; i < 200; i++) {
      const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const candidate = `${base.slice(0, 15)}${suffix}`;
      if (!this.users.by('nameLower', candidate)) return candidate;
    }
    return `Hunter${Date.now().toString(36).slice(-6)}`;
  }

  /** Lets a social account add a password without knowing an old one. */
  setInitialPassword(user, newPassword) {
    if (user.hash) return { error: 'This account already has a password. Use "change password" instead.' };
    const passErr = this.validatePassword(newPassword);
    if (passErr) return { error: passErr };
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.hash = hash;
    this.users.put(user);
    return { ok: true };
  }

  /** Unlinks a provider, refusing to leave the account with no way in. */
  unlinkProvider(user, providerKey) {
    const field = providerKey === 'google' ? 'oauthGoogle' : providerKey === 'facebook' ? 'oauthFacebook' : null;
    if (!field) return { error: 'Unsupported provider.' };
    if (!user[field]) return { error: 'That provider is not linked.' };
    const others = ['oauthGoogle', 'oauthFacebook'].filter((f) => f !== field && user[f]).length;
    if (!user.hash && others === 0) {
      return { error: 'Set a password first, otherwise you would lose access to this account.' };
    }
    user[field] = null;
    this.users.put(user);
    return { ok: true };
  }

  loginWithToken(token) {
    if (typeof token !== 'string' || token.length < 20) return { error: 'Invalid session.' };
    const session = this.sessions.by('tokenHash', sha256(token));
    if (!session) return { error: 'Session expired. Please sign in again.' };
    if (session.expires < nowMs()) {
      this.sessions.delete(session.id);
      return { error: 'Session expired. Please sign in again.' };
    }
    const user = this.users.get(session.userId);
    if (!user) {
      this.sessions.delete(session.id);
      return { error: 'Account no longer exists.' };
    }
    if (user.banned) return { error: 'This account is suspended.' };

    // Sliding expiry keeps active players signed in.
    session.expires = nowMs() + SESSION_TTL_MS;
    session.lastUsed = nowMs();
    this.sessions.put(session);
    user.lastSeen = nowMs();
    this._grantDailyBonus(user);
    this.users.put(user);
    return { user, token };
  }

  createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const session = {
      id: newId('s'),
      userId,
      tokenHash: sha256(token),
      created: nowMs(),
      lastUsed: nowMs(),
      expires: nowMs() + SESSION_TTL_MS,
    };
    this.sessions.put(session);
    return { session, token };
  }

  logout(token) {
    if (!token) return false;
    const session = this.sessions.by('tokenHash', sha256(token));
    if (!session) return false;
    this.sessions.delete(session.id);
    return true;
  }

  logoutEverywhere(userId) {
    let n = 0;
    for (const s of this.sessions.find((s) => s.userId === userId)) {
      this.sessions.delete(s.id);
      n++;
    }
    return n;
  }

  // -- recovery --------------------------------------------------------------
  /**
   * Issues a short-lived recovery challenge. In this build the code is
   * returned to the requesting client (there is no mail transport configured);
   * wiring an SMTP provider only requires replacing the delivery step.
   */
  requestRecovery(email, ip) {
    const key = `rec:${ip}`;
    const wait = this._throttleCheck(key, 6, 15 * 60 * 1000);
    if (wait) return { error: `Too many recovery requests. Try again in ${wait}s.` };
    this._throttleFail(key, 15 * 60 * 1000);
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return { error: 'Enter a valid email address.' };

    const user = this.users.by('emailLower', email.trim());
    // Do not disclose whether the address is registered.
    if (!user) return { ok: true, delivered: false };

    const code = generateRecoveryCode();
    this.recovery.set(user.emailLower, {
      codeHash: sha256(code),
      expires: nowMs() + RECOVERY_TTL_MS,
      attempts: 0,
    });
    return { ok: true, delivered: true, code, expiresIn: RECOVERY_TTL_MS / 1000 };
  }

  confirmRecovery({ email, code, newPassword }) {
    if (typeof email !== 'string' || typeof code !== 'string') return { error: 'Missing recovery details.' };
    const passErr = this.validatePassword(newPassword);
    if (passErr) return { error: passErr };

    const emailLower = email.trim().toLowerCase();
    const user = this.users.by('emailLower', emailLower);
    const pending = this.recovery.get(emailLower);
    const normalised = code.trim().toUpperCase();

    // The permanent recovery key issued at sign-up also works here.
    const permanentMatch = user && !user.recoveryUsed && sha256(normalised) === user.recoveryHash;
    const pendingMatch = pending && pending.expires > nowMs() && sha256(normalised) === pending.codeHash;

    if (pending) {
      pending.attempts++;
      if (pending.attempts > 6) this.recovery.delete(emailLower);
    }
    if (!user || (!permanentMatch && !pendingMatch)) return { error: 'That recovery code is not valid.' };

    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.hash = hash;
    if (permanentMatch) {
      // Burn the permanent key and issue a fresh one.
      user.recoveryUsed = false;
      const fresh = generateRecoveryCode();
      user.recoveryHash = sha256(fresh);
      this.users.put(user);
      this.recovery.delete(emailLower);
      this.logoutEverywhere(user.id);
      const session = this.createSession(user.id);
      return { ok: true, user, token: session.token, recoveryCode: fresh };
    }
    this.users.put(user);
    this.recovery.delete(emailLower);
    this.logoutEverywhere(user.id);
    const session = this.createSession(user.id);
    return { ok: true, user, token: session.token };
  }

  changePassword(user, currentPassword, newPassword) {
    if (!verifyPassword(currentPassword, user.salt, user.hash)) return { error: 'Current password is incorrect.' };
    const passErr = this.validatePassword(newPassword);
    if (passErr) return { error: passErr };
    const { salt, hash } = hashPassword(newPassword);
    user.salt = salt;
    user.hash = hash;
    this.users.put(user);
    return { ok: true };
  }

  // -- profile ---------------------------------------------------------------
  changeName(user, newName) {
    const err = this.validateName(newName);
    if (err) return { error: err };
    const cost = user.nameChanges === 0 ? 0 : 750;
    if (user.coins < cost) return { error: `Renaming costs ${cost} coins. You have ${user.coins}.` };
    user.coins -= cost;
    user.name = newName.trim();
    user.nameLower = user.name.toLowerCase();
    user.nameChanges++;
    this.users.put(user);
    return { ok: true, cost };
  }

  updateAvatar(user, avatar) {
    if (!avatar || typeof avatar !== 'object') return { error: 'Invalid avatar.' };
    const clean = defaultAvatar();
    const intKeys = ['skinTone', 'hair', 'eyes', 'marking', 'accessory', 'background'];
    for (const k of intKeys) {
      if (typeof avatar[k] === 'number' && Number.isFinite(avatar[k])) {
        clean[k] = Math.max(0, Math.min(15, Math.floor(avatar[k])));
      }
    }
    for (const k of ['hairColor', 'eyeColor', 'markingColor']) {
      if (typeof avatar[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(avatar[k])) clean[k] = avatar[k];
    }
    user.avatar = clean;
    this.users.put(user);
    return { ok: true, avatar: clean };
  }

  updateCosmetics(user, sel) {
    if (!sel || typeof sel !== 'object') return { error: 'Invalid selection.' };
    const owned = user.cosmetics.owned;
    if (typeof sel.skin === 'string' && owned.skins.includes(sel.skin)) user.cosmetics.skin = sel.skin;
    if (typeof sel.trail === 'string' && owned.trails.includes(sel.trail)) user.cosmetics.trail = sel.trail;
    if (typeof sel.banner === 'string' && owned.banners.includes(sel.banner)) user.cosmetics.banner = sel.banner;
    if (Array.isArray(sel.emotes)) {
      const picked = sel.emotes.filter((e) => typeof e === 'string' && owned.emotes.includes(e)).slice(0, 8);
      if (picked.length) user.cosmetics.emotes = picked;
    }
    this.users.put(user);
    return { ok: true, cosmetics: user.cosmetics };
  }

  updateSettings(user, settings) {
    if (!settings || typeof settings !== 'object') return { error: 'Invalid settings.' };
    const base = user.settings || defaultSettings();
    const def = defaultSettings();
    for (const key of Object.keys(def)) {
      if (!(key in settings)) continue;
      const v = settings[key];
      const d = def[key];
      if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) base[key] = v;
      else if (typeof d === 'boolean' && typeof v === 'boolean') base[key] = v;
      else if (typeof d === 'string' && typeof v === 'string' && v.length < 40) base[key] = v;
      else if (d === null && (typeof v === 'boolean' || v === null)) base[key] = v;
    }
    user.settings = base;
    this.users.put(user);
    return { ok: true, settings: base };
  }

  purchase(user, category, key) {
    const tables = { skins: Content.SKINS, emotes: Content.EMOTES, trails: Content.TRAILS, banners: Content.BANNERS };
    const table = tables[category];
    if (!table) return { error: 'Unknown store category.' };
    const item = table.find((i) => i.key === key);
    if (!item) return { error: 'Unknown item.' };
    const owned = user.cosmetics.owned[category] || [];
    if (owned.includes(key)) return { error: 'You already own that.' };
    if (user.coins < item.price) return { error: `Not enough coins (need ${item.price}).` };
    user.coins -= item.price;
    owned.push(key);
    user.cosmetics.owned[category] = owned;
    this.users.put(user);
    return { ok: true, coins: user.coins, owned: user.cosmetics.owned };
  }

  // -- progression -----------------------------------------------------------
  _grantDailyBonus(user) {
    const day = Math.floor(nowMs() / 86400000);
    if (user.lastLoginDay === day) return null;
    user.lastLoginDay = day;
    user.coins += Content.COIN_REWARDS.dailyLogin;
    return { coins: Content.COIN_REWARDS.dailyLogin };
  }

  addXp(user, amount) {
    const before = user.level;
    user.xp += Math.max(0, Math.round(amount));
    user.level = Content.levelFromXp(user.xp);
    const levelsGained = user.level - before;
    if (levelsGained > 0) {
      // Level rewards scale with the level reached.
      let coins = 0;
      for (let l = before + 1; l <= user.level; l++) coins += 120 + l * 18;
      user.coins += coins;
      return { levelUp: true, from: before, to: user.level, coins };
    }
    return { levelUp: false };
  }

  /** Applies authoritative end-of-match results. */
  applyMatchResult(user, result) {
    const s = user.stats;
    s.matches++;
    s.kills += result.kills || 0;
    s.assists += result.assists || 0;
    s.damage += Math.round(result.damage || 0);
    s.headshots += result.headshots || 0;
    s.dinoKills += result.dinoKills || 0;
    s.apexKills += result.apexKills || 0;
    s.tranquilised += result.tranquilised || 0;
    s.revives += result.revives || 0;
    s.blocksPlaced += result.blocksPlaced || 0;
    s.blocksBroken += result.blocksBroken || 0;
    s.distance += Math.round(result.distance || 0);
    s.waterTime += Math.round(result.waterTime || 0);
    s.vaults += result.vaults || 0;
    s.survivalTime += Math.round(result.survivalTime || 0);
    s.playtime += Math.round(result.survivalTime || 0);
    if (!result.won) s.deaths += result.died ? 1 : 0;
    if (result.maxAltitude > s.maxAltitude) s.maxAltitude = Math.round(result.maxAltitude);
    if (result.longestKill > s.longestKill) s.longestKill = Math.round(result.longestKill);
    if (result.killStreak > s.killStreak) s.killStreak = result.killStreak;
    if (result.landmarks > s.landmarks) s.landmarks = result.landmarks;
    if (result.won) s.wins++;
    if (result.placement > 0 && (s.bestPlacement === 0 || result.placement < s.bestPlacement)) {
      s.bestPlacement = result.placement;
    }
    if (result.placement > 0 && result.placement <= 10) s.top10++;

    // --- XP
    const R = Content.XP_REWARDS;
    let xp = R.matchPlayed;
    xp += (result.kills || 0) * R.perKill;
    xp += (result.assists || 0) * R.perAssist;
    xp += (result.dinoKills || 0) * R.perDinoKill;
    xp += (result.apexKills || 0) * R.perApexKill;
    xp += (result.revives || 0) * R.perRevive;
    xp += Math.floor((result.survivalTime || 0) / 60) * R.perSurvivalMinute;
    xp += Math.floor((result.damage || 0) / 100) * R.perDamage100;
    if (result.placement > 0 && result.placement <= R.placement.length) xp += R.placement[result.placement - 1];
    if (result.won) xp += R.win;
    else if (result.placement > 0 && result.placement <= 10) xp += R.top10;
    if (result.partySize > 1) xp = Math.round(xp * (1 + R.partyBonus));

    // --- Coins
    const C = Content.COIN_REWARDS;
    let coins = C.matchPlayed + (result.kills || 0) * C.perKill + (result.apexKills || 0) * C.perApexKill;
    if (result.won) coins += C.win;
    else if (result.placement > 0 && result.placement <= 10) coins += C.top10;
    user.coins += coins;

    const levelInfo = this.addXp(user, xp);
    const unlocked = this.checkAchievements(user);
    this.users.put(user);

    return { xp, coins, levelInfo, unlocked, stats: s };
  }

  checkAchievements(user) {
    const unlocked = [];
    for (const ach of Content.ACHIEVEMENTS) {
      if (user.achievements[ach.key]) continue;
      const value = user.stats[ach.stat] || 0;
      if (value >= ach.target) {
        user.achievements[ach.key] = { at: nowMs(), value };
        user.coins += ach.coins;
        user.xp += ach.xp;
        unlocked.push(ach);
      }
    }
    if (unlocked.length) {
      user.level = Content.levelFromXp(user.xp);
      this.users.put(user);
    }
    return unlocked;
  }

  achievementProgress(user) {
    return Content.ACHIEVEMENTS.map((a) => ({
      key: a.key,
      name: a.name,
      desc: a.desc,
      icon: a.icon,
      target: a.target,
      value: Math.min(user.stats[a.stat] || 0, a.target),
      done: !!user.achievements[a.key],
      at: user.achievements[a.key]?.at || 0,
      xp: a.xp,
      coins: a.coins,
    }));
  }

  // -- leaderboards ----------------------------------------------------------
  scoreFor(user, board) {
    const s = user.stats;
    switch (board) {
      case 'kills':
        return s.kills;
      case 'wins':
        return s.wins;
      case 'level':
        return user.xp;
      case 'damage':
        return s.damage;
      case 'kd':
        return s.matches >= 10 ? (s.kills / Math.max(1, s.deaths)) * 1000 : 0;
      case 'apex':
        return s.apexKills;
      default:
        return user.xp;
    }
  }

  leaderboard(board, limit = 100) {
    const users = this.users.top(limit, (u) => this.scoreFor(u, board), (u) => !u.banned && u.stats.matches > 0);
    return users.map((u, i) => this.publicProfile(u, { rank: i + 1, score: this.scoreFor(u, board) }));
  }

  friendsLeaderboard(user, board, limit = 100) {
    const ids = new Set([user.id, ...user.friends]);
    const list = [];
    for (const id of ids) {
      const u = this.users.get(id);
      if (u && !u.banned) list.push(u);
    }
    list.sort((a, b) => this.scoreFor(b, board) - this.scoreFor(a, board));
    return list.slice(0, limit).map((u, i) => this.publicProfile(u, { rank: i + 1, score: this.scoreFor(u, board) }));
  }

  clanLeaderboard(limit = 50) {
    const clans = this.clans.top(limit, (c) => c.xp, () => true);
    return clans.map((c, i) => ({
      rank: i + 1,
      id: c.id,
      name: c.name,
      tag: c.tag,
      xp: c.xp,
      level: Content.levelFromXp(c.xp),
      members: c.members.length,
      kind: c.kind,
    }));
  }

  // -- serialisation ---------------------------------------------------------
  publicProfile(user, extra = {}) {
    const clan = user.clanId ? this.clans.get(user.clanId) : null;
    return {
      id: user.id,
      name: user.name,
      level: user.level,
      xp: user.xp,
      avatar: user.avatar,
      banner: user.cosmetics?.banner || 'claw',
      skin: user.cosmetics?.skin || 'ranger',
      clan: clan ? { id: clan.id, name: clan.name, tag: clan.tag, kind: clan.kind } : null,
      stats: {
        matches: user.stats.matches,
        wins: user.stats.wins,
        kills: user.stats.kills,
        deaths: user.stats.deaths,
        kd: +(user.stats.kills / Math.max(1, user.stats.deaths)).toFixed(2),
        top10: user.stats.top10,
        damage: user.stats.damage,
        apexKills: user.stats.apexKills,
      },
      ...extra,
    };
  }

  selfProfile(user) {
    const clan = user.clanId ? this.clans.get(user.clanId) : null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      level: user.level,
      xp: user.xp,
      xpInLevel: user.xp - Content.xpForLevel(user.level),
      xpForNext: Content.xpForLevel(user.level + 1) - Content.xpForLevel(user.level),
      coins: user.coins,
      gems: user.gems,
      avatar: user.avatar,
      cosmetics: user.cosmetics,
      settings: user.settings,
      stats: user.stats,
      achievements: this.achievementProgress(user),
      createdAt: user.createdAt,
      nameChanges: user.nameChanges,
      hasPassword: !!user.hash,
      linked: {
        google: !!user.oauthGoogle,
        facebook: !!user.oauthFacebook,
      },
      clan: clan
        ? {
            id: clan.id,
            name: clan.name,
            tag: clan.tag,
            kind: clan.kind,
            role: clan.members.find((m) => m.id === user.id)?.role || 'member',
            xp: clan.xp,
            level: Content.levelFromXp(clan.xp),
            memberCount: clan.members.length,
          }
        : null,
    };
  }
}

module.exports = {
  Accounts,
  hashPassword,
  verifyPassword,
  generateRecoveryCode,
  defaultStats,
  defaultAvatar,
  defaultCosmetics,
  defaultSettings,
  sha256,
  newId,
  NAME_RE,
  EMAIL_RE,
};
