'use strict';
/**
 * ============================================================================
 *  Dino Royale Evolution - SHARED GAME CONTENT DATABASE
 * ============================================================================
 *  Weapons, items, saurians, cosmetics, achievements and progression curves.
 *  Embedded verbatim in the client (for UI + prediction + rendering) and
 *  required by the server (which is the sole authority on every value here).
 *
 *  All names, stats and designs are original to Dino Royale Evolution.
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Content = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // ---------------------------------------------------------------------------
  // Rarity tiers
  // ---------------------------------------------------------------------------
  const RARITY = [
    { id: 0, key: 'common', name: 'Common', color: '#b9c2cc', mult: 1.0, weight: 100 },
    { id: 1, key: 'uncommon', name: 'Uncommon', color: '#5fd97a', mult: 1.08, weight: 58 },
    { id: 2, key: 'rare', name: 'Rare', color: '#4aa8ff', mult: 1.16, weight: 30 },
    { id: 3, key: 'epic', name: 'Epic', color: '#b06bff', mult: 1.25, weight: 13 },
    { id: 4, key: 'legendary', name: 'Legendary', color: '#ffb238', mult: 1.36, weight: 5 },
    { id: 5, key: 'fossil', name: 'Fossil', color: '#ff5a5a', mult: 1.5, weight: 1.4 },
  ];

  // ---------------------------------------------------------------------------
  // Weapons. `id` is protocol stable.
  // fireMode: 'auto' | 'semi' | 'burst' | 'bolt' | 'charge' | 'melee' | 'throw'
  // ---------------------------------------------------------------------------
  const WEAPONS = [
    {
      id: 0,
      key: 'fists',
      name: 'Bare Hands',
      class: 'melee',
      fireMode: 'melee',
      damage: 11,
      rpm: 96,
      range: 2.6,
      mag: 0,
      reload: 0,
      spread: 0,
      recoil: 0,
      moveMult: 1.0,
      adsFov: 1.0,
      swayScale: 0.4,
      slot: 'melee',
    },
    {
      id: 1,
      key: 'bone_cleaver',
      name: 'Bone Cleaver',
      class: 'melee',
      fireMode: 'melee',
      damage: 42,
      rpm: 78,
      range: 3.1,
      mag: 0,
      reload: 0,
      spread: 0,
      recoil: 0,
      moveMult: 1.02,
      adsFov: 1.0,
      swayScale: 0.5,
      slot: 'melee',
      lootWeight: 34,
    },
    {
      id: 2,
      key: 'quarry_pick',
      name: 'Quarry Pick',
      class: 'melee',
      fireMode: 'melee',
      damage: 30,
      rpm: 96,
      range: 2.9,
      mag: 0,
      reload: 0,
      spread: 0,
      recoil: 0,
      moveMult: 1.0,
      adsFov: 1.0,
      swayScale: 0.45,
      slot: 'melee',
      harvest: 2.6, // block-mining multiplier
      lootWeight: 40,
    },
    {
      id: 10,
      key: 'ranger_ar',
      name: 'RX-9 Ranger',
      class: 'assault',
      fireMode: 'auto',
      damage: 23,
      rpm: 620,
      range: 92,
      mag: 30,
      reload: 2.3,
      spread: 0.9,
      adsSpread: 0.22,
      recoil: 1.05,
      recoilPattern: [0.9, 0.3],
      moveMult: 0.94,
      adsFov: 0.74,
      swayScale: 1.0,
      slot: 'primary',
      ammo: 'medium',
      bulletSpeed: 620,
      lootWeight: 100,
    },
    {
      id: 11,
      key: 'vulture_smg',
      name: 'Vulture SMG',
      class: 'smg',
      fireMode: 'auto',
      damage: 16,
      rpm: 900,
      range: 48,
      mag: 35,
      reload: 1.9,
      spread: 1.6,
      adsSpread: 0.55,
      recoil: 0.72,
      recoilPattern: [0.6, 0.45],
      moveMult: 1.0,
      adsFov: 0.84,
      swayScale: 0.8,
      slot: 'primary',
      ammo: 'light',
      bulletSpeed: 480,
      lootWeight: 100,
    },
    {
      id: 12,
      key: 'crusher_sg',
      name: 'Crusher Auto-12',
      class: 'shotgun',
      fireMode: 'semi',
      damage: 13,
      pellets: 9,
      rpm: 96,
      range: 26,
      mag: 6,
      reload: 3.1,
      spread: 5.2,
      adsSpread: 3.6,
      recoil: 3.4,
      moveMult: 0.92,
      adsFov: 0.9,
      swayScale: 1.2,
      slot: 'primary',
      ammo: 'shell',
      bulletSpeed: 320,
      lootWeight: 78,
    },
    {
      id: 13,
      key: 'longtooth_dmr',
      name: 'Longtooth DMR',
      class: 'marksman',
      fireMode: 'semi',
      damage: 46,
      rpm: 240,
      range: 160,
      mag: 12,
      reload: 2.6,
      spread: 0.6,
      adsSpread: 0.05,
      recoil: 2.1,
      moveMult: 0.9,
      adsFov: 0.5,
      swayScale: 1.3,
      slot: 'primary',
      ammo: 'heavy',
      bulletSpeed: 780,
      scope: 2.5,
      lootWeight: 62,
    },
    {
      id: 14,
      key: 'apex_sniper',
      name: 'Apex Predator',
      class: 'sniper',
      fireMode: 'bolt',
      damage: 96,
      rpm: 44,
      range: 320,
      mag: 5,
      reload: 3.6,
      spread: 0.4,
      adsSpread: 0.0,
      recoil: 5.0,
      moveMult: 0.86,
      adsFov: 0.28,
      swayScale: 1.6,
      slot: 'primary',
      ammo: 'heavy',
      bulletSpeed: 980,
      scope: 6.0,
      lootWeight: 26,
    },
    {
      id: 15,
      key: 'sentry_lmg',
      name: 'Sentry LMG',
      class: 'lmg',
      fireMode: 'auto',
      damage: 25,
      rpm: 520,
      range: 110,
      mag: 75,
      reload: 4.4,
      spread: 1.4,
      adsSpread: 0.42,
      recoil: 1.5,
      moveMult: 0.84,
      adsFov: 0.8,
      swayScale: 1.5,
      slot: 'primary',
      ammo: 'heavy',
      bulletSpeed: 640,
      lootWeight: 44,
    },
    {
      id: 16,
      key: 'sidearm_p7',
      name: 'Sidearm P7',
      class: 'pistol',
      fireMode: 'semi',
      damage: 20,
      rpm: 380,
      range: 42,
      mag: 15,
      reload: 1.5,
      spread: 1.1,
      adsSpread: 0.34,
      recoil: 0.8,
      moveMult: 1.02,
      adsFov: 0.88,
      swayScale: 0.7,
      slot: 'secondary',
      ammo: 'light',
      bulletSpeed: 420,
      lootWeight: 110,
    },
    {
      id: 17,
      key: 'tranq_rifle',
      name: 'Somnus Tranquiliser',
      class: 'utility',
      fireMode: 'bolt',
      damage: 8,
      rpm: 60,
      range: 70,
      mag: 4,
      reload: 2.8,
      spread: 0.5,
      adsSpread: 0.08,
      recoil: 1.2,
      moveMult: 0.95,
      adsFov: 0.62,
      swayScale: 1.0,
      slot: 'secondary',
      ammo: 'dart',
      bulletSpeed: 240,
      tranq: 46, // sedation applied to saurians
      lootWeight: 50,
    },
    {
      id: 18,
      key: 'harpoon',
      name: 'Tidal Harpoon',
      class: 'utility',
      fireMode: 'bolt',
      damage: 58,
      rpm: 54,
      range: 60,
      mag: 3,
      reload: 2.4,
      spread: 0.3,
      adsSpread: 0.02,
      recoil: 1.8,
      moveMult: 0.93,
      adsFov: 0.72,
      swayScale: 1.1,
      slot: 'secondary',
      ammo: 'bolt',
      bulletSpeed: 190,
      underwater: true,
      lootWeight: 30,
    },
    {
      id: 19,
      key: 'ember_launcher',
      name: 'Ember Launcher',
      class: 'explosive',
      fireMode: 'semi',
      damage: 88,
      splash: 4.6,
      rpm: 40,
      range: 120,
      mag: 1,
      reload: 3.8,
      spread: 0.8,
      adsSpread: 0.2,
      recoil: 4.0,
      moveMult: 0.86,
      adsFov: 0.86,
      swayScale: 1.4,
      slot: 'primary',
      ammo: 'rocket',
      bulletSpeed: 42,
      gravity: 6.0,
      lootWeight: 16,
    },
  ];

  const WEAPON_BY_ID = Object.create(null);
  const WEAPON_BY_KEY = Object.create(null);
  for (const w of WEAPONS) {
    WEAPON_BY_ID[w.id] = w;
    WEAPON_BY_KEY[w.key] = w;
  }

  const AMMO_TYPES = [
    { key: 'light', name: 'Light Rounds', max: 320, stack: 40, color: '#ffd15c' },
    { key: 'medium', name: 'Medium Rounds', max: 240, stack: 30, color: '#8de06a' },
    { key: 'heavy', name: 'Heavy Rounds', max: 160, stack: 20, color: '#ff8b5c' },
    { key: 'shell', name: 'Shells', max: 80, stack: 12, color: '#ff5c8b' },
    { key: 'dart', name: 'Darts', max: 30, stack: 6, color: '#5cd2ff' },
    { key: 'bolt', name: 'Bolts', max: 24, stack: 5, color: '#a0f0ff' },
    { key: 'rocket', name: 'Rockets', max: 8, stack: 2, color: '#ff4040' },
  ];

  // ---------------------------------------------------------------------------
  // Consumables + gear
  // ---------------------------------------------------------------------------
  const ITEMS = [
    { id: 100, key: 'medkit', name: 'Field Medkit', type: 'heal', amount: 60, time: 4.5, stack: 3, lootWeight: 70, slot: 'consumable' },
    { id: 101, key: 'bandage', name: 'Fiber Bandage', type: 'heal', amount: 18, time: 1.8, stack: 8, lootWeight: 120, slot: 'consumable' },
    { id: 102, key: 'shield_cell', name: 'Shield Cell', type: 'shield', amount: 30, time: 2.2, stack: 6, lootWeight: 100, slot: 'consumable' },
    { id: 103, key: 'shield_core', name: 'Shield Core', type: 'shield', amount: 100, time: 5.0, stack: 2, lootWeight: 34, slot: 'consumable' },
    { id: 104, key: 'adrenal', name: 'Adrenal Shot', type: 'buff', buff: 'sprint', dur: 22, time: 2.0, stack: 3, lootWeight: 46, slot: 'consumable' },
    { id: 105, key: 'rebreather', name: 'Rebreather Rig', type: 'gear', gear: 'oxygen', dur: 240, stack: 1, lootWeight: 40, slot: 'gear' },
    { id: 106, key: 'climb_claws', name: 'Raptor Claws', type: 'gear', gear: 'climb', stack: 1, lootWeight: 38, slot: 'gear' },
    { id: 107, key: 'thermal_suit', name: 'Thermal Weave', type: 'gear', gear: 'cold', stack: 1, lootWeight: 42, slot: 'gear' },
    { id: 108, key: 'ash_mask', name: 'Ash Filter Mask', type: 'gear', gear: 'heat', stack: 1, lootWeight: 42, slot: 'gear' },
    { id: 109, key: 'grenade', name: 'Frag Charge', type: 'throw', damage: 92, splash: 5.0, fuse: 2.6, stack: 4, lootWeight: 66, slot: 'throwable' },
    { id: 110, key: 'smoke', name: 'Smoke Veil', type: 'throw', smoke: 9.0, dur: 16, fuse: 1.6, stack: 4, lootWeight: 58, slot: 'throwable' },
    { id: 111, key: 'lure', name: 'Saurian Lure', type: 'throw', lure: 34, dur: 20, fuse: 1.2, stack: 3, lootWeight: 44, slot: 'throwable' },
    { id: 112, key: 'flare', name: 'Signal Flare', type: 'throw', supply: true, fuse: 1.0, stack: 2, lootWeight: 22, slot: 'throwable' },
    { id: 120, key: 'mat_wood', name: 'Timber', type: 'material', block: 'build_wood', stack: 400, lootWeight: 0, slot: 'material' },
    { id: 121, key: 'mat_stone', name: 'Stonework', type: 'material', block: 'build_stone', stack: 400, lootWeight: 0, slot: 'material' },
    { id: 122, key: 'mat_metal', name: 'Alloy Plate', type: 'material', block: 'build_metal', stack: 300, lootWeight: 0, slot: 'material' },
  ];

  const ITEM_BY_ID = Object.create(null);
  const ITEM_BY_KEY = Object.create(null);
  for (const it of ITEMS) {
    ITEM_BY_ID[it.id] = it;
    ITEM_BY_KEY[it.key] = it;
  }

  // ---------------------------------------------------------------------------
  // Saurians (original creature roster)
  // ---------------------------------------------------------------------------
  const DINOS = [
    {
      id: 1,
      key: 'sprinter',
      name: 'Dartclaw',
      role: 'scout',
      hp: 70,
      damage: 14,
      speed: 7.4,
      sprint: 10.6,
      turn: 4.2,
      sight: 42,
      hearing: 30,
      attackRange: 2.2,
      attackCd: 0.9,
      aggression: 0.8,
      pack: 4,
      size: [0.75, 1.05, 1.9],
      xp: 22,
      biomes: ['plains', 'forest', 'savanna', 'jungle'],
      colors: ['#7a6b45', '#94793f', '#6d5f3c'],
      tint: '#c8a24b',
    },
    {
      id: 2,
      key: 'grazer',
      name: 'Bouldercrest',
      role: 'herbivore',
      hp: 340,
      damage: 26,
      speed: 3.2,
      sprint: 5.4,
      turn: 1.4,
      sight: 30,
      hearing: 22,
      attackRange: 3.2,
      attackCd: 1.8,
      aggression: 0.15,
      pack: 3,
      size: [1.9, 2.6, 4.4],
      xp: 46,
      biomes: ['plains', 'forest', 'swamp', 'taiga'],
      colors: ['#4d5a44', '#3f4b39', '#5d6a4f'],
      tint: '#6f7f5c',
    },
    {
      id: 3,
      key: 'apex',
      name: 'Tyrant Maw',
      role: 'apex',
      hp: 900,
      damage: 62,
      speed: 4.6,
      sprint: 8.8,
      turn: 1.7,
      sight: 62,
      hearing: 48,
      attackRange: 4.6,
      attackCd: 1.5,
      aggression: 1.0,
      pack: 1,
      size: [2.2, 4.4, 6.6],
      xp: 260,
      biomes: ['forest', 'jungle', 'volcano', 'badlands'],
      colors: ['#5a3535', '#3f2626', '#6b3f31'],
      tint: '#8a4032',
      boss: true,
    },
    {
      id: 4,
      key: 'glider',
      name: 'Skyrend',
      role: 'flyer',
      hp: 130,
      damage: 22,
      speed: 9.5,
      sprint: 14.0,
      turn: 3.0,
      sight: 78,
      hearing: 40,
      attackRange: 2.6,
      attackCd: 1.4,
      aggression: 0.7,
      pack: 3,
      size: [1.1, 1.3, 2.4],
      wingspan: 5.6,
      flying: true,
      xp: 64,
      biomes: ['mountain', 'snow', 'ocean', 'island', 'volcano'],
      colors: ['#3b4a63', '#2b3648', '#55688a'],
      tint: '#5a7099',
    },
    {
      id: 5,
      key: 'swimmer',
      name: 'Deepfang',
      role: 'aquatic',
      hp: 260,
      damage: 40,
      speed: 6.2,
      sprint: 10.2,
      turn: 2.4,
      sight: 44,
      hearing: 52,
      attackRange: 3.0,
      attackCd: 1.2,
      aggression: 0.9,
      pack: 2,
      size: [1.3, 1.5, 5.2],
      aquatic: true,
      xp: 96,
      biomes: ['ocean', 'river', 'swamp', 'island'],
      colors: ['#2d4d55', '#1f3a42', '#3f6a72'],
      tint: '#377a86',
    },
    {
      id: 6,
      key: 'armored',
      name: 'Ironhide',
      role: 'tank',
      hp: 620,
      damage: 44,
      speed: 3.6,
      sprint: 6.6,
      turn: 1.2,
      sight: 34,
      hearing: 28,
      attackRange: 3.6,
      attackCd: 2.0,
      aggression: 0.45,
      pack: 2,
      size: [2.0, 2.2, 4.8],
      armor: 0.42,
      xp: 130,
      biomes: ['badlands', 'desert', 'mountain', 'volcano'],
      colors: ['#5b5348', '#413b34', '#6d6455'],
      tint: '#7d7361',
    },
    {
      id: 7,
      key: 'stalker',
      name: 'Nightveil',
      role: 'ambusher',
      hp: 190,
      damage: 48,
      speed: 6.0,
      sprint: 11.4,
      turn: 3.6,
      sight: 56,
      hearing: 62,
      attackRange: 2.6,
      attackCd: 1.0,
      aggression: 0.95,
      pack: 1,
      size: [0.9, 1.7, 3.0],
      stealth: 0.7,
      nocturnal: true,
      xp: 150,
      biomes: ['jungle', 'swamp', 'forest', 'taiga'],
      colors: ['#2a2f38', '#1d2128', '#3b434f'],
      tint: '#43506b',
    },
    {
      id: 8,
      key: 'frost',
      name: 'Rimehorn',
      role: 'brute',
      hp: 480,
      damage: 52,
      speed: 4.2,
      sprint: 7.8,
      turn: 1.6,
      sight: 40,
      hearing: 34,
      attackRange: 3.8,
      attackCd: 1.6,
      aggression: 0.7,
      pack: 2,
      size: [1.7, 2.4, 4.2],
      xp: 140,
      biomes: ['snow', 'glacier', 'taiga', 'mountain'],
      colors: ['#8fa6b8', '#6d8194', '#b6cbdb'],
      tint: '#9fc0d8',
    },
  ];

  const DINO_BY_ID = Object.create(null);
  const DINO_BY_KEY = Object.create(null);
  for (const d of DINOS) {
    DINO_BY_ID[d.id] = d;
    DINO_BY_KEY[d.key] = d;
  }

  const DINO_STATE = {
    IDLE: 0,
    WANDER: 1,
    ALERT: 2,
    CHASE: 3,
    ATTACK: 4,
    FLEE: 5,
    EAT: 6,
    SLEEP: 7,
    STUNNED: 8,
    DEAD: 9,
    ROAR: 10,
  };

  // ---------------------------------------------------------------------------
  // Game modes
  // ---------------------------------------------------------------------------
  const MODES = [
    {
      key: 'solo',
      name: 'Solo Royale',
      teamSize: 1,
      maxPlayers: 48,
      minToStart: 2,
      voice: 'proximity',
      fill: true,
      description: 'One survivor. No allies, no mercy.',
    },
    {
      key: 'duo',
      name: 'Duo Royale',
      teamSize: 2,
      maxPlayers: 48,
      minToStart: 2,
      voice: 'team',
      fill: true,
      description: 'Two hunters, one shared fate.',
    },
    {
      key: 'squad',
      name: 'Squad Royale',
      teamSize: 4,
      maxPlayers: 48,
      minToStart: 2,
      voice: 'team',
      fill: true,
      description: 'Four-player squads. Revives enabled.',
    },
    {
      key: 'apex_hunt',
      name: 'Apex Hunt',
      teamSize: 4,
      maxPlayers: 24,
      minToStart: 2,
      voice: 'all',
      fill: true,
      pve: true,
      description: 'Co-operative hunt against escalating saurian waves.',
    },
    {
      key: 'custom',
      name: 'Private Match',
      teamSize: 4,
      maxPlayers: 48,
      minToStart: 1,
      voice: 'team',
      fill: false,
      description: 'Your rules, your lobby, invite only.',
    },
  ];
  const MODE_BY_KEY = Object.create(null);
  for (const m of MODES) MODE_BY_KEY[m.key] = m;

  // ---------------------------------------------------------------------------
  // Progression
  // ---------------------------------------------------------------------------
  /** Total XP required to reach `level` (1-indexed). */
  function xpForLevel(level) {
    if (level <= 1) return 0;
    const n = level - 1;
    // Smooth quadratic curve: level 2 = 800, level 50 ~= 1.4M, level 100 ~= 5.6M
    return Math.round(400 * n * n + 400 * n);
  }
  function levelFromXp(xp) {
    let lo = 1;
    let hi = 500;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xpForLevel(mid) <= xp) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const XP_REWARDS = {
    matchPlayed: 120,
    perKill: 85,
    perAssist: 34,
    perDinoKill: 12,
    perApexKill: 220,
    perRevive: 60,
    perSurvivalMinute: 18,
    perDamage100: 22,
    placement: [1400, 900, 640, 480, 360, 280, 220, 180, 140, 110],
    win: 900,
    top10: 220,
    firstOfDay: 500,
    partyBonus: 0.12,
  };

  const COIN_REWARDS = {
    matchPlayed: 40,
    perKill: 22,
    win: 350,
    top10: 90,
    perApexKill: 80,
    dailyLogin: 150,
  };

  // ---------------------------------------------------------------------------
  // Achievements
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { key: 'first_blood', name: 'First Blood', desc: 'Eliminate your first opponent.', stat: 'kills', target: 1, xp: 300, coins: 100, icon: 'blood' },
    { key: 'hunter_10', name: 'Hunter', desc: 'Eliminate 10 opponents.', stat: 'kills', target: 10, xp: 700, coins: 220, icon: 'hunt' },
    { key: 'hunter_100', name: 'Predator', desc: 'Eliminate 100 opponents.', stat: 'kills', target: 100, xp: 3200, coins: 900, icon: 'hunt' },
    { key: 'hunter_1000', name: 'Alpha Predator', desc: 'Eliminate 1000 opponents.', stat: 'kills', target: 1000, xp: 18000, coins: 5200, icon: 'apex' },
    { key: 'first_win', name: 'Last One Standing', desc: 'Win your first match.', stat: 'wins', target: 1, xp: 900, coins: 400, icon: 'crown' },
    { key: 'win_10', name: 'Serial Survivor', desc: 'Win 10 matches.', stat: 'wins', target: 10, xp: 4200, coins: 1400, icon: 'crown' },
    { key: 'win_50', name: 'Dynasty', desc: 'Win 50 matches.', stat: 'wins', target: 50, xp: 16000, coins: 5000, icon: 'crown' },
    { key: 'apex_slayer', name: 'Apex Slayer', desc: 'Bring down a Tyrant Maw.', stat: 'apexKills', target: 1, xp: 1200, coins: 500, icon: 'skull' },
    { key: 'apex_slayer_25', name: 'Tyrant Bane', desc: 'Bring down 25 Tyrant Maws.', stat: 'apexKills', target: 25, xp: 9000, coins: 3000, icon: 'skull' },
    { key: 'naturalist', name: 'Naturalist', desc: 'Tranquilise 20 saurians.', stat: 'tranquilised', target: 20, xp: 1400, coins: 460, icon: 'leaf' },
    { key: 'architect', name: 'Architect', desc: 'Place 1000 building pieces.', stat: 'blocksPlaced', target: 1000, xp: 1600, coins: 520, icon: 'build' },
    { key: 'demolisher', name: 'Demolisher', desc: 'Destroy 5000 blocks.', stat: 'blocksBroken', target: 5000, xp: 1800, coins: 560, icon: 'break' },
    { key: 'medic', name: 'Field Medic', desc: 'Revive 25 teammates.', stat: 'revives', target: 25, xp: 2200, coins: 700, icon: 'medic' },
    { key: 'marathon', name: 'Marathon', desc: 'Travel 100 km on foot.', stat: 'distance', target: 100000, xp: 2600, coins: 800, icon: 'boot' },
    { key: 'deep_diver', name: 'Deep Diver', desc: 'Spend 30 minutes underwater.', stat: 'waterTime', target: 1800, xp: 1500, coins: 480, icon: 'wave' },
    { key: 'summit', name: 'Summit', desc: 'Reach an altitude of 150 blocks.', stat: 'maxAltitude', target: 150, xp: 900, coins: 300, icon: 'peak' },
    { key: 'explorer', name: 'Cartographer', desc: 'Discover all 7 landmark types.', stat: 'landmarks', target: 7, xp: 3000, coins: 1000, icon: 'map' },
    { key: 'treasure', name: 'Vault Breaker', desc: 'Open 10 hidden vaults.', stat: 'vaults', target: 10, xp: 3400, coins: 1200, icon: 'gem' },
    { key: 'sharpshooter', name: 'Sharpshooter', desc: 'Land 100 headshots.', stat: 'headshots', target: 100, xp: 2800, coins: 900, icon: 'scope' },
    { key: 'socialite', name: 'Pack Leader', desc: 'Add 10 friends.', stat: 'friends', target: 10, xp: 800, coins: 260, icon: 'friends' },
    { key: 'clan_founder', name: 'Clan Founder', desc: 'Create or join a clan.', stat: 'clanJoined', target: 1, xp: 600, coins: 200, icon: 'banner' },
    { key: 'veteran', name: 'Veteran', desc: 'Play 500 matches.', stat: 'matches', target: 500, xp: 12000, coins: 4000, icon: 'star' },
  ];

  // ---------------------------------------------------------------------------
  // Cosmetics - all procedurally rendered, no external assets
  // ---------------------------------------------------------------------------
  const SKINS = [
    { key: 'ranger', name: 'Ranger', rarity: 0, price: 0, palette: ['#3f4a3a', '#6a7a5a', '#2b2f28', '#c8a24b'] },
    { key: 'ashwalker', name: 'Ashwalker', rarity: 1, price: 1200, palette: ['#3a3336', '#5c5054', '#241f21', '#e07a3a'] },
    { key: 'tidal', name: 'Tidal Diver', rarity: 2, price: 2600, palette: ['#1f4550', '#2f7a8a', '#12262c', '#6fe3ff'] },
    { key: 'glacier', name: 'Glacier Scout', rarity: 2, price: 2600, palette: ['#dfe9f2', '#9fb6c8', '#7d8fa0', '#4aa8ff'] },
    { key: 'ember', name: 'Ember Warden', rarity: 3, price: 5200, palette: ['#4a2320', '#8a3a2a', '#2a1512', '#ff8b3a'] },
    { key: 'fossil', name: 'Fossil Sovereign', rarity: 5, price: 14000, palette: ['#d9cfae', '#b3a37c', '#6b5f45', '#ff5a5a'] },
    { key: 'nightveil', name: 'Nightveil Operative', rarity: 4, price: 8600, palette: ['#20242c', '#343b48', '#12141a', '#8f6fff'] },
    { key: 'verdant', name: 'Verdant Stalker', rarity: 3, price: 5200, palette: ['#2c3d24', '#4c6b3a', '#1a2417', '#8de06a'] },
  ];

  const EMOTES = [
    { key: 'wave', name: 'Wave', rarity: 0, price: 0 },
    { key: 'salute', name: 'Salute', rarity: 0, price: 0 },
    { key: 'taunt', name: 'Taunt', rarity: 1, price: 600 },
    { key: 'roar', name: 'Primal Roar', rarity: 2, price: 1400 },
    { key: 'dance', name: 'Victory Step', rarity: 2, price: 1400 },
    { key: 'facepalm', name: 'Facepalm', rarity: 1, price: 600 },
    { key: 'point', name: 'Point', rarity: 0, price: 0 },
    { key: 'crouch_taunt', name: 'Crouch Taunt', rarity: 3, price: 2800 },
  ];

  const TRAILS = [
    { key: 'none', name: 'None', rarity: 0, price: 0, color: null },
    { key: 'ember', name: 'Ember Wake', rarity: 2, price: 1800, color: '#ff7a3a' },
    { key: 'frost', name: 'Frost Wake', rarity: 2, price: 1800, color: '#7fd8ff' },
    { key: 'toxin', name: 'Toxin Wake', rarity: 3, price: 3200, color: '#9dff5a' },
    { key: 'void', name: 'Void Wake', rarity: 4, price: 6400, color: '#b06bff' },
  ];

  const BANNERS = [
    { key: 'claw', name: 'Claw Mark', rarity: 0, price: 0 },
    { key: 'fang', name: 'Fang', rarity: 0, price: 0 },
    { key: 'ridge', name: 'Titan Ridge', rarity: 1, price: 500 },
    { key: 'ember', name: 'Emberfall', rarity: 2, price: 1200 },
    { key: 'vault', name: 'Vault Seal', rarity: 3, price: 2400 },
    { key: 'apex', name: 'Apex Crown', rarity: 4, price: 5000 },
  ];

  /** Ping / map-marker wheel. */
  const PINGS = [
    { id: 0, key: 'go', name: 'Go Here', color: '#4aa8ff', icon: 'arrow' },
    { id: 1, key: 'enemy', name: 'Enemy', color: '#ff4d4d', icon: 'skull' },
    { id: 2, key: 'loot', name: 'Loot', color: '#ffb238', icon: 'box' },
    { id: 3, key: 'danger', name: 'Danger', color: '#ff7a3a', icon: 'warn' },
    { id: 4, key: 'defend', name: 'Defend', color: '#5fd97a', icon: 'shield' },
    { id: 5, key: 'help', name: 'Need Help', color: '#b06bff', icon: 'plus' },
    { id: 6, key: 'dino', name: 'Saurian', color: '#c8a24b', icon: 'claw' },
    { id: 7, key: 'vehicle', name: 'Rally', color: '#6fe3ff', icon: 'flag' },
  ];

  // ---------------------------------------------------------------------------
  // Loot tables
  // ---------------------------------------------------------------------------
  const LOOT_TABLES = {
    crate: { rolls: [2, 4], weapons: 0.55, items: 0.9, ammo: 1.0, rarityBias: 0 },
    supply_case: { rolls: [4, 6], weapons: 0.95, items: 1.0, ammo: 1.0, rarityBias: 2 },
    nest_egg: { rolls: [1, 2], weapons: 0.2, items: 0.8, ammo: 0.6, rarityBias: 1 },
    ground: { rolls: [1, 1], weapons: 0.3, items: 0.5, ammo: 0.8, rarityBias: 0 },
    drop: { rolls: [5, 7], weapons: 1.0, items: 1.0, ammo: 1.0, rarityBias: 3 },
  };

  return {
    RARITY,
    WEAPONS,
    WEAPON_BY_ID,
    WEAPON_BY_KEY,
    AMMO_TYPES,
    ITEMS,
    ITEM_BY_ID,
    ITEM_BY_KEY,
    DINOS,
    DINO_BY_ID,
    DINO_BY_KEY,
    DINO_STATE,
    MODES,
    MODE_BY_KEY,
    xpForLevel,
    levelFromXp,
    XP_REWARDS,
    COIN_REWARDS,
    ACHIEVEMENTS,
    SKINS,
    EMOTES,
    TRAILS,
    BANNERS,
    PINGS,
    LOOT_TABLES,
  };
});
