/* ============================================================
   بطل رويال — لوحة الإعداد + محرّر البناء ثلاثي الأبعاد
   ------------------------------------------------------------
   خطّافات المحرّك:
     window.__ROYAL_SETUP__(project) -> Promise<project>
     window.__ROYAL_OPT__            إعدادات حيّة
     window.__ROYAL_PASS__(game,x,z,curG,tgtG,step) -> bool
     window.__ROYAL_WATEROK__()      السماح بالماء الداخلي
     window.__ROYAL_WORLD__(game)    بعد بناء الخريطة والصناديق
     window.__ROYAL_READY__(game)    بعد اكتمال كل شيء (HUD/بوتات)
     window.__ROYAL_STICK__(hud,cfg,phase) تثبيت التصويب
     window.__ROYAL_WEAP__ / __ROYAL_AMMO__ / __ROYAL_HUDL__ / __ROYAL_SKIN__
   ============================================================ */
(function () {
  "use strict";

  var LS = "royal-setup-v3";

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

  var EMOJI = {
    move: ["🕹️", "🎮", "🧭", "👟", "🔘", "⚪"],
    aim: ["🎯", "👁️", "🔭", "🧿", "➕", "🔴"],
    shoot: ["🔫", "💥", "🔥", "⚡", "💢", "🩸", "☄️", "🎇", "❌", "🟥"],
    jump: ["⬆️", "🔼", "🆙", "🦘", "🕴️", "☝️", "⤴️", "🚀", "🐇", "🪂"],
    run: ["🏃", "💨", "👟", "⚡", "🌀", "🔥", "🐆"],
    crouch: ["⬇️", "🔽", "🧎", "🦆", "⤵️", "👇"],
    open: ["📦", "🎁", "🧰", "🗃️", "🔓", "📤", "💼"],
    pickup: ["✋", "🤏", "🫳", "👐", "🖐️", "🤲", "🧲"],
    reload: ["🔄", "🔃", "♻️", "🔁", "🧨", "⏳", "🔋"],
    emote: ["😀", "😎", "😂", "👍", "🎉", "👋"],
    view: ["👁️", "🎥", "🔄", "🧍", "📷", "👀"],
    swap: ["🔁", "🔄", "🗡️", "🔫", "↔️", "⚔️"],
    bag: ["🎒", "🧳", "👜", "📋", "🧰", "🛍️"],
    drop: ["🗑️", "⬇️", "📤", "🫳", "❎", "🚮"],
    scope: ["🔭", "🔍", "🎯", "👁️", "🔬", "📡"],
    kills: ["💀", "☠️", "⚔️", "🩸", "🎯", "🔥"],
    rank: ["🏆", "🥇", "👑", "⭐", "📊", "💎"],
    alive: ["👥", "🧍", "❤️", "🫂", "👤", "🟢"],
    hp: ["❤️", "💚", "🩹", "🛡️", "➕", "🫀"],
    minimap: ["🗺️", "🧭", "📍", "🌍", "🛰️", "🏝️"],
    zone: ["⏱️", "⏳", "🌀", "⚠️", "🔵", "☢️"]
  };
  var EMOJI_ALL = ("⬆️ ⬇️ ⬅️ ➡️ 🔼 🔽 ◀️ ▶️ 🆙 ⤴️ ⤵️ ↔️ 🔄 🔁 🔃 ♻️ ➕ ➖ ✖️ ❌ ✅ ⭕ 🔘 ⚪ ⚫ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 " +
    "🟥 🟧 🟨 🟩 🟦 🟪 🔺 🔻 🔷 🔶 💠 🔳 🔲 🕹️ 🎮 🎯 🔫 💣 🧨 ⚔️ 🗡️ 🏹 🛡️ 💥 🔥 ⚡ 💨 ☄️ 🌀 " +
    "💀 ☠️ 👻 👾 🤖 🦾 👊 ✋ 🤚 🖐️ 👌 🤏 🤲 👐 🫳 ☝️ 👇 👆 👍 👎 🦵 🦶 👟 👣 🏃 🚶 🧎 🕴️ 🦘 🐇 🦅 " +
    "❤️ 💚 💙 💛 🧡 💜 🖤 🤍 🩹 🩸 🫀 🧪 💊 🛠️ 🧰 🔧 ⚙️ 🔋 📦 🎁 🗃️ 💼 🎒 🧳 👜 🗑️ 🚮 " +
    "👁️ 👀 🔭 🔬 🔍 🧿 📷 🎥 📡 🛰️ 🗺️ 🧭 📍 📌 🌍 🏝️ ⏱️ ⏳ ⌛ ⏰ 🏆 🥇 👑 ⭐ 💎 🎖️ 🏅 📊 " +
    "😀 😎 😂 🥳 😡 🤝 👋 🎉 🪂 🎈 🚀 🧲 🔒 🔓 🔑 ⚠️ ☢️ 🌊 🔆").split(/\s+/);

  /* ------------------------------------------------------- أدوات */

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
  function toast(msg, ms) {
    var t = el("div", {
      class: "rs-toast", text: msg,
      style: "position:fixed;left:50%;top:13%;transform:translateX(-50%);z-index:9999;" +
        "background:rgba(10,6,32,.95);border:1.5px solid rgba(255,255,255,.25);border-radius:12px;" +
        "padding:9px 16px;font-weight:900;font-size:13px;color:#fff;pointer-events:none;direction:rtl"
    });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 1600);
  }

  /* ------------------------------------------------- التخزين */

  /* الإعدادات المدمجة داخل الملف (تُكتَب عند «حمّل اللعبة النهائية») */
  var BAKED = (function () {
    try {
      var n = document.getElementById("royal-prefs");
      return n ? JSON.parse(n.textContent || "null") : null;
    } catch (e) { return null; }
  })();
  var LOCKED = !!(BAKED && BAKED.locked);

  var SAVED = null;
  function load() {
    if (SAVED) return SAVED;
    if (LOCKED) { SAVED = JSON.parse(JSON.stringify(BAKED)); SAVED.myIcons = SAVED.myIcons || []; return SAVED; }
    try { SAVED = JSON.parse(localStorage.getItem(LS) || "null") || null; }
    catch (e) { SAVED = null; }
    if (!SAVED && BAKED) SAVED = JSON.parse(JSON.stringify(BAKED));
    if (!SAVED) SAVED = {};
    if (!SAVED.myIcons) SAVED.myIcons = [];
    return SAVED;
  }
  function save() {
    if (LOCKED) return;
    try { localStorage.setItem(LS, JSON.stringify(SAVED)); }
    catch (e) { console.warn("setup save failed", e); toast("تعذّر الحفظ — مساحة التخزين ممتلئة"); }
  }

  function playerName(v) {
    if (v !== undefined) { try { localStorage.setItem("royal-player-name", v); } catch (e) { } return v; }
    try { return localStorage.getItem("royal-player-name") || ""; } catch (e) { return ""; }
  }
  function wipe() { SAVED = null; try { localStorage.removeItem(LS); } catch (e) { } load(); }

  /* --------------------------------------------- إعدادات اللعب */

  var OPT = {
    climb: "strict",     /* free | soft | strict */
    stepH: 0.28,
    doorStep: 0.75,      /* تسامح الخطوة عند مداخل المباني */
    doorFix: true,       /* لا يقفز فوق سطح البيت عند محاولة الدخول */
    freeWater: true,     /* السماح بدخول الأودية والماء الداخلي */
    stickyAim: true,     /* التصويب يبقى مثبّتاً حتى تضغط ثانيةً */
    faceMove: true,      /* الشخصية تنظر لجهة حركتها */
    botLOS: true,        /* الأعداء لا يطلقون عبر الجدران */
    ambient: 0.55,       /* مستوى صوت الخلفية */
    ocean: true,         /* بحر واقعي */
    trophies: false,     /* إظهار الكؤوس والعملات في الواجهة */
    slimHud: true,       /* خانتا سلاح فقط بلا صندوق ثالث ولا شارة علوية */
    build: false,        /* وضع محرّر البناء */
    badge: { x: 0.5, y: 0.19, size: 0.85, visible: false }
  };
  window.__ROYAL_OPT__ = OPT;

  var CLIMB_MODES = [
    ["free", "حر", "يصعد فوق كل شيء (الوضع الأصلي)"],
    ["soft", "متوسط", "يمنع الصعود على الأشياء المتوسطة"],
    ["strict", "صارم", "لا يصعد فوق أي شيء نهائياً"]
  ];

  /* ============================================================
     1) لوحة الإعداد
     ============================================================ */

  var P = null, FACTORY = null, UI = null, resolveGo = null;
  var tab = "btn", sel = null, grid = true;

  function boot(project) {
    P = project;
    if (!P.map) P.map = {};
    delete P.map.trees;
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
      /* النسخة النهائية للاعبين: لا لوحة إعداد — اسم اللاعب ثم اللعب مباشرةً */
      if (LOCKED) {
        askName(function () { var b = document.getElementById("rs-boot"); if (b) b.remove(); res(P); });
        return;
      }
      buildUI();
      show(true);
      if (load().wantBuild) { SAVED.wantBuild = false; save(); setTab("crate"); toast("تم حفظ الصناديق ✔", 2400); }
    });
  }

  /* ------------------------------------------- اسم اللاعب أول مرّة */
  function askName(done) {
    var cur = playerName();
    if (cur) { P.player.name = cur; done(); return; }
    var b = document.getElementById("rs-boot"); if (b) b.remove();
    var inp = el("input", {
      id: "rn-inp", type: "text", maxlength: "16", placeholder: "اكتب اسمك هنا",
      value: (P.player && P.player.name) || ""
    });
    var go = el("button", {
      id: "rn-go", text: "▶️ ابدأ",
      onclick: function () {
        var v = (inp.value || "").trim().slice(0, 16);
        if (!v) { inp.focus(); toast("اكتب اسمك أولاً"); return; }
        playerName(v); P.player.name = v;
        box.remove(); done();
      }
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    var box = el("div", { id: "rname" }, [
      el("div", { class: "bx" }, [
        el("div", { class: "k", text: "👑" }),
        el("div", { class: "t", text: "أهلاً بك في بطل رويال" }),
        el("div", { class: "s", text: "ما اسمك أيها البطل؟" }),
        inp, go
      ])
    ]);
    document.body.appendChild(box);
    setTimeout(function () { try { inp.focus(); } catch (e) { } }, 120);
  }

  function applySaved() {
    var s = load(), i, j, f, k;
    if (s.opt) for (k in s.opt) {
      if (k === "badge") { for (j in s.opt.badge) OPT.badge[j] = s.opt.badge[j]; }
      else if (k in OPT) OPT[k] = s.opt[k];
    }
    OPT.build = false;
    if (s.layout) for (i = 0; i < P.controls.layout.length; i++) {
      f = s.layout[P.controls.layout[i].id];
      if (f) for (j in f) if (f[j] !== undefined) P.controls.layout[i][j] = f[j];
    }
    if (s.stats) for (i = 0; i < P.controls.stats.length; i++) {
      f = s.stats[P.controls.stats[i].id];
      if (f) for (j in f) if (f[j] !== undefined) P.controls.stats[i][j] = f[j];
    }
    if (typeof s.scale === "number") P.controls.scale = s.scale;
    for (i = 0; i < P.weapons.length; i++) {
      var w = P.weapons[i];
      if (!w.color) w.color = AMMO_COL[w.ammo] || "#ffc21a";
      f = s.weapons && s.weapons[w.id];
      if (f) { if (f.emo) w.emo = f.emo; if (f.icon) w.icon = f.icon; if (f.color) w.color = f.color; }
    }
    if (Array.isArray(s.crates) && s.crates.length) P.map.crates = clone(s.crates);
  }

  function persist() {
    var s = load(), i, w;
    s.layout = {}; s.stats = {};
    for (i = 0; i < P.controls.layout.length; i++) {
      var c = P.controls.layout[i];
      s.layout[c.id] = { x: c.x, y: c.y, size: c.size, wk: c.wk, hk: c.hk, shape: c.shape, emoji: c.emoji, icon: c.icon, opacity: c.opacity, visible: c.visible, color: c.color };
    }
    for (i = 0; i < P.controls.stats.length; i++) {
      var t = P.controls.stats[i];
      s.stats[t.id] = { x: t.x, y: t.y, size: t.size, emoji: t.emoji, icon: t.icon, visible: t.visible, zoom: t.zoom };
    }
    s.scale = P.controls.scale;
    s.weapons = {};
    for (i = 0; i < P.weapons.length; i++) { w = P.weapons[i]; s.weapons[w.id] = { emo: w.emo, icon: w.icon, color: w.color }; }
    s.crates = P.map.crates;
    s.opt = {
      climb: OPT.climb, stepH: OPT.stepH, doorStep: OPT.doorStep, doorFix: OPT.doorFix,
      freeWater: OPT.freeWater, stickyAim: OPT.stickyAim, faceMove: OPT.faceMove,
      botLOS: OPT.botLOS, ambient: OPT.ambient, ocean: OPT.ocean,
      trophies: OPT.trophies, slimHud: OPT.slimHud, badge: OPT.badge
    };
    SAVED = s; save();
  }

  /* ------------------------------------------------------ الواجهة */

  function buildUI() {
    if (UI) return;
    var root = el("div", { id: "rsetup" });
    var stage = el("div", { id: "rs-stage" });
    var eye = el("button", { id: "rs-eye", text: "👁️", title: "إخفاء الأدوات", onclick: function () { setBare(true); } });
    var back = el("button", { id: "rs-back", text: "🛠️ إظهار الأدوات", onclick: function () { setBare(false); } });
    var top = el("div", { id: "rs-top" }, [
      el("div", { id: "rs-tabs" }), eye,
      el("button", { id: "rs-reset", title: "استعادة الافتراضي", onclick: resetAll, text: "↺" }),
      el("button", { id: "rs-start", onclick: start, text: "▶️ ابدأ اللعبة" })
    ]);
    var sheet = el("div", { id: "rs-sheet" });
    var panel = el("div", { id: "rs-panel" }, [
      el("div", { id: "rs-grip" }, [el("b"), el("span", { id: "rs-ptitle", text: "اضغط على أي زر لتعديله" }), el("i", { text: "▴" })]),
      el("div", { id: "rs-pbody" })
    ]);
    root.appendChild(stage); root.appendChild(top); root.appendChild(sheet);
    root.appendChild(panel); root.appendChild(back);
    document.body.appendChild(root);

    UI = {
      root: root, stage: stage, tabs: top.querySelector("#rs-tabs"), sheet: sheet,
      panel: panel, pbody: panel.querySelector("#rs-pbody"),
      ptitle: panel.querySelector("#rs-ptitle"), grip: panel.querySelector("#rs-grip")
    };

    stage.addEventListener("pointerdown", function () {
      if (root.classList.contains("bare")) { setBare(false); return; }
      if (sel) { sel = null; renderPanel(); renderStage(); openPanel(false); }
    });
    UI.grip.onclick = function () { openPanel(panel.classList.contains("min")); };
    panel.classList.add("min");

    [["btn", "🎮 الأزرار"], ["stat", "📊 العدّادات"], ["weap", "🔫 الأسلحة"],
    ["crate", "📦 الصناديق"], ["play", "⚙️ اللعب"]].forEach(function (t) {
      UI.tabs.appendChild(el("button", { class: "rs-tab", "data-t": t[0], text: t[1], onclick: function () { setTab(t[0]); } }));
    });
    addEventListener("resize", function () { if (UI && UI.root.classList.contains("on")) renderStage(); });
    setTab("btn");
  }

  function openPanel(on) {
    UI.panel.classList.toggle("min", !on);
    UI.grip.querySelector("i").textContent = on ? "▾" : "▴";
  }
  function setBare(on) {
    UI.root.classList.toggle("bare", !!on);
    if (on) toast("اضغط على أي مكان فارغ لإظهار الأدوات");
  }
  function show(on) {
    UI.root.classList.toggle("on", !!on);
    var b = document.getElementById("rs-boot"); if (b) b.remove();
    if (on) setTab(tab);
  }
  function setTab(t) {
    tab = t; sel = null; setBare(false);
    var i, ts = UI.tabs.children;
    for (i = 0; i < ts.length; i++) ts[i].classList.toggle("on", ts[i].getAttribute("data-t") === t);
    var stageTab = (t === "btn" || t === "stat");
    UI.sheet.classList.toggle("on", !stageTab);
    UI.panel.style.display = stageTab ? "" : "none";
    UI.stage.style.display = stageTab ? "" : "none";
    if (stageTab) { renderStage(); renderPanel(); openPanel(false); }
    else if (t === "weap") renderWeapons();
    else if (t === "crate") renderCrates();
    else renderPlay();
  }

  /* -------------------------------------------- معاينة الشاشة */

  function stageSize() { return { w: UI.stage.clientWidth || innerWidth, h: UI.stage.clientHeight || innerHeight }; }
  function hudScale() { return (stageSize().h / 720) * (P.controls.scale || 1); }

  function renderStage() {
    if (!UI) return;
    UI.stage.innerHTML = "";
    UI.stage.classList.toggle("grid-off", !grid);
    var s = stageSize(), k = hudScale(), i;
    if (tab === "btn") for (i = 0; i < P.controls.layout.length; i++) mkWidget(P.controls.layout[i], s, k);
    else { for (i = 0; i < P.controls.stats.length; i++) mkStat(P.controls.stats[i], s, k); mkBadge(s); }
  }

  function mkWidget(cfg, s, k) {
    var stick = (cfg.id === "move" || cfg.id === "aim"), node;
    if (stick) node = el("div", { class: "stick rs-w" }, [el("div", { class: "knob" })]);
    else {
      node = el("div", { class: "gw rs-w shape-" + (cfg.shape || "round") }, [el("div", { class: "body" }, [iconNode(cfg)])]);
      skinWidget(node, cfg);
    }
    var a = (cfg.size || 60) * k, W = a * (cfg.wk || 1), H = a * (cfg.hk || 1);
    node.style.position = "absolute";
    node.style.width = W + "px"; node.style.height = H + "px";
    node.style.left = (cfg.x * s.w - W / 2) + "px";
    node.style.top = (cfg.y * s.h - H / 2) + "px";
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

  function mkBadge(s) {
    var w = P.weapons[2] || P.weapons[0], col = w.color || "#ffc21a";
    var node = el("div", { class: "rs-w", style: "position:absolute;pointer-events:auto;display:flex;align-items:center;gap:9px;padding:6px 12px 6px 8px;border-radius:15px;direction:rtl;background:linear-gradient(180deg,rgba(10,6,32,.9),rgba(10,6,32,.66));border:2px solid " + col + ";box-shadow:0 6px 18px rgba(0,0,0,.55)" });
    var ic = el("div", { style: "flex:0 0 auto;width:52px;height:52px;border-radius:12px;display:grid;place-items:center;font-size:31px;background:rgba(0,0,0,.4);border:1.5px solid " + col + ";overflow:hidden" });
    ic.appendChild(isUrl(w.icon) ? el("img", { src: w.icon, style: "width:100%;height:100%;object-fit:contain" }) : document.createTextNode(w.emo || "🔫"));
    node.appendChild(ic);
    node.appendChild(el("div", {}, [
      el("b", { style: "display:block;font-size:14px;font-weight:900;color:" + col, text: w.name }),
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

  function skinWidget(node, cfg) {
    var body = node.querySelector ? node.querySelector(".body") : null;
    if (!body) return;
    var c = cfg && cfg.color;
    if (c && c.toLowerCase() !== "#ffffff") {
      body.style.background = "radial-gradient(circle at 35% 30%," + hexA(c, 0.62) + "," + hexA(c, 0.18) + ")";
      body.style.borderColor = hexA(c, 0.9);
      body.style.boxShadow = "0 4px 14px rgba(0,0,0,.5),0 0 15px -3px " + c;
    } else { body.style.background = ""; body.style.borderColor = ""; body.style.boxShadow = ""; }
  }
  window.__ROYAL_SKIN__ = skinWidget;

  /* ------------------------------------------------------ السحب */

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
      if (st.moved > 6) UI.root.classList.add("drag");
      cfg.x = clamp(st.x + dx / s.w, 0.02, 0.98);
      cfg.y = clamp(st.y + dy / s.h, 0.02, 0.98);
      var W = parseFloat(node.style.width) || 0, H = parseFloat(node.style.height) || 0;
      if (type === "btn" || (type === "stat" && cfg.id === "minimap")) {
        node.style.left = (cfg.x * s.w - W / 2) + "px";
        node.style.top = (cfg.y * s.h - H / 2) + "px";
      } else {
        node.style.left = (cfg.x * s.w) + "px";
        node.style.top = (cfg.y * s.h) + "px";
      }
    });
    function up() { UI.root.classList.remove("drag"); if (st) { st = null; persist(); } }
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function select(type, id) {
    sel = { type: type, id: id };
    renderPanel(); openPanel(true); renderStage();
  }

  /* --------------------------------------------- لوحة التعديل */

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

    b.appendChild(el("div", { class: "rs-row" }, [
      el("span", { class: "rs-lab", text: "حجم الكل" }),
      slider(0.6, 1.6, 0.05, P.controls.scale || 1, function (v) { P.controls.scale = v; persist(); renderStage(); }),
      el("button", { class: "rs-chip" + (grid ? " on" : ""), text: "▦", title: "الشبكة", onclick: function (e) { grid = !grid; e.target.classList.toggle("on", grid); UI.stage.classList.toggle("grid-off", !grid); } })
    ]));

    if (!cfg) {
      UI.ptitle.textContent = tab === "btn" ? "اضغط على أي زر لتعديله" : "اضغط على أي عدّاد لتعديله";
      b.appendChild(el("div", { class: "rs-hint", text: "اسحب العنصر بإصبعك لتغيير مكانه، أو اضغط عليه لفتح خياراته." }));
      var q = el("div", { class: "rs-chips" });
      (tab === "btn" ? P.controls.layout : P.controls.stats).forEach(function (c) {
        q.appendChild(el("button", { class: "rs-chip", text: (isUrl(c.icon) ? "🖼️" : (c.emoji || "•")) + " " + ((tab === "btn" ? BTN : STAT)[c.id] || c.id), onclick: function () { select(tab, c.id); } }));
      });
      if (tab === "stat") q.appendChild(el("button", { class: "rs-chip", text: "🔫 شارة السلاح المحمول", onclick: function () { select("badge", "badge"); } }));
      b.appendChild(q);
      return;
    }

    var name = sel.type === "badge" ? "شارة السلاح المحمول" : (sel.type === "btn" ? BTN : STAT)[cfg.id] || cfg.id;
    UI.ptitle.textContent = "✏️ " + name;

    b.appendChild(el("div", { class: "rs-row" }, [
      el("button", { class: "rs-chip " + (cfg.visible ? "ok" : "dz"), text: cfg.visible ? "👁️ ظاهر" : "🚫 مخفي", onclick: function () { cfg.visible = !cfg.visible; persist(); renderPanel(); renderStage(); } }),
      el("button", { class: "rs-chip", text: "↺ افتراضي", onclick: resetOne }),
      el("button", { class: "rs-chip", text: "✔️ تم", onclick: function () { sel = null; renderPanel(); renderStage(); openPanel(false); } })
    ]));

    if (sel.type === "badge") {
      b.appendChild(row("الحجم", slider(0.6, 2, 0.05, cfg.size || 1, function (v) { cfg.size = v; persist(); renderStage(); })));
    } else if (sel.type === "btn") {
      b.appendChild(row("الحجم", slider(40, 260, 2, cfg.size || 60, function (v) { cfg.size = v; persist(); renderStage(); })));
      b.appendChild(row("العرض", slider(0.4, 2.5, 0.05, cfg.wk || 1, function (v) { cfg.wk = v; persist(); renderStage(); })));
      b.appendChild(row("الطول", slider(0.4, 2.5, 0.05, cfg.hk || 1, function (v) { cfg.hk = v; persist(); renderStage(); })));
      b.appendChild(row("الشفافية", slider(0.25, 1, 0.02, cfg.opacity == null ? 0.92 : cfg.opacity, function (v) { cfg.opacity = v; persist(); renderStage(); })));
    } else if (cfg.id === "minimap") {
      b.appendChild(row("الحجم", slider(90, 320, 5, cfg.size || 155, function (v) { cfg.size = v; persist(); renderStage(); })));
      b.appendChild(row("التقريب", slider(0.5, 3, 0.1, cfg.zoom || 1, function (v) { cfg.zoom = v; persist(); })));
    } else {
      b.appendChild(row("الحجم", slider(0.6, 2.4, 0.05, cfg.size || 1, function (v) { cfg.size = v; persist(); renderStage(); })));
    }

    b.appendChild(row("تحريك دقيق", nudge(cfg)));

    if (sel.type === "btn" && cfg.id !== "move" && cfg.id !== "aim") {
      var sh = el("div", { class: "rs-chips" });
      SHAPES.forEach(function (s2) {
        sh.appendChild(el("button", { class: "rs-chip" + ((cfg.shape || "round") === s2[0] ? " on" : ""), text: s2[2] + " " + s2[1], onclick: function () { cfg.shape = s2[0]; persist(); renderPanel(); renderStage(); } }));
      });
      b.appendChild(row("الشكل", sh));
    }

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

    if (sel.type !== "badge") b.appendChild(iconSection(cfg, function () { persist(); renderPanel(); renderStage(); }));
  }

  /* قسم الأيقونة — صورك أنت أولاً، ثم الرموز الجاهزة */
  function iconSection(cfg, onChange) {
    var box = el("div", {});
    box.appendChild(el("h4", { class: "rs-h4", text: "🖼️ أيقونتك الخاصة" }));
    box.appendChild(el("div", { class: "rs-hint", text: "ارفع أي صورة من جهازك (PNG بخلفية شفافة أفضل). تُحفظ في مكتبتك لتستعملها لأي زر آخر." }));
    box.appendChild(el("div", { class: "rs-row" }, [
      upload("📁 ارفع صورة من جهازك", function (url) { cfg.icon = url; addMyIcon(url); onChange(); }, true),
      isUrl(cfg.icon) ? el("button", { class: "rs-chip dz", text: "🗑️ أزل الصورة", onclick: function () { cfg.icon = null; onChange(); } }) : null
    ]));

    var mine = load().myIcons || [];
    if (mine.length) {
      box.appendChild(el("div", { class: "rs-lab", text: "مكتبتي (" + mine.length + ") — ضغطة مطوّلة للحذف" }));
      var g = el("div", { class: "rs-emo mine" });
      mine.forEach(function (u, i) {
        var n = el("b", { class: cfg.icon === u ? "on" : "" }, [el("img", { src: u })]);
        var tm = null;
        n.onclick = function () { if (!n.__long) { cfg.icon = u; onChange(); } n.__long = false; };
        n.oncontextmenu = function (e) { e.preventDefault(); delMyIcon(i); onChange(); };
        n.addEventListener("pointerdown", function () { tm = setTimeout(function () { n.__long = true; delMyIcon(i); onChange(); }, 650); });
        ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { n.addEventListener(ev, function () { clearTimeout(tm); }); });
        g.appendChild(n);
      });
      box.appendChild(g);
    }

    box.appendChild(el("h4", { class: "rs-h4", text: "😀 أو اختر رمزاً جاهزاً" }));
    var pool = (EMOJI[cfg.id] || []).concat(EMOJI_ALL), seen = {}, list = [];
    pool.forEach(function (e2) { if (!seen[e2]) { seen[e2] = 1; list.push(e2); } });
    var grid2 = el("div", { class: "rs-emo" });
    list.forEach(function (e2) {
      var n = el("b", { text: e2 });
      if (!isUrl(cfg.icon) && cfg.emoji === e2) n.classList.add("on");
      n.onclick = function () { cfg.emoji = e2; cfg.icon = null; onChange(); };
      grid2.appendChild(n);
    });
    box.appendChild(grid2);
    return box;
  }

  function addMyIcon(url) {
    var s = load();
    if (s.myIcons.indexOf(url) < 0) { s.myIcons.unshift(url); if (s.myIcons.length > 40) s.myIcons.length = 40; }
    SAVED = s; save();
  }
  function delMyIcon(i) { var s = load(); s.myIcons.splice(i, 1); SAVED = s; save(); toast("حُذفت من المكتبة"); }

  function row(lab, node) { return el("div", { class: "rs-row" }, [el("span", { class: "rs-lab", text: lab }), node]); }

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
          cfg.x = clamp(cfg.x + d[1], 0.02, 0.98); cfg.y = clamp(cfg.y + d[2], 0.02, 0.98);
          persist(); renderStage();
        }
      }));
    });
    return w;
  }

  function upload(label, cb, big) {
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
          toast("تمت إضافة الأيقونة ✔");
        };
        img.onerror = function () { toast("تعذّر قراءة الصورة"); };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
      inp.value = "";
    };
    return el("span", {}, [
      el("button", { class: "rs-chip" + (big ? " ok big" : ""), text: label, onclick: function () { inp.click(); } }),
      inp
    ]);
  }

  function resetOne() {
    var cfg = curCfg(); if (!cfg) return;
    if (sel.type === "badge") OPT.badge = { x: 0.5, y: 0.19, size: 0.85, visible: true };
    else {
      var src = sel.type === "btn" ? FACTORY.layout : FACTORY.stats, i, f = null;
      for (i = 0; i < src.length; i++) if (src[i].id === sel.id) f = src[i];
      if (f) { delete cfg.wk; delete cfg.hk; for (var k in f) cfg[k] = clone(f[k]); }
    }
    persist(); renderPanel(); renderStage();
  }

  function resetAll() {
    if (!confirm("استعادة كل الإعدادات الافتراضية؟ (الأزرار والعدّادات والأسلحة والصناديق)")) return;
    var mine = load().myIcons;
    wipe();
    SAVED.myIcons = mine; save();
    P.controls.layout = clone(FACTORY.layout);
    P.controls.stats = clone(FACTORY.stats);
    P.controls.scale = FACTORY.scale;
    P.weapons.forEach(function (w, i) { var f = FACTORY.weapons[i]; w.emo = f.emo; w.icon = f.icon; w.color = AMMO_COL[w.ammo] || "#ffc21a"; });
    P.map.crates = clone(FACTORY.crates);
    OPT.climb = "strict"; OPT.stepH = 0.28; OPT.doorStep = 0.75; OPT.doorFix = true;
    OPT.freeWater = true; OPT.stickyAim = true; OPT.faceMove = true; OPT.botLOS = true;
    OPT.ambient = 0.55; OPT.ocean = true; OPT.trophies = false; OPT.slimHud = true;
    OPT.badge = { x: 0.5, y: 0.19, size: 0.85, visible: false };
    sel = null; persist(); setTab(tab);
  }

  /* ============================================================
     2) الأسلحة
     ============================================================ */

  function renderWeapons() {
    var s = UI.sheet; s.innerHTML = "";
    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🔫 أيقونات وألوان الأسلحة" }),
      el("div", { class: "rs-hint", text: "الرمز أو صورتك تظهر في شريط الأسلحة أسفل الشاشة وفي شارة السلاح المحمول." }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip ok", text: "🎨 استعادة الألوان الأصلية", onclick: function () { P.weapons.forEach(function (w) { w.color = AMMO_COL[w.ammo] || "#ffc21a"; }); persist(); renderWeapons(); } }),
        el("button", { class: "rs-chip", text: "↺ استعادة الرموز الأصلية", onclick: function () { P.weapons.forEach(function (w, i) { w.emo = FACTORY.weapons[i].emo; w.icon = null; }); persist(); renderWeapons(); } })
      ])
    ]));

    P.weapons.forEach(function (w) {
      var col = w.color || AMMO_COL[w.ammo] || "#ffc21a";
      var pv = el("div", { class: "pv", style: "border-color:" + col + ";color:" + col });
      pv.appendChild(isUrl(w.icon) ? el("img", { src: w.icon }) : document.createTextNode(w.emo || "🔫"));
      var card = el("div", { class: "rs-card" }, [
        el("div", { class: "rs-wp", style: "border:0;background:none;padding:0;margin:0" }, [
          pv, el("div", { class: "in" }, [el("b", { text: w.name }), el("span", { text: (AMMO_LAB[w.ammo] || w.ammo) + " • ضرر " + w.damage + " • مخزن " + w.mag })])
        ])
      ]);
      var proxy = {
        id: "shoot",
        get icon() { return w.icon; }, set icon(v) { w.icon = v; },
        get emoji() { return w.emo; }, set emoji(v) { w.emo = v; }
      };
      card.appendChild(iconSection(proxy, function () { persist(); renderWeapons(); }));

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
      s.appendChild(card);
    });
  }

  /* ============================================================
     3) الصناديق — محرّر ثلاثي الأبعاد + نظرة من الأعلى
     ============================================================ */

  var MAP = { sel: null, view: null, cv: null, ctx: null, poly: null, tool: "move" };

  function mapPoly() {
    var p = (P.map.boundary && P.map.boundary.poly) || [];
    if (p.length > 2) return p;
    var cs = P.map.crates || [];
    if (!cs.length) return [{ x: -200, z: -200 }, { x: 200, z: -200 }, { x: 200, z: 200 }, { x: -200, z: 200 }];
    var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    cs.forEach(function (c) { mnx = Math.min(mnx, c.x); mxx = Math.max(mxx, c.x); mnz = Math.min(mnz, c.z); mxz = Math.max(mxz, c.z); });
    return [{ x: mnx - 60, z: mnz - 60 }, { x: mxx + 60, z: mnz - 60 }, { x: mxx + 60, z: mxz + 60 }, { x: mnx - 60, z: mxz + 60 }];
  }
  function inPoly(x, z, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi) inside = !inside;
    }
    return inside;
  }

  function renderCrates() {
    var s = UI.sheet; s.innerHTML = "";
    MAP.poly = mapPoly();

    s.appendChild(el("div", { class: "rs-card hero" }, [
      el("h4", { text: "🏗️ محرّر البناء ثلاثي الأبعاد" }),
      el("div", { class: "rs-hint", text: "تدخل الخريطة بشخصيتك بمنظور الشخص الثالث، تمشي لأي مكان، وترى الصندوق أمامك قبل أن تضعه — ثم تضعه بالضبط حيث تريد. عند الانتهاء: «حفظ وخروج»، ثم ابدأ اللعب." }),
      el("button", { class: "rs-big", text: "🏗️  ادخل محرّر البناء", onclick: openBuilder })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🗺️ نظرة عامة من الأعلى" }),
      el("div", { class: "rs-hint", text: "اسحب أي صندوق لتحريكه، أو اسحب الفراغ لتحريك الخريطة. اختر «أضف صندوقاً» ثم اضغط داخل الجزيرة." })
    ]));

    var tools = el("div", { class: "rs-chips", style: "margin-bottom:8px" });
    [["move", "✋ تحريك"], ["add", "📦 أضف صندوقاً"], ["erase", "🗑️ حذف"]].forEach(function (t) {
      tools.appendChild(el("button", { class: "rs-chip" + (MAP.tool === t[0] ? " on" : "") + (t[0] === "erase" ? " dz" : ""), text: t[1], onclick: function () { MAP.tool = t[0]; renderCrates(); } }));
    });
    s.appendChild(tools);

    var box = el("div", { id: "rs-map" });
    var cv = el("canvas"); box.appendChild(cv); s.appendChild(box);
    MAP.cv = cv; MAP.ctx = cv.getContext("2d");

    s.appendChild(el("div", { class: "rs-row" }, [
      el("span", { class: "rs-lab", text: "عدد الصناديق" }),
      el("span", { class: "rs-num", id: "rs-cc", text: String((P.map.crates || []).length) }),
      el("button", { class: "rs-chip", text: "🔍+", onclick: function () { zoom(1.3); } }),
      el("button", { class: "rs-chip", text: "🔍−", onclick: function () { zoom(1 / 1.3); } }),
      el("button", { class: "rs-chip", text: "⟳ توسيط", onclick: function () { MAP.view = null; drawMap(); } }),
      el("button", { class: "rs-chip", text: "📦 استعادة الأصلية", onclick: function () { P.map.crates = clone(FACTORY.crates); MAP.sel = null; persist(); drawMap(); upCount(); selPanel(); } })
    ]));
    s.appendChild(el("div", { class: "rs-card", id: "rs-msel" }));

    bindMap(box, cv);
    requestAnimationFrame(function () { drawMap(); selPanel(); });
  }

  function upCount() { var e2 = document.getElementById("rs-cc"); if (e2) e2.textContent = String((P.map.crates || []).length); }
  function viewOf() {
    if (MAP.view) return MAP.view;
    var p = MAP.poly, mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    p.forEach(function (q) { mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); mnz = Math.min(mnz, q.z); mxz = Math.max(mxz, q.z); });
    MAP.view = { cx: (mnx + mxx) / 2, cz: (mnz + mxz) / 2, span: Math.max(mxx - mnx, mxz - mnz) * 1.08 };
    return MAP.view;
  }
  function zoom(k) { var v = viewOf(); v.span = clamp(v.span / k, 30, 6000); drawMap(); }
  function mapK() { return Math.min(MAP.cv.width, MAP.cv.height) / viewOf().span; }
  function w2s(x, z) { var v = viewOf(), cv = MAP.cv, k = mapK(); return { x: (x - v.cx) * k + cv.width / 2, y: (z - v.cz) * k + cv.height / 2 }; }
  function s2w(sx, sy) { var v = viewOf(), cv = MAP.cv, k = mapK(); return { x: (sx - cv.width / 2) / k + v.cx, z: (sy - cv.height / 2) / k + v.cz }; }

  function drawMap() {
    var cv = MAP.cv; if (!cv) return;
    var r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    var g = MAP.ctx;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#08304a"; g.fillRect(0, 0, cv.width, cv.height);
    var p = MAP.poly;
    g.beginPath();
    p.forEach(function (q, i) { var s = w2s(q.x, q.z); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y); });
    g.closePath();
    g.fillStyle = "#2c6b34"; g.fill();
    g.strokeStyle = "#d9e86b"; g.lineWidth = 2 * dpr; g.stroke();
    (P.map.crates || []).forEach(function (c, i) {
      var s = w2s(c.x, c.z), a = 8 * dpr * (c.scale || 1);
      g.fillStyle = "#c98a3f"; g.strokeStyle = "#2a1a06"; g.lineWidth = 1.6 * dpr;
      g.fillRect(s.x - a / 2, s.y - a / 2, a, a);
      g.strokeRect(s.x - a / 2, s.y - a / 2, a, a);
      if (MAP.sel === i) {
        g.beginPath(); g.arc(s.x, s.y, a + 7 * dpr, 0, 6.2832);
        g.strokeStyle = "#ffc21a"; g.lineWidth = 2.5 * dpr; g.stroke();
      }
    });
  }

  function hit(sx, sy) {
    var dpr = Math.min(devicePixelRatio || 1, 2), R = 16 * dpr, cs = P.map.crates || [];
    for (var i = cs.length - 1; i >= 0; i--) {
      var s = w2s(cs[i].x, cs[i].z);
      if (Math.hypot(s.x - sx, s.y - sy) < R) return i;
    }
    return -1;
  }

  function bindMap(box, cv) {
    var pts = {}, dragI = -1, pan = null, pinch = null;
    function local(e) { var r = cv.getBoundingClientRect(), d = cv.width / r.width; return { x: (e.clientX - r.left) * d, y: (e.clientY - r.top) * d }; }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    box.addEventListener("pointerdown", function (e) {
      e.preventDefault(); box.setPointerCapture(e.pointerId);
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (ids.length === 2) { pinch = { d: dist(pts[ids[0]], pts[ids[1]]), span: viewOf().span }; dragI = -1; pan = null; return; }
      var l = pts[e.pointerId], h = hit(l.x, l.y);
      if (MAP.tool === "erase") { if (h >= 0) { P.map.crates.splice(h, 1); MAP.sel = null; persist(); drawMap(); upCount(); selPanel(); } return; }
      if (MAP.tool === "move") {
        if (h >= 0) { MAP.sel = h; dragI = h; drawMap(); selPanel(); }
        else { pan = { x: l.x, y: l.y, cx: viewOf().cx, cz: viewOf().cz }; MAP.sel = null; drawMap(); selPanel(); }
        return;
      }
      var w = s2w(l.x, l.y);
      if (!inPoly(w.x, w.z, MAP.poly)) { toast("ضَع الصندوق داخل الجزيرة"); return; }
      P.map.crates = P.map.crates || [];
      P.map.crates.push({ id: "cr_u" + Date.now().toString(36), x: w.x, y: 0, z: w.z, ry: Math.random() * 6.28, scale: 1 });
      MAP.sel = P.map.crates.length - 1;
      persist(); drawMap(); upCount(); selPanel();
    });
    box.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (pinch && ids.length === 2) {
        viewOf().span = clamp(pinch.span * (pinch.d / Math.max(dist(pts[ids[0]], pts[ids[1]]), 1)), 30, 6000);
        drawMap(); return;
      }
      var l = pts[e.pointerId];
      if (dragI >= 0) { var w = s2w(l.x, l.y), o = P.map.crates[dragI]; if (o) { o.x = w.x; o.z = w.z; drawMap(); } return; }
      if (pan) { var v = viewOf(), k = mapK(); v.cx = pan.cx - (l.x - pan.x) / k; v.cz = pan.cz - (l.y - pan.y) / k; drawMap(); }
    });
    function end(e) {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      if (dragI >= 0) { persist(); selPanel(); }
      dragI = -1; pan = null;
    }
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  }

  function selPanel() {
    var box = document.getElementById("rs-msel"); if (!box) return;
    box.innerHTML = "";
    var o = MAP.sel != null ? (P.map.crates || [])[MAP.sel] : null;
    if (!o) { box.appendChild(el("div", { class: "rs-hint", text: "لم يتم اختيار صندوق. استخدم «✋ تحريك» واضغط على صندوق." })); return; }
    box.appendChild(el("h4", { text: "📦 صندوق محدَّد" }));
    box.appendChild(row("الحجم", slider(0.5, 2.5, 0.05, o.scale || 1, function (v) { o.scale = v; persist(); drawMap(); })));
    box.appendChild(row("الدوران", slider(0, 6.28, 0.05, o.ry || 0, function (v) { o.ry = v; persist(); })));
    box.appendChild(el("div", { class: "rs-chips" }, [
      el("button", { class: "rs-chip dz", text: "🗑️ احذف هذا الصندوق", onclick: function () { P.map.crates.splice(MAP.sel, 1); MAP.sel = null; persist(); drawMap(); upCount(); selPanel(); } })
    ]));
  }

  /* ============================================================
     4) إعدادات اللعب
     ============================================================ */

  function renderPlay() {
    var s = UI.sheet; s.innerHTML = "";

    var c1 = el("div", { class: "rs-card" }, [
      el("h4", { text: "🧗 منع الصعود فوق الأشياء" }),
      el("div", { class: "rs-hint", text: "الوضع الصارم يجعل الصخور والصناديق والعوائق المنخفضة جُدراناً صلبة: لا تصعد فوقها ولا تقفز عليها." })
    ]);
    var cw = el("div", { class: "rs-chips" });
    CLIMB_MODES.forEach(function (m) {
      cw.appendChild(el("button", { class: "rs-chip" + (OPT.climb === m[0] ? " on" : ""), text: m[1], onclick: function () { OPT.climb = m[0]; persist(); renderPlay(); } }));
    });
    c1.appendChild(cw);
    CLIMB_MODES.forEach(function (m) { if (OPT.climb === m[0]) c1.appendChild(el("div", { class: "rs-hint", text: "▸ " + m[2] })); });
    c1.appendChild(row("ارتفاع الخطوة", slider(0.05, 0.85, 0.01, OPT.stepH, function (v) { OPT.stepH = v; persist(); })));
    c1.appendChild(row("عتبة الأبواب", slider(0.3, 1.4, 0.05, OPT.doorStep, function (v) { OPT.doorStep = v; persist(); })));
    c1.appendChild(el("div", { class: "rs-hint", text: "«عتبة الأبواب» تسمح بتخطّي حافة مدخل المنزل حتى مع منع التسلّق — ارفعها إذا لم تستطع الدخول إلى المنازل." }));
    s.appendChild(c1);

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🌊 حدود الحركة والبحر" }),
      el("div", { class: "rs-hint", text: "عند التفعيل تستطيع النزول إلى الأودية والأنهار داخل الخريطة بحرّية، ويبقى البحر الخارجي وحده هو الحدّ." }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip " + (OPT.freeWater ? "ok" : "dz"), text: OPT.freeWater ? "✅ الوادي والماء الداخلي مفتوح" : "🚫 اليابسة فقط", onclick: function () { OPT.freeWater = !OPT.freeWater; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.ocean ? "ok" : ""), text: OPT.ocean ? "🌊 بحر واقعي: مُفعَّل" : "🌊 بحر واقعي: مُعطَّل", onclick: function () { OPT.ocean = !OPT.ocean; persist(); renderPlay(); } })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🎯 تثبيت التصويب" }),
      el("div", { class: "rs-hint", text: "عند التفعيل: ضغطة على عصا التصويب تُثبِّت التصويب ويبقى مثبّتاً أثناء إطلاق النار وبعده، وضغطة أخرى تُزيله." }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip " + (OPT.stickyAim ? "ok" : "dz"), text: OPT.stickyAim ? "✅ مثبّت (اضغط / اضغط)" : "🚫 عادي (اضغط واستمر)", onclick: function () { OPT.stickyAim = !OPT.stickyAim; persist(); renderPlay(); } })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🔊 أصوات الخلفية" }),
      el("div", { class: "rs-hint", text: "طبقة صوتية حيّة: رياح + أمواج البحر + طيور، ترتفع كلما اقتربت من الشاطئ." }),
      row("المستوى", slider(0, 1, 0.05, OPT.ambient, function (v) { OPT.ambient = v; setAmbientGain(v); persist(); }))
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🔫 شريط الأسلحة" }),
      el("div", { class: "rs-hint", text: "الوضع المختصر: خانتا السلاح فقط أسفل الشاشة، والذخيرة داخل خانة السلاح المستعمَل — بلا صندوق ثالث وبلا شارة فوق الشاشة." }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip " + (OPT.slimHud ? "ok" : ""), text: OPT.slimHud ? "✅ خانتان فقط" : "🔢 مع صندوق الذخيرة", onclick: function () { OPT.slimHud = !OPT.slimHud; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.badge.visible ? "ok" : "dz"), text: OPT.badge.visible ? "👁️ الشارة العلوية ظاهرة" : "🚫 الشارة العلوية مخفية", onclick: function () { OPT.badge.visible = !OPT.badge.visible; persist(); renderPlay(); } })
      ]),
      OPT.badge.visible ? row("حجم الشارة", slider(0.6, 2, 0.05, OPT.badge.size || 1, function (v) { OPT.badge.size = v; persist(); })) : null
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🧠 الأعداء والشخصية" }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip " + (OPT.botLOS ? "ok" : "dz"), text: OPT.botLOS ? "✅ لا إطلاق عبر الجدران" : "🚫 الأعداء يخترقون الجدران", onclick: function () { OPT.botLOS = !OPT.botLOS; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.faceMove ? "ok" : "dz"), text: OPT.faceMove ? "✅ الشخصية تنظر لجهة حركتها" : "🚫 تنظر لجهة الكاميرا", onclick: function () { OPT.faceMove = !OPT.faceMove; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.doorFix ? "ok" : "dz"), text: OPT.doorFix ? "✅ دخول البيوت بدل الصعود فوقها" : "🚫 السلوك القديم", onclick: function () { OPT.doorFix = !OPT.doorFix; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.trophies ? "" : "ok"), text: OPT.trophies ? "🏆 الكؤوس والعملات ظاهرة" : "🚫 الكؤوس والعملات مخفية", onclick: function () { OPT.trophies = !OPT.trophies; persist(); renderPlay(); } })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card hero" }, [
      el("h4", { text: "⬇️ حمّل اللعبة النهائية" }),
      el("div", { class: "rs-hint", text: "يُنتج ملفاً واحداً فيه كل ترتيبك وأيقوناتك وصناديقك مدمجة داخله. من يحمّله يجد الأزرار جاهزة كما صمّمتها — لا تظهر له لوحة الإعداد، فقط يكتب اسمه ويلعب. هذه هي النسخة التي توزّعها." }),
      el("button", { id: "rs-export", class: "rs-big", text: "⬇️ حمّل اللعبة النهائية", onclick: exportGame })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "💾 الإعدادات" }),
      el("div", { class: "rs-hint", text: "أثناء التصميم يُحفظ كل شيء في جهازك. اسمك الحالي: " + (playerName() || "—") }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip", text: "✏️ غيّر الاسم", onclick: function () { playerName(""); toast("سيُطلب اسمك عند بدء اللعبة"); } }),
        el("button", { class: "rs-chip dz", text: "↺ استعادة كل الافتراضي", onclick: resetAll })
      ])
    ]));
  }

  /* ============================================================
     5) البدء / فتح محرّر البناء
     ============================================================ */

  function start() {
    persist();
    UI.root.classList.remove("on");
    var fab = document.getElementById("rs-fab");
    if (!fab) { fab = el("div", { id: "rs-fab", text: "⚙️", onclick: reopen }); document.body.appendChild(fab); }
    fab.classList.add("on");
    watchFab();
    askName(function () { if (resolveGo) { var r = resolveGo; resolveGo = null; r(P); } });
  }

  /* ---------------------------------------------------------------
     تصدير نسخة نهائية: كل ترتيبك وأيقوناتك مدمجة داخل الملف نفسه،
     فمن يحمّلها يجد كل شيء جاهزاً بلا أي إعداد.
     --------------------------------------------------------------- */
  function bakedPrefs() {
    persist();
    var s = JSON.parse(JSON.stringify(load()));
    s.locked = true;
    s.wantBuild = false;
    delete s.myIcons;                 /* المكتبة خاصة بالمطوّر */
    return s;
  }

  function exportGame() {
    var btn = document.getElementById("rs-export");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ جارٍ التجهيز…"; }
    toast("جارٍ تجهيز نسختك النهائية… لا تغلق الصفحة", 6000);
    setTimeout(function () {
      var json;
      try { json = JSON.stringify(bakedPrefs()); }
      catch (e) { fail("تعذّر تجهيز الإعدادات"); return; }

      /* أخرج كل ما أضفناه للصفحة قبل نسخها، حتى تخرج نسخة نظيفة */
      var parked = [];
      function park(n) { if (n && n.parentNode) { parked.push([n, n.parentNode, n.nextSibling]); n.remove(); } }
      ["rsetup", "rs-fab", "rs-build", "rs-boot", "rname", "rw-weapon"].forEach(function (id) { park(document.getElementById(id)); });
      Array.prototype.slice.call(document.querySelectorAll(".rs-toast")).forEach(park);
      var app = document.getElementById("app");
      if (app) Array.prototype.slice.call(app.childNodes).forEach(park);   /* اللعبة/الواجهة الجارية */

      function restore() { for (var i = parked.length - 1; i >= 0; i--) { try { parked[i][1].insertBefore(parked[i][0], parked[i][2]); } catch (e) { } } }

      var html;
      try { html = "<!doctype html>\n" + document.documentElement.outerHTML; }
      catch (e) { restore(); fail("الملف كبير جداً على هذا الجهاز — جرّب من حاسوب"); return; }
      restore();

      var re = /(<script id="royal-prefs"[^>]*>)[\s\S]*?(<\/script>)/;
      if (!re.test(html)) { fail("لم أجد كتلة الإعدادات داخل الملف"); return; }
      html = html.replace(re, function (m, a, c) { return a + json + c; });

      try {
        var blob = new Blob([html], { type: "text/html;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "royalbattle-" + new Date().toISOString().slice(0, 10) + ".html";
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
        toast("✔ تم تحميل نسختك النهائية — وزّعها كما هي", 5000);
        if (btn) { btn.disabled = false; btn.textContent = "⬇️ حمّل اللعبة النهائية"; }
      } catch (e) { fail("تعذّر إنشاء الملف: " + e.message); }

      function fail(msg) {
        toast(msg, 5000);
        if (btn) { btn.disabled = false; btn.textContent = "⬇️ حمّل اللعبة النهائية"; }
      }
    }, 60);
  }

  function openBuilder() {
    persist();
    OPT.build = true;
    UI.root.classList.remove("on");
    toast("جارٍ تحميل الخريطة… ستهبط مباشرةً على الأرض", 3200);
    if (resolveGo) { var r = resolveGo; resolveGo = null; r(P); }
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.__runtime && window.__runtime.lobby) {
        clearInterval(iv);
        try { window.__runtime.action({ kind: "play" }); } catch (e) { console.error(e); }
      } else if (tries > 900) clearInterval(iv);
    }, 120);
  }

  function reopen() {
    if (!UI) return;
    var f = document.getElementById("rs-fab"); if (f) f.classList.remove("on");
    UI.root.classList.add("on");
    resolveGo = null;
    setTab(tab);
    var go = UI.root.querySelector("#rs-start");
    go.textContent = "✔️ حفظ وإغلاق";
    go.onclick = function () {
      persist();
      UI.root.classList.remove("on");
      var f2 = document.getElementById("rs-fab"); if (f2) f2.classList.add("on");
      applyLive();
    };
  }

  function applyLive() {
    try {
      var rt = window.__runtime, hud = rt && rt.game && rt.game.hud;
      if (hud) {
        for (var i in hud.widgets) {
          var w = hud.widgets[i];
          if (w.setIcon) w.setIcon();
          if (w.node) w.node.className = w.node.className.replace(/shape-\S+/, "shape-" + (w.cfg.shape || "round"));
          skinWidget(w.node, w.cfg);
        }
        hud.layout();
      }
    } catch (e) { console.warn(e); }
  }

  function watchFab() {
    var fab = document.getElementById("rs-fab");
    if (!fab || fab.__w) return;
    fab.__w = true;
    setInterval(function () {
      if (OPT.build) { fab.classList.remove("on"); return; }
      if (UI && UI.root.classList.contains("on")) { fab.classList.remove("on"); return; }
      fab.classList.toggle("on", !document.getElementById("gameroot"));
    }, 700);
  }

  window.__ROYAL_SETUP__ = function (project) {
    try { return boot(project); }
    catch (e) { console.error("setup failed", e); return Promise.resolve(project); }
  };

  /* ============================================================
     6) خطّافات داخل اللعبة
     ============================================================ */

  var blockStart = 0;

  window.__ROYAL_PASS__ = function (game, x, z, curG, tgtG, step) {
    var Q = game.Q;
    if (Q.isBlocked(x, z)) return blocked();

    /* المباني: تسامح أكبر مع عتبة الباب حتى يمكن الدخول */
    if (Q.isIndoor && Q.isIndoor(x, z)) {
      blockStart = 0;
      return tgtG - curG <= Math.max(step, OPT.doorStep);
    }

    if (OPT.climb !== "free" && !OPT.build) {
      var f = Q.heightAt(x, z), rf = Q.roofAt(x, z), gap = rf - f;
      var lo = OPT.climb === "strict" ? 0.3 : 0.62;
      var hi = OPT.climb === "strict" ? 2.35 : 1.85;
      if (gap > lo && gap < hi) {
        var py = game.pos ? game.pos.y : 0;
        if (!(game.grounded && py >= rf - 0.3)) return blocked();
      }
    }
    if (tgtG - curG > step) return blocked();
    blockStart = 0;
    return true;
  };

  /* صمّام أمان: لو عَلِق اللاعب تماماً أكثر من ثانيتين ونصف نُرخي المنع مؤقتاً */
  function blocked() {
    var now = performance.now();
    if (!blockStart) { blockStart = now; return false; }
    if (now - blockStart > 2500) { blockStart = now - 1200; return true; }
    return false;
  }

  /* الوادي/الماء الداخلي: نسمح بالحركة فيه، ويبقى البحر الخارجي هو الحدّ */
  window.__ROYAL_WATEROK__ = function () { return OPT.freeWater || OPT.build; };

  /* ارتفاع الأرض: لا يقفز فوق سطح البيت عند محاولة الدخول من باب صغير */
  window.__ROYAL_GY__ = function (game, x, z, yArg, g) {
    if (!OPT.doorFix) return g;
    var Q = game.Q, f = Q.heightAt(x, z), rf = Q.roofAt(x, z);
    if (rf - f < 0.35) return g;                       /* أرض مكشوفة */
    var y = (yArg === undefined) ? (game.pos ? game.pos.y : 1e5) : yArg;
    if (y >= rf - 0.12) return rf;                     /* نحن فعلاً فوق السطح */
    return f;                                          /* غير ذلك: ندخل تحت/داخل المبنى */
  };

  /* الشخصية تنظر لجهة حركتها بدل أن تُدير ظهرها */
  window.__ROYAL_FACE__ = function (game, camYaw, moveYaw, aiming) {
    if (!OPT.faceMove || aiming || game.view === "fps") return undefined;
    if (moveYaw === undefined) return undefined;
    return moveYaw;
  };

  /* خطّ النظر: الأعداء لا يطلقون عبر الجدران والتضاريس */
  window.__ROYAL_LOS__ = function (game, from, to) {
    if (!OPT.botLOS) return true;
    var Q = game.Q;
    if (!Q || !Q.roofAt) return true;
    var dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    var len = Math.hypot(dx, dz);
    if (len < 2) return true;
    var steps = Math.min(64, Math.max(6, Math.ceil(len / 1.2)));
    for (var i = 1; i < steps; i++) {
      var k = i / steps;
      var x = from.x + dx * k, z = from.z + dz * k, y = from.y + dy * k;
      if (Q.roofAt(x, z) > y + 0.35) return false;
    }
    return true;
  };

  /* إخفاء الكؤوس والعملات من الواجهة */
  function tidyLobby() {
    if (OPT.trophies) return;
    var lb = document.getElementById("lobby");
    if (!lb || lb.__tidy) return;
    var rows = [], i;
    var all = lb.querySelectorAll("div");
    for (i = 0; i < all.length; i++) {
      var st = all[i].getAttribute("style") || "";
      if (st.indexOf("top: 2%") >= 0 && st.indexOf("position: absolute") >= 0) rows.push(all[i]);
    }
    if (!rows.length) return;
    lb.__tidy = true;
    rows.forEach(function (r) {
      if (r.querySelector("b")) {                       /* صف الاسم: أبقِ الاسم فقط */
        for (var j = r.children.length - 1; j >= 1; j--) r.children[j].style.display = "none";
      } else r.style.display = "none";                  /* صف العملات: أخفِه كاملاً */
    });
  }
  setInterval(tidyLobby, 800);

  /* تثبيت التصويب: يُستدعى من عصا التصويب */
  window.__ROYAL_STICK__ = function (hud, cfg, phase) {
    if (cfg.id !== "aim" || !OPT.stickyAim) return false;
    if (phase === "down") {
      hud.input.aiming = !hud.input.aiming;
      hud.cross.classList.toggle("on", hud.input.aiming);
    }
    return true;   /* عند الرفع: لا نُلغي التصويب */
  };

  /* ---------------- العالم: بحر + صوت + وضع البناء ---------------- */

  window.__ROYAL_WORLD__ = function (game) {
    try { if (OPT.ocean) upgradeOcean(game); } catch (e) { console.warn("ocean", e); }
  };

  window.__ROYAL_READY__ = function (game) {
    try { startAmbient(game); } catch (e) { console.warn("ambient", e); }
    if (OPT.build) { try { enterBuild(game); } catch (e) { console.error("build", e); } }
  };

  /* ---- 6.1 بحر أكثر واقعية ---- */
  function upgradeOcean(game) {
    var o = game.ocean;
    if (!o || !o.material || !o.material.uniforms) return;
    o.material.vertexShader = [
      "varying vec2 vUv; varying vec3 vW; varying float vWave;",
      "uniform float t;",
      "float sw(vec2 p, vec2 d, float len, float sp){ return sin(dot(p,d)/len + t*sp); }",
      "void main(){",
      "  vUv = uv*40.0;",
      "  vec4 wp = modelMatrix*vec4(position,1.0);",
      "  float w = 0.0;",
      "  w += sw(wp.xz, normalize(vec2( 1.0, 0.35)), 34.0, 0.55)*0.85;",
      "  w += sw(wp.xz, normalize(vec2(-0.4, 1.0 )), 21.0, 0.80)*0.45;",
      "  w += sw(wp.xz, normalize(vec2( 0.7,-0.7 )), 12.0, 1.15)*0.22;",
      "  vWave = w;",
      "  wp.y += w;",
      "  vW = wp.xyz;",
      "  gl_Position = projectionMatrix*viewMatrix*wp;",
      "}"
    ].join("\n");
    o.material.fragmentShader = [
      "uniform float t; uniform vec3 cA,cB,cS; uniform vec3 uCam;",
      "varying vec2 vUv; varying vec3 vW; varying float vWave;",
      "float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }",
      "float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
      "  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }",
      "float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.02; a*=0.5; } return v; }",
      "void main(){",
      "  vec2 q = vUv;",
      "  float w1 = fbm(q*1.15 + vec2(t*0.040, t*0.026));",
      "  float w2 = fbm(q*3.10 - vec2(t*0.070, t*0.046));",
      "  float w3 = fbm(q*7.40 + vec2(t*0.130,-t*0.090));",
      "  float w  = w1*0.55 + w2*0.30 + w3*0.15;",
      "  float e = 0.5;",
      "  float dx  = fbm((q+vec2(e,0.0))*1.15 + vec2(t*0.040,t*0.026)) - w1;",
      "  float dz  = fbm((q+vec2(0.0,e))*1.15 + vec2(t*0.040,t*0.026)) - w1;",
      "  float dx2 = fbm((q+vec2(e,0.0))*3.10 - vec2(t*0.070,t*0.046)) - w2;",
      "  float dz2 = fbm((q+vec2(0.0,e))*3.10 - vec2(t*0.070,t*0.046)) - w2;",
      "  vec3 nrm = normalize(vec3(-(dx*3.0+dx2*1.6), 1.0, -(dz*3.0+dz2*1.6)));",
      "  vec3 V = normalize(uCam - vW);",
      "  float fres = pow(1.0 - max(dot(nrm,V),0.0), 4.0);",
      "  float dist = length(vW.xz - uCam.xz);",
      "  float deep = smoothstep(40.0, 800.0, dist);",
      "  vec3 c = mix(cB, cA, deep);",
      "  c *= 0.86 + 0.24*smoothstep(-1.0, 1.0, vWave);",
      "  c = mix(c, cS, fres*0.62);",
      "  vec3 L = normalize(vec3(0.55,0.72,0.42));",
      "  float spec = pow(max(dot(reflect(-L,nrm),V),0.0), 140.0);",
      "  c += vec3(1.0,0.97,0.88) * spec * 1.35;",
      "  float glit = pow(max(dot(reflect(-L,nrm),V),0.0), 24.0) * (0.35+0.65*w3);",
      "  c += vec3(1.0,0.96,0.85) * glit * 0.20 * (1.0-deep*0.5);",
      "  float foam = smoothstep(0.70,0.90,w) + smoothstep(0.55,1.35,vWave)*0.5;",
      "  c = mix(c, vec3(0.93,0.98,1.0), clamp(foam,0.0,1.0)*0.42);",
      "  float hz = smoothstep(1400.0, 3200.0, dist);",
      "  c = mix(c, cA*1.12, hz*0.55);",
      "  gl_FragColor = vec4(c, 1.0);",
      "}"
    ].join("\n");
    o.material.needsUpdate = true;
  }

  /* ---- 6.2 صوت خلفية حيّ ---- */
  var AMB = null;
  function setAmbientGain(v) { if (AMB && AMB.master) try { AMB.master.gain.value = v * 0.5; } catch (e) { } }

  function startAmbient(game) {
    var A = window.__ROYAL_AUDIO__;
    if (!A) return;
    stopAmbient();
    var kick = function () {
      if (AMB) return;
      var ctx = null;
      try { ctx = A.init ? A.init() : null; } catch (e) { }
      if (!ctx) { try { ctx = A.ctx ? A.ctx() : null; } catch (e) { } }
      if (!ctx) return;
      AMB = buildAmbient(ctx, game);
      setAmbientGain(OPT.ambient);
    };
    kick();
    if (!AMB) addEventListener("pointerdown", kick, { once: true });
  }
  function stopAmbient() {
    if (!AMB) return;
    try { AMB.stop(); } catch (e) { }
    AMB = null;
  }

  function noiseBuffer(ctx, sec) {
    var n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    var last = 0;
    for (var i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;   /* ضوضاء بنّية = رياح/أمواج */
      d[i] = last * 3.2;
    }
    return b;
  }

  function buildAmbient(ctx, game) {
    var master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    var buf = noiseBuffer(ctx, 6);

    var wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
    var wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 520; wf.Q.value = 0.6;
    var wg = ctx.createGain(); wg.gain.value = 0.26;
    wind.connect(wf); wf.connect(wg); wg.connect(master);
    var wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.07;
    var wamp = ctx.createGain(); wamp.gain.value = 0.14;
    wlfo.connect(wamp); wamp.connect(wg.gain); wlfo.start();

    var sea = ctx.createBufferSource(); sea.buffer = buf; sea.loop = true;
    var sf = ctx.createBiquadFilter(); sf.type = "lowpass"; sf.frequency.value = 900;
    var sg = ctx.createGain(); sg.gain.value = 0.2;
    sea.connect(sf); sf.connect(sg); sg.connect(master);
    var slfo = ctx.createOscillator(); slfo.frequency.value = 0.13;      /* موجة كل ~8 ثوانٍ */
    var samp = ctx.createGain(); samp.gain.value = 0.17;
    slfo.connect(samp); samp.connect(sg.gain); slfo.start();
    var slfo2 = ctx.createOscillator(); slfo2.frequency.value = 0.037;
    var samp2 = ctx.createGain(); samp2.gain.value = 700;
    slfo2.connect(samp2); samp2.connect(sf.frequency); slfo2.start();

    wind.start(); sea.start();

    var birdT = setInterval(function () {
      if (!AMB || Math.random() > 0.4) return;
      var t0 = ctx.currentTime, k = 2 + ((Math.random() * 3) | 0);
      for (var i = 0; i < k; i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        var f0 = 1900 + Math.random() * 1500, at = t0 + i * (0.07 + Math.random() * 0.06);
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.5), at + 0.05);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.05, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
        o.connect(g); g.connect(master); o.start(at); o.stop(at + 0.14);
      }
    }, 5200);

    var near = setInterval(function () {
      try {
        if (!game || game.disposed || !game.Q || !game.pos) return;
        var d = game.Q.edgeAt ? game.Q.edgeAt(game.pos.x, game.pos.z) : 40;
        var k = clamp(1.35 - d / 55, 0.35, 1.35);
        sg.gain.value = 0.2 * k;
        wg.gain.value = 0.26 * (0.7 + 0.3 * k);
      } catch (e) { }
    }, 900);

    return {
      master: master,
      stop: function () {
        clearInterval(birdT); clearInterval(near);
        try { wind.stop(); sea.stop(); wlfo.stop(); slfo.stop(); slfo2.stop(); } catch (e) { }
        try { master.disconnect(); } catch (e) { }
      }
    };
  }

  /* ---- 6.3 محرّر البناء ثلاثي الأبعاد ---- */

  var B = null;

  function enterBuild(game) {
    B = { game: game, mode: "place", sel: -1, ghost: null, ghostBox: null, ghostDims: null, hit: null, raf: 0 };
    game.__build = true;

    try {
      (game.bots || []).forEach(function (b) { try { game.scene.remove(b.ch.group); } catch (e) { } });
      game.bots.length = 0;
      game.stats.alive = 1;
      game.hud.setStat("alive", 1);
      game.hud.setStat("rank", "#1");
    } catch (e) { }

    setTimeout(function () {
      try {
        var v = game.an.view || { cx: 0, cz: 0 };
        var p = game.Q.nearestLand(v.cx, v.cz, 60);
        game.pos.set(p.x, game.Q.roofAt(p.x, p.z) + 0.2, p.z);
        game.vel.set(0, 0, 0);
        game.view = "tps";
        game.land();
        game.hud.showOOB(null);
      } catch (e) { console.warn(e); }
    }, 80);

    makeGhost(game);
    buildBar();
    B.raf = requestAnimationFrame(buildTick);
    toast("امشِ لأي مكان ثم اضغط «📦 ضع صندوقاً»", 3800);
  }

  function makeGhost(game) {
    var T = window.__ROYAL_THREE__; if (!T) return;
    var d = game.crateDims || { w: 2.6, h: 1.5, d: 1.6 };
    var mesh = new T.Mesh(new T.Box(d.w, d.h, d.d),
      new T.Basic({ color: 0x39e07b, transparent: true, opacity: 0.45, depthTest: false }));
    mesh.renderOrder = 998;
    var ring = new T.Mesh(new T.Cyl(d.w * 0.95, d.w * 0.95, 0.06, 22, 1),
      new T.Basic({ color: 0xffc21a, transparent: true, opacity: 0.5, depthTest: false }));
    ring.renderOrder = 997;
    ring.position.y = -d.h * 0.5 + 0.03;
    var grp = new T.Group();
    grp.add(mesh); grp.add(ring);
    grp.visible = false;
    game.scene.add(grp);
    B.ghost = grp; B.ghostBox = mesh; B.ghostDims = d;
  }

  function buildTick() {
    if (!B || !B.game || B.game.disposed) return;
    var game = B.game, T = window.__ROYAL_THREE__;
    if (T && B.ghost && game.phase === "ground") {
      var dir = new T.V3();
      game.camera.getWorldDirection(dir);
      var o = game.camera.position, hit = null, d, px, pz, py, gy;
      for (d = 1.5; d < 30; d += 0.4) {
        px = o.x + dir.x * d; py = o.y + dir.y * d; pz = o.z + dir.z * d;
        gy = game.Q.groundFor(px, pz, py);
        if (py <= gy) { hit = { x: px, z: pz, y: gy }; break; }
      }
      if (!hit) {
        var fx = game.pos.x - Math.sin(game.yaw) * 4, fz = game.pos.z - Math.cos(game.yaw) * 4;
        hit = { x: fx, z: fz, y: game.Q.groundFor(fx, fz, game.pos.y) };
      }
      var ok = game.Q.isLand(hit.x, hit.z);
      B.hit = ok ? hit : null;
      B.ghost.visible = true;
      B.ghost.position.set(hit.x, hit.y + B.ghostDims.h * 0.5, hit.z);
      B.ghostBox.material.color.setHex(ok ? 0x39e07b : 0xff4d5e);
      if (B.mode === "move" && B.sel >= 0 && ok) {
        var c = game.crates[B.sel];
        if (c) { c.x = hit.x; c.z = hit.z; rebuildCrates(game); }
      }
      var lab = document.getElementById("bb-pos");
      if (lab) lab.textContent = Math.round(hit.x) + " , " + Math.round(hit.z);
    }
    B.raf = requestAnimationFrame(buildTick);
  }

  function rebuildCrates(game) {
    try {
      if (game.crateProxy) game.scene.remove(game.crateProxy);
      if (game.crateLid) game.scene.remove(game.crateLid);
      (game.detailPool || []).forEach(function (d) { try { game.scene.remove(d.holder); } catch (e) { } });
      game.buildCrates();
    } catch (e) { console.warn("rebuild crates", e); }
  }

  function buildBar() {
    if (document.getElementById("rs-build")) return;
    var bar = el("div", { id: "rs-build" }, [
      el("div", { class: "bb-top" }, [
        el("b", { text: "🏗️ وضع البناء" }),
        el("span", { id: "bb-n", text: "" }),
        el("i", { id: "bb-pos", text: "" })
      ]),
      el("div", { class: "bb-tools" }, [
        el("button", { class: "bb ok", text: "📦 ضع صندوقاً", onclick: doPlace }),
        el("button", { class: "bb", text: "✋ اختر الأقرب", onclick: doPick }),
        el("button", { class: "bb", id: "bb-move", text: "↔️ حرّك", onclick: doMove }),
        el("button", { class: "bb dz", text: "🗑️ احذف", onclick: doDel })
      ]),
      el("div", { class: "bb-tools" }, [
        el("button", { class: "bb", text: "🔄 دوّر", onclick: function () { withSel(function (c) { c.ry = (c.ry || 0) + 0.4; }); } }),
        el("button", { class: "bb", text: "➕ كبّر", onclick: function () { withSel(function (c) { c.scale = clamp((c.scale || 1) + 0.1, 0.5, 2.5); }); } }),
        el("button", { class: "bb", text: "➖ صغّر", onclick: function () { withSel(function (c) { c.scale = clamp((c.scale || 1) - 0.1, 0.5, 2.5); }); } }),
        el("button", { class: "bb save", text: "💾 حفظ وخروج", onclick: doSave })
      ])
    ]);
    document.body.appendChild(bar);
    upN();
  }
  function upN() {
    var n = document.getElementById("bb-n");
    if (n && B) n.textContent = "الصناديق: " + (B.game.crates || []).length + (B.sel >= 0 ? " • محدَّد #" + (B.sel + 1) : "");
  }
  function withSel(fn) {
    if (!B || B.sel < 0) { toast("اختر صندوقاً أولاً («✋ اختر الأقرب»)"); return; }
    var c = B.game.crates[B.sel]; if (!c) return;
    fn(c); rebuildCrates(B.game); syncCrates();
  }
  function doPlace() {
    if (!B || !B.hit) { toast("وجّه نظرك إلى الأرض داخل الجزيرة"); return; }
    B.game.crates.push({ id: "cr_b" + Date.now().toString(36), x: B.hit.x, y: B.hit.y, z: B.hit.z, ry: 0, scale: 1, opened: false });
    B.sel = B.game.crates.length - 1;
    B.mode = "place";
    rebuildCrates(B.game); syncCrates(); upN();
    toast("تم وضع الصندوق ✔", 900);
  }
  function doPick() {
    if (!B || !B.hit) return;
    var best = -1, bd = 9e9;
    (B.game.crates || []).forEach(function (c, i) {
      var d = Math.hypot(c.x - B.hit.x, c.z - B.hit.z);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd < 12) { B.sel = best; B.mode = "sel"; toast("تم اختيار صندوق على بعد " + bd.toFixed(1) + "م"); }
    else toast("لا يوجد صندوق قريب");
    upN();
  }
  function doMove() {
    if (!B || B.sel < 0) { toast("اختر صندوقاً أولاً"); return; }
    B.mode = B.mode === "move" ? "sel" : "move";
    var mb = document.getElementById("bb-move");
    if (mb) mb.classList.toggle("on", B.mode === "move");
    toast(B.mode === "move" ? "الصندوق يتبع نظرك — اضغط «حرّك» ثانيةً لتثبيته" : "تم التثبيت ✔");
    if (B.mode !== "move") syncCrates();
  }
  function doDel() {
    if (!B || B.sel < 0) { toast("اختر صندوقاً أولاً"); return; }
    B.game.crates.splice(B.sel, 1);
    B.sel = -1; B.mode = "place";
    rebuildCrates(B.game); syncCrates(); upN();
    toast("تم الحذف");
  }
  function syncCrates() {
    if (!B) return;
    P = B.game.P;
    P.map.crates = (B.game.crates || []).map(function (c) {
      return { id: c.id, x: c.x, y: c.y, z: c.z, ry: c.ry || 0, scale: c.scale || 1 };
    });
    var s = load(); s.crates = P.map.crates; SAVED = s; save();
  }
  function doSave() {
    syncCrates();
    var s = load(); s.wantBuild = true; SAVED = s; save();
    toast("تم الحفظ — جارٍ الرجوع للوحة الإعداد…", 2500);
    setTimeout(function () { location.reload(); }, 700);
  }

  /* ---- 6.4 شارة السلاح ---- */
  function badgeEl(hud) {
    if (hud.__rw && hud.__rw.isConnected) return hud.__rw;
    var n = el("div", { id: "rw-weapon" }, [el("div", { class: "ic" }), el("div", { class: "tx" }, [el("b"), el("span"), el("u")])]);
    hud.node.appendChild(n); hud.__rw = n;
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
      hud.ammoBox.classList.toggle("slim", !!OPT.slimHud);
      var nodes = hud.ammoBox.querySelectorAll(".wslot");
      for (var i = 0; i < nodes.length; i++) {
        var it = slots[i];
        nodes[i].style.setProperty("--wcol", it ? (it.def.color || AMMO_COL[it.def.ammo] || "#ffc21a") : "rgba(255,255,255,.2)");
        nodes[i].classList.toggle("cur", i === active);
      }
      var n = badgeEl(hud); placeBadge(hud);
      var cur = slots[active];
      if (!cur || !OPT.badge.visible) { n.classList.remove("on"); return; }
      var d = cur.def, col = d.color || AMMO_COL[d.ammo] || "#ffc21a";
      n.style.setProperty("--wcol", col);
      var ic = n.querySelector(".ic"); ic.innerHTML = "";
      var thumb = isUrl(d.icon) ? d.icon : (hud.thumbs && hud.thumbs[d.id]);
      ic.appendChild(thumb ? el("img", { src: thumb, alt: "" }) : document.createTextNode(d.emo || "🔫"));
      n.querySelector("b").textContent = d.name;
      n.querySelector("u").textContent = (d.short ? d.short + " • " : "") + (AMMO_LAB[d.ammo] || d.ammo);
      n.classList.add("on");
    } catch (e) { console.warn("weapon badge", e); }
  };
  window.__ROYAL_AMMO__ = function (hud, info) {
    try {
      if (!info) return;
      if (hud.__rw) hud.__rw.querySelector("span").textContent = info.mag + " / " + info.res;
      /* في الوضع المختصر: العدّاد داخل خانة السلاح المستعمَل */
      if (OPT.slimHud) {
        var cur = hud.ammoBox.querySelector(".wslot.cur");
        if (cur) {
          var a = cur.querySelector("s");
          if (!a) { a = document.createElement("s"); cur.appendChild(a); }
          a.textContent = info.mag + "/" + info.res;
          a.classList.toggle("low", info.mag === 0);
        }
      }
    } catch (e) { }
  };
  window.__ROYAL_HUDL__ = function (hud) { try { placeBadge(hud); } catch (e) { } };

  /* ---- 6.5 شاشة تحميل مبكّرة ---- */
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
