/* ============================================================
   بطل رويال — لوحة الإعداد قبل اللعب  (Royal Pre-Game Setup)
   ------------------------------------------------------------
   تُحقن قبل محرّك اللعبة وتوفّر الخطّافات التالية:
     window.__ROYAL_SETUP__(project) -> Promise<project>
     window.__ROYAL_OPT__            إعدادات اللعب الحيّة
     window.__ROYAL_PASS__(game,x,z,curG,tgtG,step) -> bool
     window.__ROYAL_WORLD__(game)    بناء الأشجار داخل العالم
     window.__ROYAL_WEAP__(hud,slots,active)
     window.__ROYAL_AMMO__(hud,info)
     window.__ROYAL_HUDL__(hud,w,h,k)
     window.__ROYAL_SKIN__(node,cfg)
   ============================================================ */
(function () {
  "use strict";

  var LS = "royal-setup-v2";

  /* ---------------------------------------------------------- ثوابت */

  var BTN = {
    move: "عصا التحرّك", aim: "عصا التصويب", shoot: "الضرب", jump: "القفز",
    run: "الجري", crouch: "الانخفاض", open: "فتح الصناديق", pickup: "الالتقاط",
    reload: "إعادة التعبئة", emote: "تعبير", view: "تبديل المنظور",
    swap: "تبديل السلاح", bag: "الحقيبة", drop: "رمي السلاح", scope: "التقريب"
  };

  var STAT = {
    kills: "عدّاد القتلى", rank: "الترتيب", alive: "الباقون",
    hp: "شريط الصحة", minimap: "الخريطة المصغّرة", zone: "مؤقّت الزون"
  };

  var SHAPES = [
    ["round", "دائري", "⭕"], ["sq", "مربع", "🟦"], ["hex", "سداسي", "⬢"],
    ["diamond", "معيّن", "🔷"], ["shield", "درع", "🛡️"]
  ];

  var PALETTE = ["#ffffff", "#ffc21a", "#ff8a1e", "#ff4d5e", "#c56bff",
    "#25d3ff", "#39e07b", "#9be15d", "#ff6fb5", "#7b8cff", "#ffe28a", "#8b7fc0"];

  var AMMO_COL = { ar: "#39e07b", smg: "#ffc21a", sg: "#ff4d5e", sr: "#25d3ff", rpg: "#ff8a1e" };
  var AMMO_LAB = { ar: "ذخيرة 5.56", smg: "ذخيرة 9مم", sg: "خرطوش", sr: "ذخيرة 7.62", rpg: "صاروخ" };

  /* اقتراحات رموز لكل زر + لوحة عامة */
  var EMOJI = {
    move: ["🕹️", "🎮", "🧭", "👟", "🔘", "⚪", "🎯", "✋"],
    aim: ["🎯", "👁️", "🔭", "🧿", "➕", "🔴", "🎥", "🕹️"],
    shoot: ["🔫", "💥", "🔥", "⚡", "💢", "🩸", "☄️", "🎇", "❌", "🟥", "🅰️", "👊"],
    jump: ["⬆️", "🔼", "🆙", "🦘", "🕴️", "☝️", "⤴️", "🚀", "🐇", "🪂", "🎈", "🦵"],
    run: ["🏃", "💨", "👟", "⚡", "🏃‍♂️", "🌀", "🔥", "🐆"],
    crouch: ["⬇️", "🔽", "🧎", "🦆", "⤵️", "👇", "🛐", "🫓"],
    open: ["📦", "🎁", "🧰", "🗃️", "🔓", "📤", "💼", "🪤"],
    pickup: ["✋", "🤏", "🫳", "👐", "🖐️", "🤲", "⬇️", "🧲"],
    reload: ["🔄", "🔃", "♻️", "🔁", "🧨", "📥", "⏳", "🔋"],
    emote: ["😀", "😎", "😂", "👍", "🎉", "💃", "👋", "🤝"],
    view: ["👁️", "🎥", "🔄", "🧍", "📷", "🔭", "🖼️", "👀"],
    swap: ["🔁", "🔄", "🗡️", "🔫", "↔️", "🧳", "⚔️", "🎒"],
    bag: ["🎒", "🧳", "👜", "📋", "🗄️", "🧰", "📦", "🛍️"],
    drop: ["🗑️", "⬇️", "📤", "🫳", "❎", "🚮", "💣", "↘️"],
    scope: ["🔭", "🔍", "🎯", "👁️", "🔬", "🧿", "➕", "📡"],
    kills: ["💀", "☠️", "⚔️", "🩸", "🎯", "🔥", "🏹", "💥"],
    rank: ["🏆", "🥇", "👑", "⭐", "📊", "🎖️", "🔝", "💎"],
    alive: ["👥", "🧍", "❤️", "🫂", "👤", "🟢", "🔢", "🎽"],
    hp: ["❤️", "💚", "🩹", "🛡️", "➕", "💗", "🫀", "🧪"],
    minimap: ["🗺️", "🧭", "📍", "🌍", "📌", "🛰️", "🔲", "🏝️"],
    zone: ["⏱️", "⏳", "🌀", "⚠️", "🔵", "☢️", "⌛", "🌊"]
  };

  var EMOJI_ALL = ("⬆️ ⬇️ ⬅️ ➡️ 🔼 🔽 ◀️ ▶️ 🆙 ⤴️ ⤵️ ↔️ 🔄 🔁 🔃 ♻️ ➕ ➖ ✖️ ❌ ✅ ⭕ 🔘 ⚪ ⚫ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 " +
    "🟥 🟧 🟨 🟩 🟦 🟪 🔺 🔻 🔷 🔶 💠 🔳 🔲 ▪️ ▫️ 🕹️ 🎮 🎯 🔫 💣 🧨 ⚔️ 🗡️ 🏹 🪃 🛡️ 💥 🔥 ⚡ 💨 ☄️ 🌀 " +
    "💀 ☠️ 👻 👾 🤖 🦾 👊 ✋ 🤚 🖐️ 👌 🤏 🤲 👐 🫳 🫴 ☝️ 👇 👆 👍 👎 🦵 🦶 👟 👣 🏃 🚶 🧎 🕴️ 🦘 🐇 🐆 🦅 " +
    "❤️ 💚 💙 💛 🧡 💜 🖤 🤍 💗 🩹 🩸 🫀 🧪 💊 🛠️ 🧰 🔧 🔩 ⚙️ 🔋 🔌 📦 🎁 🗃️ 🗄️ 💼 🎒 🧳 👜 🛍️ 🗑️ 🚮 " +
    "👁️ 👀 🔭 🔬 🔍 🔎 🧿 📷 🎥 📡 🛰️ 🗺️ 🧭 📍 📌 🌍 🏝️ ⏱️ ⏳ ⌛ ⏰ 🏆 🥇 👑 ⭐ 🌟 💎 🎖️ 🏅 📊 🔝 " +
    "😀 😎 😂 🥳 😡 🤝 👋 🎉 🎊 🪂 🎈 🚀 🛸 🧲 🪤 🔒 🔓 🔑 ⚠️ ☢️ ☣️ 🌊 🌫️ 🔆").split(/\s+/);

  /* أنواع الأشجار — أجزاء هندسية بسيطة (منخفضة المضلّعات) */
  var TREES = {
    pine: {
      lab: "صنوبر", ico: "🌲", r: 0.52, parts: [
        { g: ["cyl", 0.15, 0.23, 2.3, 7], c: 0x6b4a2b, p: [0, 1.15, 0] },
        { g: ["cyl", 0.001, 1.42, 2.5, 8], c: 0x1d7038, p: [0, 3.0, 0] },
        { g: ["cyl", 0.001, 1.02, 1.95, 8], c: 0x24893f, p: [0, 4.35, 0] },
        { g: ["cyl", 0.001, 0.6, 1.45, 8], c: 0x2d9c4d, p: [0, 5.45, 0] }
      ]
    },
    oak: {
      lab: "عريضة", ico: "🌳", r: 0.6, parts: [
        { g: ["cyl", 0.21, 0.33, 2.6, 8], c: 0x6b4a2b, p: [0, 1.3, 0] },
        { g: ["ico", 1.8, 0], c: 0x2c8f45, p: [0, 3.65, 0], s: [1.05, 0.82, 1.05] },
        { g: ["ico", 1.22, 0], c: 0x37a955, p: [0.35, 4.75, -0.2], s: [1, 0.8, 1] }
      ]
    },
    palm: {
      lab: "نخلة", ico: "🌴", r: 0.46, parts: [
        { g: ["cyl", 0.13, 0.25, 4.5, 7], c: 0x7d5c36, p: [0, 2.25, 0] },
        { g: ["ico", 0.42, 0], c: 0x8a6a3e, p: [0, 4.5, 0] },
        { g: ["cyl", 0.001, 0.34, 2.5, 4], c: 0x2f9b4e, p: [1.0, 4.5, 0], r: [0, 0, -1.25] },
        { g: ["cyl", 0.001, 0.34, 2.5, 4], c: 0x2f9b4e, p: [-1.0, 4.5, 0], r: [0, 0, 1.25] },
        { g: ["cyl", 0.001, 0.34, 2.5, 4], c: 0x35a856, p: [0, 4.5, 1.0], r: [1.25, 0, 0] },
        { g: ["cyl", 0.001, 0.34, 2.5, 4], c: 0x35a856, p: [0, 4.5, -1.0], r: [-1.25, 0, 0] },
        { g: ["cyl", 0.001, 0.3, 1.9, 4], c: 0x3cb35e, p: [0, 5.3, 0] }
      ]
    },
    bush: {
      lab: "شجيرة", ico: "🌿", r: 0.72, parts: [
        { g: ["ico", 0.95, 0], c: 0x2f8f47, p: [0, 0.62, 0], s: [1.15, 0.72, 1.15] },
        { g: ["ico", 0.62, 0], c: 0x39a353, p: [0.45, 0.95, 0.3], s: [1, 0.75, 1] }
      ]
    },
    rock: {
      lab: "صخرة", ico: "🪨", r: 0.85, parts: [
        { g: ["ico", 1.05, 0], c: 0x7c8593, p: [0, 0.55, 0], s: [1.25, 0.7, 1.1] }
      ]
    }
  };

  /* ------------------------------------------------------- أدوات DOM */

  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "style") n.setAttribute("style", attrs[k]);
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n[k] = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (kids) for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexA(hex, a) {
    var h = String(hex || "#ffffff").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function isUrl(s) { return typeof s === "string" && /^(data:|blob:|https?:)/.test(s); }

  /* ------------------------------------------------- التخزين المحلّي */

  var SAVED = null;
  function load() {
    if (SAVED) return SAVED;
    try { SAVED = JSON.parse(localStorage.getItem(LS) || "null") || {}; }
    catch (e) { SAVED = {}; }
    return SAVED;
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(SAVED)); }
    catch (e) { console.warn("setup save failed", e); }
  }
  function wipe() { SAVED = {}; try { localStorage.removeItem(LS); } catch (e) { } }

  /* ------------------------------------------------ إعدادات اللعب */

  var OPT = {
    climb: "strict",       /* free | soft | strict */
    stepH: 0.28,
    badge: { x: 0.5, y: 0.19, size: 0.85, visible: true }
  };
  window.__ROYAL_OPT__ = OPT;

  var CLIMB_MODES = [
    ["free", "حر", "يصعد فوق كل شيء (الوضع الأصلي)"],
    ["soft", "متوسط", "يمنع الصعود على الأشياء المتوسطة"],
    ["strict", "صارم", "لا يصعد فوق أي شيء نهائياً"]
  ];

  /* ============================================================
     1) واجهة الإعداد
     ============================================================ */

  var P = null;          /* المشروع الحيّ */
  var FACTORY = null;    /* نسخة المصنع */
  var UI = null;
  var resolveGo = null;
  var tab = "btn";
  var sel = null;        /* {type:'btn'|'stat', id} */
  var grid = true;

  function boot(project) {
    P = project;
    if (!P.map) P.map = {};
    if (!Array.isArray(P.map.trees)) P.map.trees = [];
    FACTORY = {
      layout: clone(P.controls.layout),
      stats: clone(P.controls.stats),
      scale: P.controls.scale,
      weapons: clone(P.weapons),
      crates: clone(P.map.crates || [])
    };
    applySaved();
    return new Promise(function (res) {
      resolveGo = res;
      buildUI();
      show(true);
    });
  }

  /* دمج المحفوظ فوق مشروع المصنع */
  function applySaved() {
    var s = load(), i, j, f;
    if (s.opt) {
      if (s.opt.climb) OPT.climb = s.opt.climb;
      if (typeof s.opt.stepH === "number") OPT.stepH = s.opt.stepH;
      if (s.opt.badge) for (var k in s.opt.badge) OPT.badge[k] = s.opt.badge[k];
    }
    if (s.layout) for (i = 0; i < P.controls.layout.length; i++) {
      f = s.layout[P.controls.layout[i].id];
      if (f) for (j in f) P.controls.layout[i][j] = f[j];
    }
    if (s.stats) for (i = 0; i < P.controls.stats.length; i++) {
      f = s.stats[P.controls.stats[i].id];
      if (f) for (j in f) P.controls.stats[i][j] = f[j];
    }
    if (typeof s.scale === "number") P.controls.scale = s.scale;
    for (i = 0; i < P.weapons.length; i++) {
      var w = P.weapons[i];
      if (!w.color) w.color = AMMO_COL[w.ammo] || "#ffc21a";
      f = s.weapons && s.weapons[w.id];
      if (f) {
        if (f.emo) w.emo = f.emo;
        if (f.icon) w.icon = f.icon;
        if (f.color) w.color = f.color;
      }
    }
    if (Array.isArray(s.trees)) P.map.trees = clone(s.trees);
    if (Array.isArray(s.crates) && s.crates.length) P.map.crates = clone(s.crates);
  }

  /* حفظ الحالة الحالية */
  function persist() {
    var s = load(), i, w;
    s.layout = {}; s.stats = {};
    for (i = 0; i < P.controls.layout.length; i++) {
      var c = P.controls.layout[i];
      s.layout[c.id] = { x: c.x, y: c.y, size: c.size, shape: c.shape, emoji: c.emoji, icon: c.icon, opacity: c.opacity, visible: c.visible, color: c.color };
    }
    for (i = 0; i < P.controls.stats.length; i++) {
      var t = P.controls.stats[i];
      s.stats[t.id] = { x: t.x, y: t.y, size: t.size, emoji: t.emoji, icon: t.icon, visible: t.visible, zoom: t.zoom };
    }
    s.scale = P.controls.scale;
    s.weapons = {};
    for (i = 0; i < P.weapons.length; i++) { w = P.weapons[i]; s.weapons[w.id] = { emo: w.emo, icon: w.icon, color: w.color }; }
    s.trees = P.map.trees;
    s.crates = P.map.crates;
    s.opt = { climb: OPT.climb, stepH: OPT.stepH, badge: OPT.badge };
    SAVED = s; save();
  }

  /* ------------------------------------------------------ هيكل الواجهة */

  function buildUI() {
    if (UI) return;
    var root = el("div", { id: "rsetup" });
    var stage = el("div", { id: "rs-stage" });
    var eye = el("button", {
      id: "rs-eye", text: "👁️", title: "إخفاء الأدوات لرؤية الترتيب",
      onclick: function () { setBare(true); }
    });
    var back = el("button", { id: "rs-back", text: "🛠️ إظهار الأدوات", onclick: function () { setBare(false); } });
    var top = el("div", { id: "rs-top" }, [
      el("div", { id: "rs-tabs" }),
      eye,
      el("button", { id: "rs-reset", title: "استعادة الإعدادات الافتراضية", onclick: resetAll, text: "↺" }),
      el("button", { id: "rs-start", onclick: start, text: "▶️ ابدأ اللعبة" })
    ]);
    var sheet = el("div", { id: "rs-sheet" });
    var panel = el("div", { id: "rs-panel" }, [
      el("div", { id: "rs-grip" }, [
        el("b"), el("span", { id: "rs-ptitle", text: "اختر عنصراً من الشاشة" }),
        el("i", { text: "▴" })
      ]),
      el("div", { id: "rs-pbody" })
    ]);
    root.appendChild(stage); root.appendChild(top); root.appendChild(sheet);
    root.appendChild(panel); root.appendChild(back);
    document.body.appendChild(root);

    /* ضغطة على فراغ المسرح: تُلغي التحديد وتُعيد الأدوات */
    stage.addEventListener("pointerdown", function () {
      if (root.classList.contains("bare")) { setBare(false); return; }
      if (sel) { sel = null; renderPanel(); renderStage(); openPanel(false); }
    });

    UI = {
      root: root, stage: stage, tabs: top.querySelector("#rs-tabs"), sheet: sheet,
      panel: panel, pbody: panel.querySelector("#rs-pbody"),
      ptitle: panel.querySelector("#rs-ptitle"), eye: eye, back: back,
      grip: panel.querySelector("#rs-grip")
    };

    UI.grip.onclick = function () {
      panel.classList.toggle("min");
      UI.grip.querySelector("i").textContent = panel.classList.contains("min") ? "▴" : "▾";
    };
    panel.classList.add("min");

    [["btn", "🎮 الأزرار"], ["stat", "📊 العدّادات"], ["weap", "🔫 الأسلحة"],
    ["map", "🌳 الأشجار والصناديق"], ["play", "⚙️ اللعب"]].forEach(function (t) {
      UI.tabs.appendChild(el("button", {
        class: "rs-tab", "data-t": t[0], text: t[1],
        onclick: function () { setTab(t[0]); }
      }));
    });

    addEventListener("resize", function () { if (UI && UI.root.classList.contains("on")) renderStage(); });
    setTab("btn");
  }

  function openPanel(on) {
    UI.panel.classList.toggle("min", !on);
    UI.grip.querySelector("i").textContent = on ? "▾" : "▴";
  }

  function show(on) {
    UI.root.classList.toggle("on", !!on);
    var b = document.getElementById("rs-boot");
    if (b) b.remove();
    if (on) setTab(tab);
  }

  function setBare(on) {
    UI.root.classList.toggle("bare", !!on);
    if (on) toast("اضغط على أي مكان فارغ لإظهار الأدوات");
  }

  function setTab(t) {
    tab = t; sel = null;
    setBare(false);
    var i, ts = UI.tabs.children;
    for (i = 0; i < ts.length; i++) ts[i].classList.toggle("on", ts[i].getAttribute("data-t") === t);
    var stageTab = (t === "btn" || t === "stat");
    UI.sheet.classList.toggle("on", !stageTab);
    UI.panel.style.display = stageTab ? "" : "none";
    UI.stage.style.display = stageTab ? "" : "none";
    UI.eye.style.display = stageTab ? "" : "none";
    if (stageTab) { renderStage(); renderPanel(); openPanel(false); }
    else if (t === "weap") renderWeapons();
    else if (t === "map") renderMap();
    else renderPlay();
  }

  /* -------------------------------------------------- معاينة الشاشة */

  function stageSize() {
    return { w: UI.stage.clientWidth || innerWidth, h: UI.stage.clientHeight || innerHeight };
  }
  function hudScale() {
    var s = stageSize();
    return (s.h / 720) * (P.controls.scale || 1);
  }

  function renderStage() {
    if (!UI) return;
    UI.stage.innerHTML = "";
    UI.stage.classList.toggle("grid-off", !grid);
    var s = stageSize(), k = hudScale(), i;

    if (tab === "btn") {
      for (i = 0; i < P.controls.layout.length; i++) mkWidget(P.controls.layout[i], s, k);
    } else {
      for (i = 0; i < P.controls.stats.length; i++) mkStat(P.controls.stats[i], s, k);
      mkBadge(s);
    }
  }

  function mkWidget(cfg, s, k) {
    var stick = (cfg.id === "move" || cfg.id === "aim");
    var node;
    if (stick) {
      node = el("div", { class: "stick rs-w" }, [el("div", { class: "knob" })]);
    } else {
      var body = el("div", { class: "body" }, [iconNode(cfg)]);
      node = el("div", { class: "gw rs-w shape-" + (cfg.shape || "round") }, [body]);
      skinWidget(node, cfg);
    }
    var a = (cfg.size || 60) * k;
    node.style.position = "absolute";
    node.style.width = node.style.height = a + "px";
    node.style.left = (cfg.x * s.w - a / 2) + "px";
    node.style.top = (cfg.y * s.h - a / 2) + "px";
    node.style.opacity = (cfg.opacity == null ? 0.92 : cfg.opacity);
    node.classList.toggle("off", !cfg.visible);
    if (sel && sel.type === "btn" && sel.id === cfg.id) node.classList.add("sel");
    drag(node, cfg, s, "btn");
    UI.stage.appendChild(node);
  }

  function mkStat(cfg, s, k) {
    var node;
    if (cfg.id === "hp") {
      node = el("div", { class: "rs-w", style: "position:absolute;pointer-events:auto;width:min(240px,42vw);height:22px;border-radius:9px;border:1.5px solid rgba(255,255,255,.3);background:linear-gradient(180deg,#5cff8d,#12a84a);display:grid;place-items:center;font-size:11px;font-weight:900;color:#04240f" }, ["100 / 100"]);
      node.style.left = (cfg.x * s.w) + "px";
      node.style.top = (cfg.y * s.h - 11) + "px";
      node.style.transform = "translateX(-50%) scale(" + (cfg.size || 1) + ")";
    } else if (cfg.id === "minimap") {
      var a = (cfg.size || 155) * k;
      node = el("div", { class: "rs-w", style: "position:absolute;pointer-events:auto;border-radius:12px;border:2px solid rgba(255,255,255,.35);background:radial-gradient(circle at 40% 35%,#1c6b3a,#0b3d5c);display:grid;place-items:center;font-size:26px" }, ["🗺️"]);
      node.style.width = node.style.height = a + "px";
      node.style.left = (cfg.x * s.w - a / 2) + "px";
      node.style.top = (cfg.y * s.h - a / 2) + "px";
    } else {
      node = el("div", { class: "hud-stat rs-w", style: "pointer-events:auto" }, [
        el("span", { class: "e" }, [iconNode(cfg, true)]),
        el("span", { class: "v", text: cfg.id === "rank" ? "#12" : cfg.id === "zone" ? "1:20" : "7" })
      ]);
      node.style.left = (cfg.x * s.w) + "px";
      node.style.top = (cfg.y * s.h) + "px";
      node.style.transform = "translate(-50%,-50%) scale(" + ((cfg.size || 1) * clamp(hudScale(), 0.7, 1.5)) + ")";
    }
    node.classList.toggle("off", !cfg.visible);
    if (sel && sel.type === "stat" && sel.id === cfg.id) node.classList.add("sel");
    drag(node, cfg, s, "stat");
    UI.stage.appendChild(node);
  }

  /* شارة السلاح المحمول (معاينة) */
  function mkBadge(s) {
    var w = P.weapons[2] || P.weapons[0];
    var node = el("div", { class: "rs-w", id: null, style: "position:absolute;pointer-events:auto" });
    node.className = "rs-w";
    node.id = "";
    node.setAttribute("style", "position:absolute;pointer-events:auto;display:flex;align-items:center;gap:9px;padding:6px 12px 6px 8px;border-radius:15px;direction:rtl;background:linear-gradient(180deg,rgba(10,6,32,.9),rgba(10,6,32,.66));border:2px solid " + (w.color || "#ffc21a") + ";box-shadow:0 6px 18px rgba(0,0,0,.55)");
    var ic = el("div", { style: "flex:0 0 auto;width:52px;height:52px;border-radius:12px;display:grid;place-items:center;font-size:31px;background:rgba(0,0,0,.4);border:1.5px solid " + (w.color || "#ffc21a") + ";overflow:hidden" });
    ic.appendChild(isUrl(w.icon) ? el("img", { src: w.icon, style: "width:100%;height:100%;object-fit:contain" }) : document.createTextNode(w.emo || "🔫"));
    node.appendChild(ic);
    node.appendChild(el("div", {}, [
      el("b", { style: "display:block;font-size:14px;font-weight:900;color:" + (w.color || "#ffc21a"), text: w.name }),
      el("span", { style: "display:block;font-size:11px;font-weight:800;color:#c9c0ee;direction:ltr;text-align:right", text: "30 / 90" })
    ]));
    node.classList.toggle("off", !OPT.badge.visible);
    if (sel && sel.type === "badge") node.classList.add("sel");
    node.style.left = (OPT.badge.x * s.w) + "px";
    node.style.top = (OPT.badge.y * s.h) + "px";
    node.style.transform = "translate(-50%,-50%) scale(" + (OPT.badge.size || 1) + ")";
    drag(node, OPT.badge, s, "badge", "badge");
    UI.stage.appendChild(node);
  }

  function iconNode(cfg, plain) {
    if (isUrl(cfg.icon)) return el("img", { src: cfg.icon, alt: "" });
    var t = cfg.emoji || "•";
    return plain ? document.createTextNode(t) : el("span", { class: "emo", text: t });
  }

  /* تلوين الزر (نفس الدالة تُستعمل داخل اللعبة) */
  function skinWidget(node, cfg) {
    var body = node.querySelector ? node.querySelector(".body") : null;
    if (!body) return;
    var c = cfg && cfg.color;
    if (c && c.toLowerCase() !== "#ffffff") {
      body.style.background = "radial-gradient(circle at 35% 30%," + hexA(c, 0.62) + "," + hexA(c, 0.18) + ")";
      body.style.borderColor = hexA(c, 0.9);
      body.style.boxShadow = "0 4px 14px rgba(0,0,0,.5),0 0 15px -3px " + c;
    } else {
      body.style.background = ""; body.style.borderColor = ""; body.style.boxShadow = "";
    }
  }
  window.__ROYAL_SKIN__ = skinWidget;

  /* ------------------------------------------------------- السحب */

  function drag(node, cfg, s, type, id) {
    var st = null;
    node.style.touchAction = "none";
    node.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      st = { px: e.clientX, py: e.clientY, x: cfg.x, y: cfg.y, moved: 0 };
      select(type, id || cfg.id);
    });
    node.addEventListener("pointermove", function (e) {
      if (!st) return;
      var dx = e.clientX - st.px, dy = e.clientY - st.py;
      st.moved += Math.abs(dx) + Math.abs(dy);
      /* أثناء السحب نُخفي اللوحة حتى لا تحجب العنصر */
      if (st.moved > 6) UI.root.classList.add("drag");
      cfg.x = clamp(st.x + dx / s.w, 0.02, 0.98);
      cfg.y = clamp(st.y + dy / s.h, 0.02, 0.98);
      var a = parseFloat(node.style.width) || 0;
      if (type === "btn" || (type === "stat" && cfg.id === "minimap")) {
        node.style.left = (cfg.x * s.w - a / 2) + "px";
        node.style.top = (cfg.y * s.h - a / 2) + "px";
      } else {
        node.style.left = (cfg.x * s.w) + "px";
        node.style.top = (cfg.y * s.h) + "px";
      }
    });
    function up() {
      UI.root.classList.remove("drag");
      if (st) { st = null; persist(); }
    }
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function select(type, id) {
    sel = { type: type, id: id };
    var ws = UI.stage.querySelectorAll(".rs-w");
    for (var i = 0; i < ws.length; i++) ws[i].classList.remove("sel");
    renderPanel();
    openPanel(true);
    renderStage();
  }

  /* ------------------------------------------------ لوحة تحرير العنصر */

  function curCfg() {
    if (!sel) return null;
    if (sel.type === "badge") return OPT.badge;
    var arr = sel.type === "btn" ? P.controls.layout : P.controls.stats;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === sel.id) return arr[i];
    return null;
  }

  function renderPanel() {
    var b = UI.pbody; b.innerHTML = "";
    var cfg = curCfg();

    /* أدوات عامة دائماً */
    var head = el("div", { class: "rs-row" }, [
      el("span", { class: "rs-lab", text: "حجم الكل" }),
      slider(0.6, 1.6, 0.05, P.controls.scale || 1, function (v) {
        P.controls.scale = v; persist(); renderStage();
      }),
      el("button", { class: "rs-chip" + (grid ? " on" : ""), text: "▦ الشبكة", onclick: function (e) { grid = !grid; e.target.classList.toggle("on", grid); UI.stage.classList.toggle("grid-off", !grid); } })
    ]);
    b.appendChild(head);

    if (!cfg) {
      UI.ptitle.textContent = tab === "btn" ? "اضغط على أي زر لتعديله" : "اضغط على أي عدّاد لتعديله";
      b.appendChild(el("div", { class: "rs-hint", text: "• اسحب العنصر بإصبعك لتغيير مكانه.  • اضغط عليه لفتح خيارات الشكل والأيقونة واللون." }));
      var q = el("div", { class: "rs-chips" });
      var arr = tab === "btn" ? P.controls.layout : P.controls.stats;
      arr.forEach(function (c) {
        q.appendChild(el("button", {
          class: "rs-chip", text: (c.emoji || "•") + " " + ((tab === "btn" ? BTN : STAT)[c.id] || c.id),
          onclick: function () { select(tab, c.id); }
        }));
      });
      if (tab === "stat") q.appendChild(el("button", { class: "rs-chip", text: "🔫 شارة السلاح المحمول", onclick: function () { select("badge", "badge"); } }));
      b.appendChild(q);
      return;
    }

    var name = sel.type === "badge" ? "شارة السلاح المحمول"
      : (sel.type === "btn" ? BTN : STAT)[cfg.id] || cfg.id;
    UI.ptitle.textContent = "✏️ " + name;

    /* ظاهر / مخفي */
    b.appendChild(el("div", { class: "rs-row" }, [
      el("button", {
        class: "rs-chip " + (cfg.visible ? "ok" : "dz"),
        text: cfg.visible ? "👁️ ظاهر" : "🚫 مخفي",
        onclick: function () { cfg.visible = !cfg.visible; persist(); renderPanel(); renderStage(); }
      }),
      el("button", {
        class: "rs-chip", text: "↺ افتراضي", onclick: function () { resetOne(); }
      }),
      el("button", { class: "rs-chip", text: "✔️ تم", onclick: function () { sel = null; renderPanel(); renderStage(); } })
    ]));

    /* الحجم */
    if (sel.type === "badge") {
      b.appendChild(row("الحجم", slider(0.6, 2, 0.05, cfg.size || 1, function (v) { cfg.size = v; persist(); renderStage(); })));
    } else if (sel.type === "btn") {
      b.appendChild(row("الحجم", slider(40, 220, 2, cfg.size || 60, function (v) { cfg.size = v; persist(); renderStage(); })));
      b.appendChild(row("الشفافية", slider(0.25, 1, 0.02, cfg.opacity == null ? 0.92 : cfg.opacity, function (v) { cfg.opacity = v; persist(); renderStage(); })));
    } else if (cfg.id === "minimap") {
      b.appendChild(row("الحجم", slider(90, 320, 5, cfg.size || 155, function (v) { cfg.size = v; persist(); renderStage(); })));
      b.appendChild(row("التقريب", slider(0.5, 3, 0.1, cfg.zoom || 1, function (v) { cfg.zoom = v; persist(); })));
    } else {
      b.appendChild(row("الحجم", slider(0.6, 2.4, 0.05, cfg.size || 1, function (v) { cfg.size = v; persist(); renderStage(); })));
    }

    /* ضبط دقيق للمكان */
    b.appendChild(row("تحريك دقيق", nudge(cfg)));

    /* شكل الزر */
    if (sel.type === "btn" && cfg.id !== "move" && cfg.id !== "aim") {
      var sh = el("div", { class: "rs-chips" });
      SHAPES.forEach(function (s2) {
        sh.appendChild(el("button", {
          class: "rs-chip" + ((cfg.shape || "round") === s2[0] ? " on" : ""),
          text: s2[2] + " " + s2[1],
          onclick: function () { cfg.shape = s2[0]; persist(); renderPanel(); renderStage(); }
        }));
      });
      b.appendChild(row("الشكل", sh));
    }

    /* اللون */
    if (sel.type === "btn") {
      var cw = el("div", { class: "rs-cols" });
      PALETTE.forEach(function (c) {
        var i2 = el("i", { style: "background:" + c });
        if ((cfg.color || "#ffffff").toLowerCase() === c) i2.classList.add("on");
        i2.onclick = function () { cfg.color = c; persist(); renderPanel(); renderStage(); };
        cw.appendChild(i2);
      });
      var inp = el("input", { type: "color", value: cfg.color || "#ffffff", style: "width:34px;height:30px;border:0;background:none;padding:0;cursor:pointer" });
      inp.oninput = function () { cfg.color = inp.value; persist(); renderStage(); };
      cw.appendChild(inp);
      b.appendChild(row("اللون", cw));
    }

    /* الأيقونة */
    if (sel.type !== "badge") {
      var pool = (EMOJI[cfg.id] || []).concat(EMOJI_ALL);
      var seen = {}, list = [];
      pool.forEach(function (e2) { if (!seen[e2]) { seen[e2] = 1; list.push(e2); } });
      var grid2 = el("div", { class: "rs-emo" });
      list.forEach(function (e2) {
        var n = el("b", { text: e2 });
        if (!isUrl(cfg.icon) && cfg.emoji === e2) n.classList.add("on");
        n.onclick = function () { cfg.emoji = e2; cfg.icon = null; persist(); renderPanel(); renderStage(); };
        grid2.appendChild(n);
      });
      b.appendChild(el("div", { class: "rs-lab", text: "الرمز / الأيقونة", style: "margin-top:8px" }));
      b.appendChild(grid2);
      b.appendChild(el("div", { class: "rs-row" }, [
        upload("🖼️ ارفع صورة", function (url) { cfg.icon = url; persist(); renderPanel(); renderStage(); }),
        isUrl(cfg.icon) ? el("button", { class: "rs-chip dz", text: "🗑️ احذف الصورة", onclick: function () { cfg.icon = null; persist(); renderPanel(); renderStage(); } }) : null
      ]));
    }
  }

  function row(lab, node) {
    return el("div", { class: "rs-row" }, [el("span", { class: "rs-lab", text: lab }), node]);
  }

  function slider(min, max, step, val, cb) {
    var wrap = el("div", { class: "rs-row", style: "flex:1;margin:0;gap:6px" });
    var i = el("input", { type: "range", class: "rs-sl", min: min, max: max, step: step, value: val });
    var out = el("span", { class: "rs-num", text: fmt(val) });
    i.oninput = function () { var v = parseFloat(i.value); out.textContent = fmt(v); cb(v); };
    wrap.appendChild(i); wrap.appendChild(out);
    return wrap;
  }
  function fmt(v) { return (Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v)) + ""; }

  function nudge(cfg) {
    var w = el("div", { class: "rs-chips" });
    [["◀", -0.01, 0], ["▶", 0.01, 0], ["▲", 0, -0.01], ["▼", 0, 0.01]].forEach(function (d) {
      w.appendChild(el("button", {
        class: "rs-chip", text: d[0], onclick: function () {
          cfg.x = clamp(cfg.x + d[1], 0.02, 0.98);
          cfg.y = clamp(cfg.y + d[2], 0.02, 0.98);
          persist(); renderStage();
        }
      }));
    });
    return w;
  }

  /* رفع صورة → تصغيرها إلى PNG صغير */
  function upload(label, cb) {
    var inp = el("input", { type: "file", accept: "image/*", style: "display:none" });
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var S = 128, c = document.createElement("canvas");
          c.width = c.height = S;
          var g = c.getContext("2d");
          var k = Math.min(S / img.width, S / img.height);
          var w = img.width * k, h = img.height * k;
          g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
          cb(c.toDataURL("image/png"));
        };
        img.onerror = function () { alert("تعذّر قراءة الصورة"); };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
      inp.value = "";
    };
    var btn = el("button", { class: "rs-chip", text: label, onclick: function () { inp.click(); } });
    var wrap = el("span", {}, [btn, inp]);
    return wrap;
  }

  function resetOne() {
    var cfg = curCfg(); if (!cfg) return;
    if (sel.type === "badge") { OPT.badge = { x: 0.5, y: 0.19, size: 0.85, visible: true }; }
    else {
      var src = sel.type === "btn" ? FACTORY.layout : FACTORY.stats, i, f = null;
      for (i = 0; i < src.length; i++) if (src[i].id === sel.id) f = src[i];
      if (f) for (var k in f) cfg[k] = clone(f[k]);
    }
    persist(); renderPanel(); renderStage();
  }

  function resetAll() {
    if (!confirm("استعادة كل الإعدادات الافتراضية (الأزرار والعدّادات والأسلحة والأشجار)؟")) return;
    wipe();
    P.controls.layout = clone(FACTORY.layout);
    P.controls.stats = clone(FACTORY.stats);
    P.controls.scale = FACTORY.scale;
    P.weapons.forEach(function (w, i) {
      var f = FACTORY.weapons[i];
      w.emo = f.emo; w.icon = f.icon; w.color = AMMO_COL[w.ammo] || "#ffc21a";
    });
    P.map.trees = [];
    P.map.crates = clone(FACTORY.crates);
    OPT.climb = "strict"; OPT.stepH = 0.28;
    OPT.badge = { x: 0.5, y: 0.19, size: 0.85, visible: true };
    sel = null; persist(); setTab(tab);
  }

  /* ============================================================
     2) صفحة الأسلحة
     ============================================================ */

  function renderWeapons() {
    var s = UI.sheet; s.innerHTML = "";
    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🔫 أيقونات وألوان الأسلحة" }),
      el("div", { class: "rs-hint", text: "الرمز واللون يظهران في شريط الأسلحة أسفل الشاشة وفي شارة السلاح المحمول، حتى تعرف بوضوح ماذا تحمل الآن." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip ok", text: "🎨 استعادة ألوان الأسلحة الأصلية",
          onclick: function () {
            P.weapons.forEach(function (w) { w.color = AMMO_COL[w.ammo] || "#ffc21a"; });
            persist(); renderWeapons();
          }
        }),
        el("button", {
          class: "rs-chip", text: "↺ استعادة الرموز الأصلية",
          onclick: function () {
            P.weapons.forEach(function (w, i) { w.emo = FACTORY.weapons[i].emo; w.icon = null; });
            persist(); renderWeapons();
          }
        })
      ])
    ]));

    P.weapons.forEach(function (w) {
      var col = w.color || AMMO_COL[w.ammo] || "#ffc21a";
      var pv = el("div", { class: "pv", style: "border-color:" + col + ";color:" + col });
      pv.appendChild(isUrl(w.icon) ? el("img", { src: w.icon }) : document.createTextNode(w.emo || "🔫"));
      var card = el("div", { class: "rs-card" }, [
        el("div", { class: "rs-wp", style: "border:0;background:none;padding:0;margin:0" }, [
          pv,
          el("div", { class: "in" }, [
            el("b", { text: w.name }),
            el("span", { text: (AMMO_LAB[w.ammo] || w.ammo) + " • ضرر " + w.damage + " • مخزن " + w.mag })
          ])
        ])
      ]);

      /* لوحة الرموز */
      var g = el("div", { class: "rs-emo" });
      ["🔫", "🪖", "💥", "🎯", "🚀", "🧨", "⚔️", "🗡️", "🏹", "🔥", "⚡", "☄️", "🛡️", "💣", "🟥", "🟩", "🟦", "🟨", "🟧", "🟪", "🔴", "🟢", "🔵", "🟡"].forEach(function (e2) {
        var n = el("b", { text: e2 });
        if (!isUrl(w.icon) && w.emo === e2) n.classList.add("on");
        n.onclick = function () { w.emo = e2; w.icon = null; persist(); renderWeapons(); };
        g.appendChild(n);
      });
      card.appendChild(el("div", { class: "rs-lab", text: "الرمز", style: "margin-top:6px" }));
      card.appendChild(g);

      var cw = el("div", { class: "rs-cols" });
      PALETTE.concat([AMMO_COL[w.ammo] || "#ffc21a"]).forEach(function (c) {
        var i2 = el("i", { style: "background:" + c });
        if (col.toLowerCase() === c.toLowerCase()) i2.classList.add("on");
        i2.onclick = function () { w.color = c; persist(); renderWeapons(); };
        cw.appendChild(i2);
      });
      var inp = el("input", { type: "color", value: col, style: "width:34px;height:30px;border:0;background:none;padding:0" });
      inp.oninput = function () { w.color = inp.value; persist(); };
      cw.appendChild(inp);
      card.appendChild(row("اللون", cw));

      card.appendChild(el("div", { class: "rs-row" }, [
        upload("🖼️ ارفع أيقونة", function (url) { w.icon = url; persist(); renderWeapons(); }),
        isUrl(w.icon) ? el("button", { class: "rs-chip dz", text: "🗑️ احذف الصورة", onclick: function () { w.icon = null; persist(); renderWeapons(); } }) : null
      ]));
      s.appendChild(card);
    });
  }

  /* ============================================================
     3) صفحة الأشجار والصناديق
     ============================================================ */

  var MAP = { tool: "move", sel: null, view: null, cv: null, ctx: null, poly: null };

  function mapPoly() {
    var p = (P.map.boundary && P.map.boundary.poly) || [];
    if (p.length > 2) return p;
    /* احتياطي: مربّع حول الصناديق */
    var cs = P.map.crates || [];
    if (!cs.length) return [{ x: -200, z: -200 }, { x: 200, z: -200 }, { x: 200, z: 200 }, { x: -200, z: 200 }];
    var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    cs.forEach(function (c) { mnx = Math.min(mnx, c.x); mxx = Math.max(mxx, c.x); mnz = Math.min(mnz, c.z); mxz = Math.max(mxz, c.z); });
    var m = 60;
    return [{ x: mnx - m, z: mnz - m }, { x: mxx + m, z: mnz - m }, { x: mxx + m, z: mxz + m }, { x: mnx - m, z: mxz + m }];
  }

  function inPoly(x, z, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) inside = !inside;
    }
    return inside;
  }

  function renderMap() {
    var s = UI.sheet; s.innerHTML = "";
    MAP.poly = mapPoly();

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🌳 الأشجار والصناديق" }),
      el("div", { class: "rs-hint", html: "اختر أداة ثم اضغط على الخريطة.<br>• <b>تحريك</b>: اسحب العنصر لمكان جديد (اسحب الفراغ لتحريك الخريطة).<br>• <b>إضافة</b>: اضغط على أي مكان داخل الجزيرة.<br>• <b>حذف</b>: اضغط على العنصر.<br>الأشجار التي تضعها تصبح <b>عوائق صلبة</b> لا يمكن اختراقها ولا تسلّقها." })
    ]));

    var tools = el("div", { class: "rs-chips", style: "margin-bottom:8px" });
    [["move", "✋ تحريك"], ["pine", "🌲 صنوبر"], ["oak", "🌳 عريضة"], ["palm", "🌴 نخلة"],
    ["bush", "🌿 شجيرة"], ["rock", "🪨 صخرة"], ["crate", "📦 صندوق"], ["erase", "🗑️ حذف"]].forEach(function (t) {
      tools.appendChild(el("button", {
        class: "rs-chip" + (MAP.tool === t[0] ? " on" : "") + (t[0] === "erase" ? " dz" : ""),
        text: t[1], onclick: function () { MAP.tool = t[0]; renderMap(); }
      }));
    });
    s.appendChild(tools);

    var box = el("div", { id: "rs-map" });
    var cv = el("canvas");
    box.appendChild(cv); s.appendChild(box);
    MAP.cv = cv; MAP.ctx = cv.getContext("2d");

    s.appendChild(el("div", { class: "rs-row" }, [
      el("span", { class: "rs-lab", text: "عدد الأشجار" }),
      el("span", { class: "rs-num", id: "rs-tc", text: String((P.map.trees || []).length) }),
      el("button", { class: "rs-chip", text: "🔍+", onclick: function () { zoom(1.3); } }),
      el("button", { class: "rs-chip", text: "🔍−", onclick: function () { zoom(1 / 1.3); } }),
      el("button", { class: "rs-chip", text: "⟳ توسيط", onclick: function () { MAP.view = null; drawMap(); } })
    ]));

    var n = { v: 120 };
    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🌲 توزيع تلقائي" }),
      row("العدد", slider(20, 400, 10, n.v, function (v) { n.v = v; })),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip ok", text: "🌲 وزّع أشجاراً", onclick: function () { scatter(n.v); } }),
        el("button", { class: "rs-chip dz", text: "🧹 امسح كل الأشجار", onclick: function () { P.map.trees = []; MAP.sel = null; persist(); drawMap(); upCount(); } }),
        el("button", {
          class: "rs-chip", text: "📦 استعادة الصناديق الأصلية",
          onclick: function () { P.map.crates = clone(FACTORY.crates); persist(); drawMap(); }
        })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card", id: "rs-msel" }));

    bindMap(box, cv);
    requestAnimationFrame(function () { drawMap(); });
  }

  function upCount() {
    var e2 = document.getElementById("rs-tc");
    if (e2) e2.textContent = String((P.map.trees || []).length);
  }

  function viewOf() {
    if (MAP.view) return MAP.view;
    var p = MAP.poly, mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    p.forEach(function (q) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); });
    var sp = Math.max(mxx - mnx, mxz - mnz) * 1.08;
    MAP.view = { cx: (mnx + mxx) / 2, cz: (mnz + mxz) / 2, span: sp };
    return MAP.view;
  }
  function zoom(k) { var v = viewOf(); v.span = clamp(v.span / k, 30, 6000); drawMap(); }

  function mapK() {
    var v = viewOf(), cv = MAP.cv;
    return Math.min(cv.width, cv.height) / v.span;
  }
  function w2s(x, z) {
    var v = viewOf(), cv = MAP.cv, k = mapK();
    return { x: (x - v.cx) * k + cv.width / 2, y: (z - v.cz) * k + cv.height / 2 };
  }
  function s2w(sx, sy) {
    var v = viewOf(), cv = MAP.cv, k = mapK();
    return { x: (sx - cv.width / 2) / k + v.cx, z: (sy - cv.height / 2) / k + v.cz };
  }

  function drawMap() {
    var cv = MAP.cv; if (!cv) return;
    var r = cv.parentElement.getBoundingClientRect();
    var dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    var g = MAP.ctx;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#08304a"; g.fillRect(0, 0, cv.width, cv.height);

    /* الجزيرة */
    var p = MAP.poly;
    g.beginPath();
    p.forEach(function (q, i) { var s = w2s(q.x, q.z); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
    g.closePath();
    g.fillStyle = "#2c6b34"; g.fill();
    g.strokeStyle = "#d9e86b"; g.lineWidth = 2 * dpr; g.stroke();

    /* الصناديق */
    (P.map.crates || []).forEach(function (c, i) {
      var s = w2s(c.x, c.z);
      var a = 7 * dpr * (c.scale || 1);
      g.fillStyle = "#b07a3a"; g.strokeStyle = "#000"; g.lineWidth = 1.4 * dpr;
      g.fillRect(s.x - a / 2, s.y - a / 2, a, a);
      g.strokeRect(s.x - a / 2, s.y - a / 2, a, a);
      if (MAP.sel && MAP.sel.t === "crate" && MAP.sel.i === i) ring(g, s, a, dpr);
    });

    /* الأشجار */
    (P.map.trees || []).forEach(function (t, i) {
      var s = w2s(t.x, t.z);
      var a = 6 * dpr * (t.scale || 1);
      g.beginPath(); g.arc(s.x, s.y, a, 0, 6.2832);
      g.fillStyle = t.k === "rock" ? "#8d97a5" : t.k === "palm" ? "#3cb35e" : t.k === "bush" ? "#4fbb62" : "#1f7a3d";
      g.fill(); g.strokeStyle = "#06240f"; g.lineWidth = 1.4 * dpr; g.stroke();
      if (MAP.sel && MAP.sel.t === "tree" && MAP.sel.i === i) ring(g, s, a * 2, dpr);
    });
  }
  function ring(g, s, a, dpr) {
    g.beginPath(); g.arc(s.x, s.y, a + 6 * dpr, 0, 6.2832);
    g.strokeStyle = "#ffc21a"; g.lineWidth = 2.5 * dpr; g.stroke();
  }

  function hit(sx, sy) {
    var dpr = Math.min(devicePixelRatio || 1, 2), R = 15 * dpr, i, s, d;
    var trees = P.map.trees || [], crates = P.map.crates || [];
    for (i = trees.length - 1; i >= 0; i--) {
      s = w2s(trees[i].x, trees[i].z);
      d = Math.hypot(s.x - sx, s.y - sy); if (d < R) return { t: "tree", i: i };
    }
    for (i = crates.length - 1; i >= 0; i--) {
      s = w2s(crates[i].x, crates[i].z);
      d = Math.hypot(s.x - sx, s.y - sy); if (d < R) return { t: "crate", i: i };
    }
    return null;
  }

  function bindMap(box, cv) {
    var pts = {}, dragObj = null, panning = null, pinch = null;
    function local(e) {
      var r = cv.getBoundingClientRect();
      var dpr = cv.width / r.width;
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
    }
    box.addEventListener("pointerdown", function (e) {
      e.preventDefault(); box.setPointerCapture(e.pointerId);
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (ids.length === 2) { pinch = { d: dist(pts[ids[0]], pts[ids[1]]), span: viewOf().span }; dragObj = panning = null; return; }
      var l = pts[e.pointerId], h = hit(l.x, l.y);
      if (MAP.tool === "erase") {
        if (h) { (h.t === "tree" ? P.map.trees : P.map.crates).splice(h.i, 1); MAP.sel = null; persist(); drawMap(); upCount(); selPanel(); }
        return;
      }
      if (MAP.tool === "move") {
        if (h) { MAP.sel = h; dragObj = h; drawMap(); selPanel(); }
        else { panning = { x: l.x, y: l.y, cx: viewOf().cx, cz: viewOf().cz }; MAP.sel = null; drawMap(); selPanel(); }
        return;
      }
      /* أدوات الإضافة */
      var w = s2w(l.x, l.y);
      if (!inPoly(w.x, w.z, MAP.poly)) { toast("ضَع العنصر داخل الجزيرة"); return; }
      if (MAP.tool === "crate") {
        P.map.crates = P.map.crates || [];
        P.map.crates.push({ id: "cr_u" + Date.now().toString(36) + Math.floor(Math.random() * 999), x: w.x, y: 0, z: w.z, ry: Math.random() * 6.28, scale: 1 });
        MAP.sel = { t: "crate", i: P.map.crates.length - 1 };
      } else {
        P.map.trees.push({ x: w.x, z: w.z, k: MAP.tool, ry: Math.random() * 6.28, scale: 0.85 + Math.random() * 0.5 });
        MAP.sel = { t: "tree", i: P.map.trees.length - 1 };
      }
      persist(); drawMap(); upCount(); selPanel();
    });
    box.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (pinch && ids.length === 2) {
        var d = dist(pts[ids[0]], pts[ids[1]]);
        viewOf().span = clamp(pinch.span * (pinch.d / Math.max(d, 1)), 30, 6000);
        drawMap(); return;
      }
      var l = pts[e.pointerId];
      if (dragObj) {
        var w = s2w(l.x, l.y);
        var o = (dragObj.t === "tree" ? P.map.trees : P.map.crates)[dragObj.i];
        if (o) { o.x = w.x; o.z = w.z; drawMap(); }
        return;
      }
      if (panning) {
        var v = viewOf(), k = mapK();
        v.cx = panning.cx - (l.x - panning.x) / k;
        v.cz = panning.cz - (l.y - panning.y) / k;
        drawMap();
      }
    });
    function end(e) {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      if (dragObj) { persist(); selPanel(); }
      dragObj = null; panning = null;
    }
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  }

  function selPanel() {
    var box = document.getElementById("rs-msel"); if (!box) return;
    box.innerHTML = "";
    if (!MAP.sel) { box.appendChild(el("div", { class: "rs-hint", text: "لم يتم اختيار عنصر. استخدم أداة «تحريك» واضغط على شجرة أو صندوق." })); return; }
    var isT = MAP.sel.t === "tree";
    var o = (isT ? P.map.trees : P.map.crates)[MAP.sel.i];
    if (!o) { MAP.sel = null; return; }
    box.appendChild(el("h4", { text: isT ? (TREES[o.k] ? TREES[o.k].ico + " " + TREES[o.k].lab : "🌳 شجرة") : "📦 صندوق" }));
    box.appendChild(row("الحجم", slider(0.4, 2.6, 0.05, o.scale || 1, function (v) { o.scale = v; persist(); drawMap(); })));
    box.appendChild(row("الدوران", slider(0, 6.28, 0.05, o.ry || 0, function (v) { o.ry = v; persist(); })));
    if (isT) {
      var kw = el("div", { class: "rs-chips" });
      Object.keys(TREES).forEach(function (k) {
        kw.appendChild(el("button", {
          class: "rs-chip" + (o.k === k ? " on" : ""), text: TREES[k].ico + " " + TREES[k].lab,
          onclick: function () { o.k = k; persist(); drawMap(); selPanel(); }
        }));
      });
      box.appendChild(row("النوع", kw));
    }
    box.appendChild(el("div", { class: "rs-chips" }, [
      el("button", {
        class: "rs-chip dz", text: "🗑️ احذف هذا العنصر",
        onclick: function () { (isT ? P.map.trees : P.map.crates).splice(MAP.sel.i, 1); MAP.sel = null; persist(); drawMap(); upCount(); selPanel(); }
      })
    ]));
  }

  function scatter(n) {
    var poly = MAP.poly, tries = 0, added = 0;
    var kinds = ["pine", "oak", "palm", "bush", "rock"];
    var wts = [0.34, 0.3, 0.12, 0.16, 0.08];
    var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    poly.forEach(function (q) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); });
    var crates = P.map.crates || [];
    while (added < n && tries < n * 60) {
      tries++;
      var x = mnx + Math.random() * (mxx - mnx), z = mnz + Math.random() * (mxz - mnz);
      if (!inPoly(x, z, poly)) continue;
      var ok = true, i;
      for (i = 0; i < crates.length; i++) if (Math.hypot(crates[i].x - x, crates[i].z - z) < 7) { ok = false; break; }
      if (ok) for (i = 0; i < P.map.trees.length; i++) if (Math.hypot(P.map.trees[i].x - x, P.map.trees[i].z - z) < 6) { ok = false; break; }
      if (!ok) continue;
      var r = Math.random(), acc = 0, k = kinds[0];
      for (i = 0; i < kinds.length; i++) { acc += wts[i]; if (r <= acc) { k = kinds[i]; break; } }
      P.map.trees.push({ x: x, z: z, k: k, ry: Math.random() * 6.28, scale: 0.8 + Math.random() * 0.6 });
      added++;
    }
    persist(); drawMap(); upCount();
    toast("تمت إضافة " + added + " شجرة");
  }

  function toast(msg) {
    var t = el("div", {
      text: msg, style: "position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:9999;" +
        "background:rgba(10,6,32,.95);border:1.5px solid rgba(255,255,255,.25);border-radius:12px;" +
        "padding:9px 16px;font-weight:900;font-size:13px;color:#fff;pointer-events:none"
    });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1500);
  }

  /* ============================================================
     4) صفحة اللعب
     ============================================================ */

  function renderPlay() {
    var s = UI.sheet; s.innerHTML = "";

    var card = el("div", { class: "rs-card" }, [
      el("h4", { text: "🧗 منع الصعود فوق الأشياء" }),
      el("div", { class: "rs-hint", text: "الوضع الصارم يجعل الصخور والصناديق والعوائق المنخفضة جُدراناً صلبة: لا تستطيع الصعود فوقها ولا القفز عليها إطلاقاً." })
    ]);
    var cw = el("div", { class: "rs-chips" });
    CLIMB_MODES.forEach(function (m) {
      cw.appendChild(el("button", {
        class: "rs-chip" + (OPT.climb === m[0] ? " on" : ""), text: m[1],
        onclick: function () { OPT.climb = m[0]; if (m[0] === "strict") OPT.stepH = Math.min(OPT.stepH, 0.28); persist(); renderPlay(); }
      }));
    });
    card.appendChild(cw);
    CLIMB_MODES.forEach(function (m) { if (OPT.climb === m[0]) card.appendChild(el("div", { class: "rs-hint", text: "▸ " + m[2] })); });
    card.appendChild(row("ارتفاع الخطوة", slider(0.05, 0.85, 0.01, OPT.stepH, function (v) { OPT.stepH = v; persist(); })));
    card.appendChild(el("div", { class: "rs-hint", text: "كلما قلّ الرقم قلّت قدرة الشخصية على تسلّق الحواف. الافتراضي في اللعبة الأصلية 0.55" }));
    s.appendChild(card);

    var b = el("div", { class: "rs-card" }, [
      el("h4", { text: "🔫 شارة السلاح المحمول" }),
      el("div", { class: "rs-hint", text: "شارة كبيرة تُظهر صورة السلاح الذي تحمله الآن + اسمه + ذخيرته بلونه الخاص. يمكنك سحبها لأي مكان من تبويب «العدّادات»." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.badge.visible ? "ok" : "dz"),
          text: OPT.badge.visible ? "👁️ ظاهرة" : "🚫 مخفية",
          onclick: function () { OPT.badge.visible = !OPT.badge.visible; persist(); renderPlay(); }
        })
      ]),
      row("الحجم", slider(0.6, 2, 0.05, OPT.badge.size || 1, function (v) { OPT.badge.size = v; persist(); }))
    ]);
    s.appendChild(b);

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "💾 الإعدادات" }),
      el("div", { class: "rs-hint", text: "كل ما ترتّبه هنا يُحفظ داخل جهازك ويُطبَّق تلقائياً في كل مرة تفتح فيها اللعبة." }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip dz", text: "↺ استعادة كل الإعدادات الافتراضية", onclick: resetAll })
      ])
    ]));
  }

  /* ============================================================
     5) البدء
     ============================================================ */

  function start() {
    persist();
    UI.root.classList.remove("on");
    var fab = document.getElementById("rs-fab");
    if (!fab) {
      fab = el("div", { id: "rs-fab", text: "⚙️", onclick: function () { reopen(); } });
      document.body.appendChild(fab);
    }
    fab.classList.add("on");
    watchFab();
    if (resolveGo) { var r = resolveGo; resolveGo = null; r(P); }
  }

  function reopen() {
    if (!UI) return;
    document.getElementById("rs-fab").classList.remove("on");
    UI.root.classList.add("on");
    resolveGo = null;
    setTab(tab);
    /* عند الإغلاق: طبّق مباشرة على الواجهة الجارية إن وُجدت */
    var go = UI.root.querySelector("#rs-start");
    go.textContent = "✔️ حفظ وإغلاق";
    go.onclick = function () {
      persist();
      UI.root.classList.remove("on");
      var f = document.getElementById("rs-fab");
      if (f) f.classList.add("on");
      applyLive();
    };
  }

  /* تطبيق فوري على لعبة/واجهة جارية */
  function applyLive() {
    try {
      var rt = window.__runtime, hud = rt && rt.game && rt.game.hud;
      if (hud) { hud.build && rebuildHud(hud); hud.layout && hud.layout(); }
    } catch (e) { console.warn(e); }
  }
  function rebuildHud(hud) {
    var i, w;
    for (i in hud.widgets) {
      w = hud.widgets[i];
      if (w.setIcon) w.setIcon();
      if (w.node) w.node.className = w.node.className.replace(/shape-\S+/, "shape-" + (w.cfg.shape || "round"));
      skinWidget(w.node, w.cfg);
    }
  }

  function watchFab() {
    var fab = document.getElementById("rs-fab");
    if (!fab) return;
    setInterval(function () {
      if (UI && UI.root.classList.contains("on")) { fab.classList.remove("on"); return; }
      var playing = !!document.getElementById("gameroot");
      fab.classList.toggle("on", !playing);
    }, 700);
  }

  window.__ROYAL_SETUP__ = function (project) {
    try { return boot(project); }
    catch (e) { console.error("setup failed", e); return Promise.resolve(project); }
  };

  /* ============================================================
     6) خطّافات داخل اللعبة
     ============================================================ */

  /* ---- 6.1 الحركة ومنع التسلّق ---- */
  var blockStart = 0;

  window.__ROYAL_PASS__ = function (game, x, z, curG, tgtG, step) {
    /* الأشجار عوائق صلبة */
    var blk = game.__treeBlk, i, b, dx, dz;
    if (blk) for (i = 0; i < blk.length; i++) {
      b = blk[i]; dx = x - b.x; dz = z - b.z;
      if (dx * dx + dz * dz < b.r2) { return blocked(); }
    }
    var Q = game.Q;
    if (Q.isBlocked(x, z)) return blocked();

    if (OPT.climb !== "free") {
      var f = Q.heightAt(x, z), rf = Q.roofAt(x, z), gap = rf - f;
      var lo = OPT.climb === "strict" ? 0.3 : 0.62;
      var hi = OPT.climb === "strict" ? 2.35 : 1.85;
      if (gap > lo && gap < hi) {
        var py = game.pos ? game.pos.y : 0;
        var onTop = game.grounded && py >= rf - 0.3;
        if (!onTop) return blocked();
      }
    }
    if (tgtG - curG > step) return blocked();
    blockStart = 0;
    return true;
  };

  /* صمّام أمان: لو عَلِقَ اللاعب تماماً أكثر من ثانيتين ونصف نُرخي المنع مؤقتاً */
  function blocked() {
    var now = performance.now();
    if (!blockStart) { blockStart = now; return false; }
    if (now - blockStart > 2500) { blockStart = now - 1200; return true; }
    return false;
  }

  /* ---- 6.2 بناء الأشجار داخل العالم ---- */
  window.__ROYAL_WORLD__ = function (game) {
    try { buildTrees(game); } catch (e) { console.warn("trees build failed", e); }
  };

  function geo(T, d) {
    if (d[0] === "cyl") return new T.Cyl(d[1], d[2], d[3], d[4] || 8, 1);
    return new T.Ico(d[1], d[2] || 0);
  }

  function buildTrees(game) {
    var T = window.__ROYAL_THREE__;
    game.__treeBlk = [];
    var list = (game.P && game.P.map && game.P.map.trees) || [];
    if (!T || !list.length) return;
    var Q = game.Q, byKind = {}, i, t;

    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (!TREES[t.k]) continue;
      if (Q.isLand && !Q.isLand(t.x, t.z)) continue;
      var y = Q.heightAt(t.x, t.z);
      if (game.an && y < game.an.waterY + 0.2) continue;
      (byKind[t.k] || (byKind[t.k] = [])).push({ x: t.x, y: y, z: t.z, ry: t.ry || 0, s: t.scale || 1 });
      var rr = TREES[t.k].r * (t.scale || 1);
      game.__treeBlk.push({ x: t.x, z: t.z, r2: rr * rr });
    }

    var group = new T.Group();
    group.name = "royal-trees";
    var m4 = new T.Mat4(), lm = new T.Mat4(), q = new T.Quat(), v = new T.V3(), sc = new T.V3(), col = new T.Color();

    Object.keys(byKind).forEach(function (k) {
      var arr = byKind[k], def = TREES[k];
      def.parts.forEach(function (part) {
        var g = geo(T, part.g);
        var mat = new T.Std({ color: 0xffffff, roughness: 0.92, metalness: 0.02, flatShading: true });
        var inst = new T.Inst(g, mat, arr.length);
        inst.castShadow = true; inst.receiveShadow = true;
        /* مصفوفة الجزء المحلية */
        lm.identity();
        var pq = new T.Quat();
        var lp = new T.V3(part.p[0], part.p[1], part.p[2]);
        var ls = new T.V3(part.s ? part.s[0] : 1, part.s ? part.s[1] : 1, part.s ? part.s[2] : 1);
        if (part.r) {
          var qx = new T.Quat().setFromAxisAngle(new T.V3(1, 0, 0), part.r[0]);
          var qy = new T.Quat().setFromAxisAngle(new T.V3(0, 1, 0), part.r[1]);
          var qz = new T.Quat().setFromAxisAngle(new T.V3(0, 0, 1), part.r[2]);
          pq.copy(qy).multiply(qx).multiply(qz);
        }
        lm.compose(lp, pq, ls);

        for (var j = 0; j < arr.length; j++) {
          var a = arr[j];
          q.setFromAxisAngle(new T.V3(0, 1, 0), a.ry);
          m4.compose(v.set(a.x, a.y, a.z), q, sc.set(a.s, a.s, a.s));
          m4.multiply(lm);
          inst.setMatrixAt(j, m4);
          var jit = 0.86 + ((j * 2654435761) % 100) / 340;
          col.setHex(part.c).multiplyScalar(jit);
          inst.setColorAt(j, col);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        group.add(inst);
      });
    });
    game.scene.add(group);
    game.__treeGroup = group;
  }

  /* ---- 6.3 شارة السلاح + تلوين الخانات ---- */
  function badgeEl(hud) {
    if (hud.__rw && hud.__rw.isConnected) return hud.__rw;
    var n = el("div", { id: "rw-weapon" }, [
      el("div", { class: "ic" }),
      el("div", { class: "tx" }, [el("b"), el("span"), el("u")])
    ]);
    hud.node.appendChild(n);
    hud.__rw = n;
    return n;
  }

  function placeBadge(hud) {
    var n = hud.__rw; if (!n) return;
    var w = hud.node.clientWidth || innerWidth, h = hud.node.clientHeight || innerHeight;
    n.style.left = (OPT.badge.x * w) + "px";
    n.style.top = (OPT.badge.y * h) + "px";
    n.style.transform = "translate(-50%,-50%) scale(" + (OPT.badge.size || 1) + ")";
  }

  window.__ROYAL_WEAP__ = function (hud, slots, active) {
    try {
      /* لون كل خانة */
      var nodes = hud.ammoBox.querySelectorAll(".wslot");
      for (var i = 0; i < nodes.length; i++) {
        var it = slots[i];
        nodes[i].style.setProperty("--wcol", it ? (it.def.color || AMMO_COL[it.def.ammo] || "#ffc21a") : "rgba(255,255,255,.2)");
      }
      var n = badgeEl(hud);
      placeBadge(hud);
      var cur = slots[active];
      if (!cur || !OPT.badge.visible) { n.classList.remove("on"); return; }
      var d = cur.def, col = d.color || AMMO_COL[d.ammo] || "#ffc21a";
      n.style.setProperty("--wcol", col);
      var ic = n.querySelector(".ic");
      ic.innerHTML = "";
      var thumb = isUrl(d.icon) ? d.icon : (hud.thumbs && hud.thumbs[d.id]);
      if (thumb) ic.appendChild(el("img", { src: thumb, alt: "" }));
      else ic.appendChild(document.createTextNode(d.emo || "🔫"));
      n.querySelector("b").textContent = d.name;
      n.querySelector("u").textContent = (d.short ? d.short + " • " : "") + (AMMO_LAB[d.ammo] || d.ammo);
      n.classList.add("on");
      hud.__rwDef = d;
    } catch (e) { console.warn("weapon badge", e); }
  };

  window.__ROYAL_AMMO__ = function (hud, info) {
    try {
      if (!hud.__rw || !info) return;
      hud.__rw.querySelector("span").textContent = info.mag + " / " + info.res;
      hud.__rw.classList.toggle("low", info.mag === 0);
    } catch (e) { }
  };

  window.__ROYAL_HUDL__ = function (hud) { try { placeBadge(hud); } catch (e) { } };

  /* ---- 6.4 شاشة تحميل مبكّرة ---- */
  function bootSplash() {
    if (document.getElementById("rs-boot")) return;
    var n = el("div", { id: "rs-boot" }, [
      el("div", { class: "bx" }, [
        el("div", { class: "k", text: "👑" }),
        el("div", { class: "t", text: "بطل رويال" }),
        el("div", { class: "s", text: "جارٍ فتح ملف اللعبة…" }),
        el("div", { class: "b" }, [el("i")])
      ])
    ]);
    document.body.appendChild(n);
    var p = 8;
    var iv = setInterval(function () {
      p = Math.min(92, p + Math.random() * 7);
      var b = n.querySelector(".b>i"); if (b) b.style.width = p + "%";
      if (!n.isConnected) clearInterval(iv);
    }, 320);
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", bootSplash);
  else bootSplash();
})();
