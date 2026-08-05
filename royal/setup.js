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
  function orient() { return editOrient || (innerWidth >= innerHeight ? "land" : "port"); }
  var editOrient = null;
  /* رقم إصدار الإعدادات: إذا رفعناه تُنسى المفاتيح المذكورة أدناه فقط */
  var OPT_VER = 2;
  var FORCED = ["faceFlip", "gunFlip", "faceMove", "bodyLock", "fpsFix", "camNear", "fpsClear",
    "holdFix", "holdClear", "holdPush", "holdOut", "parallax", "fireBtnOnly", "itemRails"];
  /* المكان والحجم يختلفان بين الطول والعرض — أمّا المظهر فواحد للاثنين */
  var GEO_KEYS = ["x", "y", "size", "wk", "hk"];
  var LOOK_KEYS = ["shape", "emoji", "icon", "opacity", "visible", "color", "bare"];
  function setEditOrient(o) {
    persist();                      /* احفظ الوضع الحالي أولاً */
    editOrient = o;
    var st = load(), src = o === "port" ? st.layoutPort : st.layout;
    if (!src) src = o === "port" ? st.layout : st.layoutPort;
    if (src) P.controls.layout.forEach(function (c) {
      var f = src[c.id];
      if (f) GEO_KEYS.forEach(function (k) { if (f[k] !== undefined) c[k] = f[k]; });
    });
    UI.stage.classList.toggle("port", o === "port");
    applyStageBox();
    renderStage(); renderPanel(); syncFlipBtn();
    toast(o === "port" ? "📱 تُحرّر الآن الوضع العمودي" : "🖥️ تُحرّر الآن الوضع الأفقي");
  }
  /* الوضع الحقيقي للجهاز الآن */
  function realOrient() { return innerWidth >= innerHeight ? "land" : "port"; }
  /* عند «قلب الشاشة» نُحاكي الجهاز نفسه بعد قلبه: نفس النِسبة معكوسة */
  function applyStageBox() {
    if (!UI) return;
    var st = UI.stage, o = orient();
    var tag = document.getElementById("rs-simtag");
    if (!editOrient || o === realOrient()) {
      st.classList.remove("sim"); UI.root.classList.remove("simon");
      st.style.width = st.style.height = st.style.left = st.style.top = st.style.inset = "";
      if (tag) tag.remove();
      return;
    }
    var AR = innerHeight / innerWidth;             /* نِسبة الجهاز بعد القلب */
    var w = innerWidth, h = w / AR;
    if (h > innerHeight) { h = innerHeight; w = h * AR; }
    st.classList.add("sim"); UI.root.classList.add("simon");
    st.style.inset = "auto";
    st.style.width = Math.round(w) + "px";
    st.style.height = Math.round(h) + "px";
    st.style.left = Math.round((innerWidth - w) / 2) + "px";
    st.style.top = Math.round((innerHeight - h) / 2) + "px";
    if (!tag) { tag = el("div", { id: "rs-simtag" }); UI.root.appendChild(tag); }
    tag.textContent = (o === "port" ? "📱 محاكاة الوضع العمودي" : "🖥️ محاكاة الوضع الأفقي") +
      " — " + Math.round(w) + "×" + Math.round(h);
  }
  /* زر قلب الشاشة: ينتقل للوضع الآخر ويُظهر الأزرار بمقاسها هناك */
  function flipOrient() {
    var o = orient() === "port" ? "land" : "port";
    if (!OPT.perOrient) { OPT.perOrient = true; persist(); }
    setEditOrient(o);
    syncFlipBtn();
  }
  function syncFlipBtn() {
    var b = document.getElementById("rs-flip"); if (!b) return;
    var o = orient();
    b.textContent = o === "port" ? "🔄 اقلب لأفقي" : "🔄 اقلب لعمودي";
    b.title = "تُحرّر الآن ترتيب الوضع " + (o === "port" ? "العمودي" : "الأفقي") +
      " — اضغط لترتيب الوضع الآخر";
    b.classList.toggle("on", editOrient !== null && editOrient !== realOrient());
  }
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
    faceMove: false,     /* المحرّك يدير القدمين وحدهما — لا نلمس زاوية الجسم */
    faceFlip: false,     /* مقيس بالصورة: الجسم = زاوية التصويب مباشرةً */
    bodyLock: true,      /* زاوية الجسم = زاوية التصويب بالضبط، كل إطار */
    zoneBotMul: 3,       /* سرعة تأذّي البوتات خارج الزون */
    zoneRamp: 4,         /* ثوانٍ حتى يصل ضرر الزون لكامله */
    playerWall: true,    /* رصاص اللاعب لا يخترق الجدران */
    sens: 1,             /* حساسية النظر */
    adsSens: 0.55,       /* حساسية النظر أثناء التصويب */
    smooth: 0.35,        /* تنعيم حركة النظر */
    gunFlip: true,       /* ومع دوران الجسم نُعيد الماسورة للأمام */
    ctxButtons: true,    /* أزرار الفتح/الالتقاط تظهر عند الحاجة فقط */
    botDrop: true,       /* الأعداء يُسقطون غنائمهم */
    headMul: 2.2,        /* مضاعف ضرر إصابة الرأس */
    directAim: false,    /* true = بلا أي مساعدة تصويب إطلاقاً */
    aimAssist: true,     /* مساعد التصويب: يقفل على العدو */
    aimAdsOnly: true,    /* لا يعمل إلا عند تفعيل وضع التصويب */
    aimCone: 0.9,        /* اتساع مخروط المساعدة (0.9 ≈ 25°) */
    aimPow: 1,           /* 1 = قفل كامل على العدو */
    fireBtnOnly: true,   /* لا إطلاق إلا بالضغط على زرّ الضرب */
    parallax: true,      /* الرصاصة تذهب حيث تشير علامة التصويب بالضبط */
    shotFx: true,        /* خيط رصاص لامع وصاروخ RPG حقيقي */
    holdFix: true,       /* إخراج مؤخّرة السلاح من داخل جسم الشخصية */
    holdClear: 0.06,     /* ما يُسمح ببقائه خلف اليد */
    holdPush: 0.04,      /* دفع إضافي للأمام */
    holdOut: 0.07,       /* إبعاد عن الجسم */
    holdUp: 0,           /* رفع/خفض */
    fpsFix: true,        /* سلاح المنظور الأول لا يُقَصّ */
    camNear: 0.08,       /* مستوى القصّ الأمامي */
    fpsClear: 0.1,       /* هامش أمان أمام الكاميرا */
    itemRails: true,     /* لوحتا العلاجات والقنابل */
    nadeFuse: 3,         /* ثوانٍ حتى انفجار القنبلة */
    nadeSpeed: 17,       /* قوّة الرمي */
    nadeR: 7.5,          /* نصف قطر الانفجار */
    nadeDmg: 115,        /* أقصى ضرر في المركز */
    meshMove: true,      /* حركة تصطدم بمضلّعات الخريطة فعلياً */
    chuteAcc: 34,        /* تسارع التحرّك تحت المظلّة */
    chuteDamp: 2.2,      /* كبح التحرّك تحت المظلّة */
    customSfx: true,     /* أصوات المطوّر بدل المولّدة */
    sfxPistolSec: 1.0,   /* طول مقطع طلقة المسدّس */
    sfxRifleSec: 0.3,    /* طول مقطع طلقة الرشّاش */
    sfxSniperSec: 1.6,   /* طول مقطع طلقة القنص */
    sfxRpgSec: 2.4,      /* طول مقطع انطلاق الـ RPG */
    menuVol: 0.45,       /* مستوى موسيقى القائمة */
    thumbSide: true,     /* صورة السلاح: منظر جانبي كامل */
    meshGround: true,    /* الوقوف على الجسور وأرضيات البيوت الحقيقية */
    stickRun: true,      /* دفع العصا للنهاية = جري */
    stickRunAt: 0.86,    /* عتبة الجري */
    exactWalls: true,    /* اصطدام دقيق بمضلّعات الخريطة */
    matchMin: 22,        /* مدة المباراة بالدقائق */
    voice: true,         /* الميكروفون مع الأصدقاء */
    voiceMic: true,      /* ابدأ والميكروفون مفتوح */
    perOrient: true,     /* ترتيب مستقل للوضع العمودي والأفقي */
    online: false,       /* افتح الأونلاين افتراضياً */
    netTarget: 25,       /* ابدأ فور اكتمال هذا العدد */
    netWait: 300,        /* أقصى انتظار بالثواني */
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
      crates: clone(P.map.crates || []),
      lobby: clone((P.lobby && P.lobby.buttons) || []),
      match: clone(P.match || {})
    };
    applySaved();
    watchOrientLive();
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
    /* إصلاحات جوهرية يجب أن تصل حتى لمن عنده إعدادات محفوظة قديمة:
       ننسى القيم القديمة لهذه المفاتيح وحدها ونُبقي كل شيء آخر كما هو. */
    if (s.opt && (s.opt.optVer | 0) < OPT_VER) {
      FORCED.forEach(function (kk) { delete s.opt[kk]; });
      s.opt.optVer = OPT_VER;
      SAVED = s; save();
    }
    if (s.opt) for (k in s.opt) {
      if (k === "badge") { for (j in s.opt.badge) OPT.badge[j] = s.opt.badge[j]; }
      else if (k in OPT) OPT[k] = s.opt[k];
    }
    OPT.build = false;
    var LY = (OPT.perOrient && orient() === "port" && s.layoutPort) ? s.layoutPort : (s.layout || s.layoutPort);
    /* المظهر المشترك أولاً (وإن كان الحفظ قديماً فخُذه من الترتيب الأفقي) */
    var LOOK = s.look || s.layout || s.layoutPort;
    if (LOOK) for (i = 0; i < P.controls.layout.length; i++) {
      f = LOOK[P.controls.layout[i].id];
      if (f) LOOK_KEYS.forEach(function (kk) {
        if (f[kk] !== undefined) P.controls.layout[i][kk] = f[kk];
      });
    }
    if (LY) for (i = 0; i < P.controls.layout.length; i++) {
      f = LY[P.controls.layout[i].id];
      if (f) GEO_KEYS.forEach(function (kk) {
        if (f[kk] !== undefined) P.controls.layout[i][kk] = f[kk];
      });
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
      if (f) {
        if (f.emo) w.emo = f.emo; if (f.icon) w.icon = f.icon; if (f.color) w.color = f.color;
        if (f.hold) w.hold = f.hold; if (f.scale) w.scale = f.scale;
      }
    }
    if (Array.isArray(s.crates)) P.map.crates = clone(s.crates);
    else P.map.crates = [];            /* أول تشغيل: خريطة نظيفة تماماً */
    if (s.lobby && P.lobby && P.lobby.buttons) {
      P.lobby.buttons.forEach(function (b) {
        var f = s.lobby[b.uid];
        if (f) for (var k in f) if (f[k] !== undefined) b[k] = f[k];
      });
    }
    if (P.map && P.map.zone) {
      var Z = P.map.zone, ph = Z.phases || 7;
      var T = Math.max(120, OPT.matchMin * 60 - (Z.firstDelay || 25));
      Z.holdTime = Math.round((T / ph) * 0.6);
      Z.shrinkTime = Math.round((T / ph) * 0.4);
    }
    if (!s.lobby && P.lobby && P.lobby.buttons) {
      P.lobby.buttons.forEach(function (b) { if (b.kind === "skins") b.visible = false; });
    }
    if (P.match) {
      P.match.online = !!OPT.online;
      P.match.netWait = OPT.netWait;
      P.match.netMinPlayers = 1;
      P.match.lookSens = P.match.lookSens || 1;
    }
  }

  function persist() {
    var s = load(), i, w;
    var LK = (OPT.perOrient && orient() === "port") ? "layoutPort" : "layout";
    s[LK] = {}; s.stats = {}; s.look = s.look || {};
    for (i = 0; i < P.controls.layout.length; i++) {
      var c = P.controls.layout[i];
      /* المكان والحجم لكل وضع شاشة على حِدة… */
      s[LK][c.id] = { x: c.x, y: c.y, size: c.size, wk: c.wk, hk: c.hk };
      /* …أمّا الأيقونة واللون والشكل فمشتركة بين الوضعين ولا تضيع عند القلب */
      s.look[c.id] = { shape: c.shape, emoji: c.emoji, icon: c.icon, opacity: c.opacity, visible: c.visible, color: c.color, bare: c.bare };
    }
    for (i = 0; i < P.controls.stats.length; i++) {
      var t = P.controls.stats[i];
      s.stats[t.id] = { x: t.x, y: t.y, size: t.size, emoji: t.emoji, icon: t.icon, visible: t.visible, zoom: t.zoom };
    }
    s.scale = P.controls.scale;
    s.weapons = {};
    for (i = 0; i < P.weapons.length; i++) {
      w = P.weapons[i];
      s.weapons[w.id] = { emo: w.emo, icon: w.icon, color: w.color, hold: w.hold, scale: w.scale };
    }
    s.crates = P.map.crates;
    s.lobby = {};
    ((P.lobby && P.lobby.buttons) || []).forEach(function (b) {
      s.lobby[b.uid] = { x: b.x, y: b.y, w: b.w, h: b.h, icon: b.icon, emoji: b.emoji, color: b.color, visible: b.visible, label: b.label };
    });
    s.opt = {
      optVer: OPT_VER,
      climb: OPT.climb, stepH: OPT.stepH, doorStep: OPT.doorStep, doorFix: OPT.doorFix,
      freeWater: OPT.freeWater, stickyAim: OPT.stickyAim, faceMove: OPT.faceMove,
      botLOS: OPT.botLOS, faceFlip: OPT.faceFlip, bodyLock: OPT.bodyLock, zoneBotMul: OPT.zoneBotMul,
      zoneRamp: OPT.zoneRamp, playerWall: OPT.playerWall, gunFlip: OPT.gunFlip,
      exactWalls: OPT.exactWalls, ctxButtons: OPT.ctxButtons, botDrop: OPT.botDrop,
      headMul: OPT.headMul, directAim: OPT.directAim, meshMove: OPT.meshMove,
      aimAssist: OPT.aimAssist, aimAdsOnly: OPT.aimAdsOnly, aimCone: OPT.aimCone,
      aimPow: OPT.aimPow, fireBtnOnly: OPT.fireBtnOnly,
      parallax: OPT.parallax, shotFx: OPT.shotFx, holdFix: OPT.holdFix,
      holdClear: OPT.holdClear, holdPush: OPT.holdPush, holdOut: OPT.holdOut, holdUp: OPT.holdUp,
      itemRails: OPT.itemRails, nadeFuse: OPT.nadeFuse, nadeSpeed: OPT.nadeSpeed,
      fpsFix: OPT.fpsFix, camNear: OPT.camNear, fpsClear: OPT.fpsClear,
      nadeR: OPT.nadeR, nadeDmg: OPT.nadeDmg,
      sfxSniperSec: OPT.sfxSniperSec, sfxRpgSec: OPT.sfxRpgSec,
      chuteAcc: OPT.chuteAcc, chuteDamp: OPT.chuteDamp, customSfx: OPT.customSfx,
      sfxPistolSec: OPT.sfxPistolSec, sfxRifleSec: OPT.sfxRifleSec, menuVol: OPT.menuVol,
      thumbSide: OPT.thumbSide, meshGround: OPT.meshGround,
      stickRun: OPT.stickRun, stickRunAt: OPT.stickRunAt,
      matchMin: OPT.matchMin, voice: OPT.voice,
      voiceMic: OPT.voiceMic, perOrient: OPT.perOrient, sens: OPT.sens,
      adsSens: OPT.adsSens, smooth: OPT.smooth, online: OPT.online,
      netTarget: OPT.netTarget, netWait: OPT.netWait,
      ambient: OPT.ambient, ocean: OPT.ocean,
      trophies: OPT.trophies, slimHud: OPT.slimHud, badge: OPT.badge
    };
    SAVED = s; save();
    applyLiveSoon();                 /* أي تعديل ينعكس فوراً على أزرار اللعبة الجارية */
  }

  var _liveT = 0;
  /* ترتيب الوضع الحالي (طول/عرض) على أزرار اللعب — يعمل حتى في النسخة النهائية */
  function applyOrientLayout() {
    var s = load();
    var o = innerWidth >= innerHeight ? "land" : "port";
    var src = o === "port" ? s.layoutPort : s.layout;
    if (!src) src = o === "port" ? s.layout : s.layoutPort;
    if (!src) return;
    P.controls.layout.forEach(function (c) {
      var f = src[c.id];
      if (f) GEO_KEYS.forEach(function (k) { if (f[k] !== undefined) c[k] = f[k]; });
    });
  }
  var _liveOr = null;
  function watchOrientLive() {
    _liveOr = innerWidth >= innerHeight ? "land" : "port";
    function tick() {
      if (!OPT.perOrient) return;
      var o = innerWidth >= innerHeight ? "land" : "port";
      if (o === _liveOr) return;
      _liveOr = o;
      applyOrientLayout();
      applyLiveSoon();
    }
    addEventListener("resize", tick);
    addEventListener("orientationchange", function () { setTimeout(tick, 280); });
  }

  function applyLiveSoon() {
    clearTimeout(_liveT);
    _liveT = setTimeout(function () { try { applyLive(); } catch (e) { } }, 120);
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
      el("button", { id: "rs-flip", text: "🔄 اقلب الشاشة", onclick: flipOrient }),
      el("button", { id: "rs-reset", title: "استعادة الافتراضي", onclick: resetAll, text: "↺" }),
      el("button", { id: "rs-dl", title: "حمّل اللعبة النهائية", onclick: exportGame, text: "⬇️ حمّل اللعبة" }),
      el("button", { id: "rs-start", onclick: start, text: "▶️ جرّب" })
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

    [["btn", "1️⃣ الأزرار"], ["crate", "2️⃣ الصناديق"], ["stat", "📊 العدّادات"],
    ["lobby", "🏠 الواجهة"], ["weap", "🔫 الأسلحة"], ["play", "⚙️ اللعب"]].forEach(function (t) {
      UI.tabs.appendChild(el("button", { class: "rs-tab", "data-t": t[0], text: t[1], onclick: function () { setTab(t[0]); } }));
    });
    var _lastOr = orient();
    function onResize() {
      if (!UI || !UI.root.classList.contains("on")) return;
      if (OPT.perOrient && editOrient === null) {
        var o = innerWidth >= innerHeight ? "land" : "port";
        if (o !== _lastOr) {
          _lastOr = o;
          var st = load(), src = o === "port" ? st.layoutPort : st.layout;
          if (!src) src = o === "port" ? st.layout : st.layoutPort;
          if (src) P.controls.layout.forEach(function (c) {
            var f = src[c.id];
            if (f) GEO_KEYS.forEach(function (k) { if (f[k] !== undefined) c[k] = f[k]; });
          });
          toast(o === "port" ? "📱 انتقلتَ لترتيب الوضع العمودي" : "🖥️ انتقلتَ لترتيب الوضع الأفقي");
          renderPanel();
        }
      }
      applyStageBox();
      renderStage();
      syncFlipBtn();
    }
    addEventListener("resize", onResize);
    addEventListener("orientationchange", function () { setTimeout(onResize, 260); });
    setTab("btn");
    syncFlipBtn();
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
    else if (t === "lobby") renderLobbyTab();
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
    node.__rsType = "btn"; node.__rsId = cfg.id;
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
    node.__rsType = "stat"; node.__rsId = cfg.id;
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
    node.__rsType = "badge"; node.__rsId = "badge";
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
    /* «بلا إطار»: الصورة وحدها بلا دائرة ولا حدود — مظهر احترافي */
    if (node.classList) node.classList.toggle("nf", !!(cfg && cfg.bare));
    if (cfg && cfg.bare) { body.style.background = ""; body.style.borderColor = ""; body.style.boxShadow = ""; return; }
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

  /* لا نُعيد بناء المسرح هنا إطلاقاً — إعادة البناء أثناء الضغط
     كانت تحذف العنصر الذي تسحبه فيتعطّل السحب تماماً. */
  function select(type, id) {
    sel = { type: type, id: id };
    var ws = UI.stage.querySelectorAll(".rs-w");
    for (var i = 0; i < ws.length; i++)
      ws[i].classList.toggle("sel", ws[i].__rsType === type && ws[i].__rsId === id);
    renderPanel();
    openPanel(true);
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
      b.appendChild(el("div", {
        class: "rs-hint",
        text: "اسحب العنصر بإصبعك لتغيير مكانه، أو اضغط عليه لفتح خياراته." +
          (OPT.perOrient ? ("  •  تُحرّر الآن ترتيب الوضع " + (orient() === "port" ? "العمودي 📱" : "الأفقي 🖥️") + ".") : "")
      }));
      if (OPT.perOrient) b.appendChild(el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip" + (editOrient === "land" ? " on" : ""), text: "🖥️ أفقي",
          onclick: function () { setEditOrient("land"); }
        }),
        el("button", {
          class: "rs-chip" + (editOrient === "port" ? " on" : ""), text: "📱 عمودي",
          onclick: function () { setEditOrient("port"); }
        }),
        el("button", {
          class: "rs-chip", text: "⇄ انسخ الترتيب من الوضع الآخر", onclick: function () {
            var st = load(), src = orient() === "port" ? st.layout : st.layoutPort;
            if (!src) { toast("لا يوجد ترتيب محفوظ للوضع الآخر"); return; }
            P.controls.layout.forEach(function (c) {
              var f = src[c.id];
              if (f) GEO_KEYS.forEach(function (k) { if (f[k] !== undefined) c[k] = f[k]; });
            });
            persist(); renderStage(); renderPanel(); toast("تم النسخ ✔");
          }
        })
      ]));
      if (tab === "btn") b.appendChild(el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip dz", text: "🚫 احذف الإطار عن كل الأزرار", onclick: function () {
            P.controls.layout.forEach(function (c) { if (c.id !== "move" && c.id !== "aim") c.bare = true; });
            persist(); renderStage(); renderPanel(); toast("اختفت الدوائر — الصور وحدها ✔");
          }
        }),
        el("button", {
          class: "rs-chip", text: "🔘 أعِد الإطار للكل", onclick: function () {
            P.controls.layout.forEach(function (c) { c.bare = false; });
            persist(); renderStage(); renderPanel();
          }
        })
      ]));
      var q = el("div", { class: "rs-chips" });
      (tab === "btn" ? P.controls.layout : P.controls.stats).forEach(function (c) {
        q.appendChild(el("button", { class: "rs-chip", text: (isUrl(c.icon) ? "🖼️" : (c.emoji || "•")) + " " + ((tab === "btn" ? BTN : STAT)[c.id] || c.id), onclick: function () { select(tab, c.id); } }));
      });
      if (tab === "stat") q.appendChild(el("button", { class: "rs-chip", text: "🔫 شارة السلاح المحمول", onclick: function () { select("badge", "badge"); } }));
      b.appendChild(q);
      if (tab === "btn") b.appendChild(el("button", {
        class: "rs-big", style: "margin-top:10px",
        text: "التالي ← 2️⃣ ترتيب الصناديق على الخريطة",
        onclick: function () { setTab("crate"); }
      }));
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
  function iconSection(cfg, onChange, noFrameOpt) {
    var box = el("div", {});
    box.appendChild(el("h4", { class: "rs-h4", text: "🖼️ أيقونتك الخاصة" }));
    box.appendChild(el("div", { class: "rs-hint", text: "ارفع أي صورة من جهازك (PNG بخلفية شفافة أفضل). تُحفظ في مكتبتك لتستعملها لأي زر آخر." }));
    box.appendChild(el("div", { class: "rs-row" }, [
      upload("📁 ارفع صورة من جهازك", function (url) { cfg.icon = url; cfg.bare = true; addMyIcon(url); onChange(); }, true),
      isUrl(cfg.icon) ? el("button", { class: "rs-chip dz", text: "🗑️ أزل الصورة", onclick: function () { cfg.icon = null; onChange(); } }) : null
    ]));
    if (!noFrameOpt && cfg.id !== "move" && cfg.id !== "aim") {
      box.appendChild(el("div", { class: "rs-row" }, [
        el("span", { class: "rs-lab", text: "إطار الزر" }),
        el("button", {
          class: "rs-chip " + (cfg.bare ? "dz" : "ok"),
          text: cfg.bare ? "🚫 بلا إطار (الصورة وحدها)" : "🔘 دائرة حول الأيقونة",
          onclick: function () { cfg.bare = !cfg.bare; onChange(); }
        })
      ]));
    }

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
    /* <label> يفتح مُنتقي الملفات أصلاً بلا جافاسكربت — أضمن على الجوال */
    var lab = el("label", { class: "rs-chip up" + (big ? " ok big" : ""), text: label });
    lab.appendChild(inp);
    return lab;
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
    P.weapons.forEach(function (w, i) {
      var f = FACTORY.weapons[i];
      w.emo = f.emo; w.icon = f.icon; w.color = AMMO_COL[w.ammo] || "#ffc21a";
      w.hold = JSON.parse(JSON.stringify(f.hold)); w.scale = f.scale || 1;
    });
    P.map.crates = clone(FACTORY.crates);
    OPT.climb = "strict"; OPT.stepH = 0.28; OPT.doorStep = 0.75; OPT.doorFix = true;
    OPT.freeWater = true; OPT.stickyAim = true; OPT.faceMove = false; OPT.botLOS = true;
    OPT.faceFlip = false; OPT.bodyLock = true; OPT.zoneBotMul = 3; OPT.zoneRamp = 4; OPT.playerWall = true;
    OPT.sens = 1; OPT.adsSens = 0.55; OPT.smooth = 0.35;
    OPT.gunFlip = true; OPT.exactWalls = true; OPT.matchMin = 22;
    OPT.ctxButtons = true; OPT.botDrop = true; OPT.headMul = 2.2; OPT.directAim = false;
    OPT.aimAssist = true; OPT.aimAdsOnly = true; OPT.aimCone = 0.9; OPT.aimPow = 1;
    OPT.fireBtnOnly = true; OPT.parallax = true; OPT.shotFx = true;
    OPT.holdFix = true; OPT.holdClear = 0.06; OPT.holdPush = 0.04; OPT.holdOut = 0.07; OPT.holdUp = 0;
    OPT.itemRails = true; OPT.nadeFuse = 3; OPT.nadeSpeed = 17; OPT.nadeR = 7.5; OPT.nadeDmg = 115;
    OPT.fpsFix = true; OPT.camNear = 0.08; OPT.fpsClear = 0.1;
    OPT.sfxSniperSec = 1.6; OPT.sfxRpgSec = 2.4;
    OPT.meshMove = true; OPT.chuteAcc = 34; OPT.chuteDamp = 2.2;
    OPT.customSfx = true; OPT.sfxPistolSec = 1.0; OPT.sfxRifleSec = 0.3; OPT.menuVol = 0.45;
    OPT.thumbSide = true; OPT.meshGround = true; OPT.stickRun = true; OPT.stickRunAt = 0.86;
    OPT.voice = true; OPT.voiceMic = true; OPT.perOrient = true;
    OPT.online = false; OPT.netTarget = 25; OPT.netWait = 300;
    P.lobby.buttons = clone(FACTORY.lobby);
    OPT.ambient = 0.55; OPT.ocean = true; OPT.trophies = false; OPT.slimHud = true;
    OPT.badge = { x: 0.5, y: 0.19, size: 0.85, visible: false };
    sel = null; persist(); setTab(tab);
  }

  /* ============================================================
     1.5) واجهة اللعبة (أزرار اللوبي)
     ============================================================ */

  var LB_KIND = {
    play: "زرّ اللعب", shop: "المتجر", brawlers: "الأبطال", skins: "الأزياء",
    quests: "المهام", news: "الأخبار", friends: "الأصدقاء", club: "الاتحاد",
    settings: "الإعدادات"
  };
  var lbSel = null;

  function lbButtons() { return (P.lobby && P.lobby.buttons) || []; }

  function renderLobbyTab() {
    var s = UI.sheet; s.innerHTML = "";
    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🏠 أزرار واجهة اللعبة" }),
      el("div", { class: "rs-hint", text: "هذه هي الأزرار التي تظهر للاعب أول ما يدخل. اسحبها داخل المعاينة لتغيير مكانها، أو أخفِ ما لا تحتاجه. زر «اللعب» لا يمكن إخفاؤه." })
    ]));

    /* معاينة الواجهة بنسبة 16:9 */
    var pv = el("div", { id: "rs-lbpv" });
    s.appendChild(pv);
    s.appendChild(el("div", { class: "rs-card", id: "rs-lbsel" }));

    requestAnimationFrame(function () { drawLobbyPreview(pv); lbPanel(); });
  }

  function drawLobbyPreview(pv) {
    pv.innerHTML = "";
    var r = pv.getBoundingClientRect(), W = r.width, H = r.height;
    lbButtons().forEach(function (b) {
      var n = el("div", { class: "lbb" + (lbSel === b.uid ? " sel" : "") + (b.visible ? "" : " off") });
      n.style.background = "linear-gradient(180deg," + (b.color || "#c56bff") + "," + hexA(b.color || "#c56bff", 0.55) + ")";
      n.style.width = (b.w * W) + "px";
      n.style.height = (b.h * H) + "px";
      n.style.left = (b.x * W - b.w * W / 2) + "px";
      n.style.top = (b.y * H - b.h * H / 2) + "px";
      n.appendChild(isUrl(b.icon) ? el("img", { src: b.icon }) : el("span", { text: b.emoji || "•" }));
      n.appendChild(el("i", { text: b.label || LB_KIND[b.kind] || b.kind }));
      lbDrag(n, b, W, H, pv);
      pv.appendChild(n);
    });
  }

  function lbDrag(node, b, W, H, pv) {
    var st = null;
    node.style.touchAction = "none";
    node.addEventListener("pointerdown", function (e) {
      e.preventDefault(); node.setPointerCapture(e.pointerId);
      st = { px: e.clientX, py: e.clientY, x: b.x, y: b.y };
      lbSel = b.uid;
      var all = pv.querySelectorAll(".lbb");
      for (var i = 0; i < all.length; i++) all[i].classList.remove("sel");
      node.classList.add("sel");
      lbPanel();
    });
    node.addEventListener("pointermove", function (e) {
      if (!st) return;
      b.x = clamp(st.x + (e.clientX - st.px) / W, 0.03, 0.97);
      b.y = clamp(st.y + (e.clientY - st.py) / H, 0.05, 0.95);
      node.style.left = (b.x * W - b.w * W / 2) + "px";
      node.style.top = (b.y * H - b.h * H / 2) + "px";
    });
    function up() { if (st) { st = null; persist(); } }
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function lbPanel() {
    var box = document.getElementById("rs-lbsel"); if (!box) return;
    box.innerHTML = "";
    var b = lbButtons().filter(function (q) { return q.uid === lbSel; })[0];
    if (!b) {
      box.appendChild(el("div", { class: "rs-hint", text: "اضغط على أي زر في المعاينة لتعديله." }));
      var q2 = el("div", { class: "rs-chips" });
      lbButtons().forEach(function (x) {
        q2.appendChild(el("button", {
          class: "rs-chip" + (x.visible ? "" : " dz"), text: (x.emoji || "•") + " " + (x.label || LB_KIND[x.kind] || x.kind),
          onclick: function () { lbSel = x.uid; drawLobbyPreview(document.getElementById("rs-lbpv")); lbPanel(); }
        }));
      });
      box.appendChild(q2);
      return;
    }
    var pv = document.getElementById("rs-lbpv");
    function redraw() { persist(); drawLobbyPreview(pv); lbPanel(); }

    box.appendChild(el("h4", { text: "✏️ " + (b.label || LB_KIND[b.kind] || b.kind) }));
    box.appendChild(el("div", { class: "rs-chips" }, [
      b.kind === "play"
        ? el("div", { class: "rs-hint", text: "زرّ اللعب أساسي ولا يُخفى." })
        : el("button", {
          class: "rs-chip " + (b.visible ? "ok" : "dz"), text: b.visible ? "👁️ ظاهر" : "🚫 مخفي",
          onclick: function () { b.visible = !b.visible; redraw(); }
        }),
      el("button", {
        class: "rs-chip", text: "↺ افتراضي", onclick: function () {
          var f = FACTORY.lobby.filter(function (q) { return q.uid === b.uid; })[0];
          if (f) for (var k in f) b[k] = clone(f[k]);
          redraw();
        }
      })
    ]));
    box.appendChild(row("العرض", slider(0.04, 0.45, 0.005, b.w, function (v) { b.w = v; persist(); drawLobbyPreview(pv); })));
    box.appendChild(row("الطول", slider(0.05, 0.4, 0.005, b.h, function (v) { b.h = v; persist(); drawLobbyPreview(pv); })));
    box.appendChild(row("تحريك دقيق", (function () {
      var w = el("div", { class: "rs-chips" });
      [["◀", -0.01, 0], ["▶", 0.01, 0], ["▲", 0, -0.01], ["▼", 0, 0.01]].forEach(function (d) {
        w.appendChild(el("button", {
          class: "rs-chip", text: d[0], onclick: function () {
            b.x = clamp(b.x + d[1], 0.03, 0.97); b.y = clamp(b.y + d[2], 0.05, 0.95);
            persist(); drawLobbyPreview(pv);
          }
        }));
      });
      return w;
    })()));

    var cw = el("div", { class: "rs-cols" });
    PALETTE.forEach(function (c) {
      var i2 = el("i", { style: "background:" + c });
      if ((b.color || "").toLowerCase() === c) i2.classList.add("on");
      i2.onclick = function () { b.color = c; redraw(); };
      cw.appendChild(i2);
    });
    var cin = el("input", { type: "color", value: b.color || "#c56bff", style: "width:34px;height:30px;border:0;background:none;padding:0" });
    cin.oninput = function () { b.color = cin.value; persist(); drawLobbyPreview(pv); };
    cw.appendChild(cin);
    box.appendChild(row("اللون", cw));

    var nin = el("input", { type: "text", value: b.label || "", maxlength: "14", class: "rs-txt" });
    nin.oninput = function () { b.label = nin.value; persist(); drawLobbyPreview(pv); };
    box.appendChild(row("الاسم", nin));

    box.appendChild(iconSection({
      id: b.kind,
      get icon() { return b.icon; }, set icon(v) { b.icon = v; },
      get emoji() { return b.emoji; }, set emoji(v) { b.emoji = v; }
    }, redraw, true));
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
        el("button", {
          class: "rs-chip " + (OPT.thumbSide ? "ok" : ""),
          text: OPT.thumbSide ? "🔫 صورة جانبية كاملة (كما في ببجي)" : "🔄 صورة مائلة",
          onclick: function () { OPT.thumbSide = !OPT.thumbSide; persist(); toast("تُطبَّق عند بدء المباراة القادمة", 2600); renderWeapons(); }
        }),
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
      card.appendChild(iconSection(proxy, function () { persist(); renderWeapons(); }, true));

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

      card.appendChild(el("h4", { class: "rs-h4", text: "✋ وضع السلاح في اليد (منظور الشخص الثالث)" }));
      card.appendChild(el("div", { class: "rs-hint", text: "إذا لم يظهر السلاح كاملاً أو دخل داخل الجسم، عدّل هذه المقادير." }));
      var HOLD = [["px", "يمين/يسار", -0.6, 0.6, 0.01], ["py", "أعلى/أسفل", -0.6, 0.6, 0.01],
      ["pz", "أمام/خلف", -0.8, 0.8, 0.01], ["ry", "دوران", -3.2, 3.2, 0.05], ["rz", "ميل", -3.2, 3.2, 0.05]];
      HOLD.forEach(function (h) {
        card.appendChild(row(h[1], slider(h[2], h[3], h[4], w.hold[h[0]] || 0, function (v) {
          w.hold[h[0]] = v; persist(); applyGunLive();
        })));
      });
      card.appendChild(row("الحجم", slider(0.5, 2.2, 0.05, w.scale || 1, function (v) { w.scale = v; persist(); applyGunLive(); })));
      card.appendChild(el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip", text: "↺ أعد ضبط اليد", onclick: function () {
            var f = FACTORY.weapons.filter(function (q) { return q.id === w.id; })[0];
            if (f) { w.hold = JSON.parse(JSON.stringify(f.hold)); w.scale = f.scale || 1; }
            persist(); renderWeapons(); applyGunLive();
          }
        })
      ]));
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

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "2️⃣ الخطوة الثانية — وزّع الصناديق على الخريطة" }),
      el("div", { class: "rs-hint", text: "الخريطة تبدأ فارغة تماماً من الصناديق. ادخل المحرّر ثلاثي الأبعاد وحلّق فوق الخريطة بكاميرا حرّة، وضع كل صندوق في المكان الذي تريده بالضبط — مثل محرّك ألعاب حقيقي. ثم ارجع واضغط «ابدأ»." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip dz", text: "🧹 امسح كل الصناديق",
          onclick: function () { P.map.crates = []; MAP.sel = null; persist(); renderCrates(); toast("الخريطة صارت فارغة"); }
        }),
        el("button", {
          class: "rs-chip", text: "📦 أعِد التوزيع الأصلي (" + FACTORY.crates.length + ")",
          onclick: function () { P.map.crates = clone(FACTORY.crates); MAP.sel = null; persist(); renderCrates(); }
        })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card hero" }, [
      el("h4", { text: "🏗️ محرّر البناء ثلاثي الأبعاد" }),
      el("div", { class: "rs-hint", text: "كاميرا طائرة حرّة: العصا اليسرى للتحرّك، اليمنى للنظر، 🔼🔽 للصعود والنزول، ⚡ لتغيير السرعة. الكاميرا لا تخترق الجدران ولا الأرض. صوّب على المكان ثم «📦 ضع». لحذف صندوق: «✋ اختر» ثم «🗑️ احذف المحدَّد». عند الانتهاء: «💾 حفظ وخروج»." }),
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
      el("h4", { text: "🎵 أصواتك المرفوعة" }),
      el("div", { class: "rs-hint", text: "طلقة المسدّس/الشوزن/القنّاص، رشقة الرشّاش، صوت التعبئة لكل الأسلحة، وموسيقى القائمة — كلها من ملفاتك. لكل طلقة يُقتطع جزء قصير من المقطع ويُعاد من أوله، فلا يكمل المقطع للنهاية." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.customSfx ? "ok" : "dz"),
          text: OPT.customSfx ? "✅ أصواتي مُفعَّلة" : "🚫 الأصوات المولَّدة",
          onclick: function () { OPT.customSfx = !OPT.customSfx; persist(); renderPlay(); }
        })
      ]),
      row("طلقة المسدّس (ث)", slider(0.15, 2, 0.05, OPT.sfxPistolSec, function (v) { OPT.sfxPistolSec = v; persist(); })),
      row("طلقة الرشّاش (ث)", slider(0.08, 1, 0.02, OPT.sfxRifleSec, function (v) { OPT.sfxRifleSec = v; persist(); })),
      row("طلقة القنص (ث)", slider(0.3, 2, 0.1, OPT.sfxSniperSec, function (v) { OPT.sfxSniperSec = v; persist(); })),
      row("انطلاق الـ RPG (ث)", slider(0.5, 2.6, 0.1, OPT.sfxRpgSec, function (v) { OPT.sfxRpgSec = v; persist(); })),
      row("موسيقى القائمة", slider(0, 1, 0.05, OPT.menuVol, function (v) { OPT.menuVol = v; persist(); if (SFX.menuGain) SFX.menuGain.gain.value = v; }))
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
      el("h4", { text: "🏃 الجري بإصبع واحد" }),
      el("div", { class: "rs-hint", text: "ادفع عصا التحرّك إلى آخرها فيبدأ الجري فوراً بلا حاجة لزر ثانٍ — وإن رجعت قليلاً يعود للمشي." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.stickRun ? "ok" : "dz"),
          text: OPT.stickRun ? "✅ دفع العصا للنهاية = جري" : "🚫 زرّ الجري فقط",
          onclick: function () { OPT.stickRun = !OPT.stickRun; persist(); renderPlay(); }
        })
      ]),
      row("عتبة الجري", slider(0.6, 0.98, 0.02, OPT.stickRunAt, function (v) { OPT.stickRunAt = v; persist(); })),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.meshGround ? "ok" : "dz"),
          text: OPT.meshGround ? "✅ الوقوف على الجسور والأرضيات الحقيقية" : "🚫 أرضية تقريبية",
          onclick: function () { OPT.meshGround = !OPT.meshGround; persist(); renderPlay(); }
        })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🧠 الأعداء والشخصية" }),
      el("div", { class: "rs-chips" }, [
        el("button", { class: "rs-chip " + (OPT.botLOS ? "ok" : "dz"), text: OPT.botLOS ? "✅ لا إطلاق عبر الجدران" : "🚫 الأعداء يخترقون الجدران", onclick: function () { OPT.botLOS = !OPT.botLOS; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.faceMove ? "dz" : "ok"), text: OPT.faceMove ? "🚫 الجسم كلّه يلتفّ للحركة (يقلب السلاح)" : "✅ الجذع للتصويب والقدمان للحركة", onclick: function () { OPT.faceMove = !OPT.faceMove; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.doorFix ? "ok" : "dz"), text: OPT.doorFix ? "✅ دخول البيوت بدل الصعود فوقها" : "🚫 السلوك القديم", onclick: function () { OPT.doorFix = !OPT.doorFix; persist(); renderPlay(); } }),
        el("button", { class: "rs-chip " + (OPT.trophies ? "" : "ok"), text: OPT.trophies ? "🏆 الكؤوس والعملات ظاهرة" : "🚫 الكؤوس والعملات مخفية", onclick: function () { OPT.trophies = !OPT.trophies; persist(); renderPlay(); } })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🎯 التحكّم والتصويب" }),
      el("div", { class: "rs-hint", text: "حساسية أقل أثناء التصويب + تنعيم = تحكّم سلس مثل الألعاب الاحترافية. زر «التقريب 🔭» يُخرجك من التصويب بضغطة." }),
      row("حساسية النظر", slider(0.3, 2.5, 0.05, OPT.sens, function (v) { OPT.sens = v; persist(); })),
      row("حساسية التصويب", slider(0.2, 1.5, 0.05, OPT.adsSens, function (v) { OPT.adsSens = v; persist(); })),
      row("التنعيم", slider(0, 0.75, 0.05, OPT.smooth, function (v) { OPT.smooth = v; persist(); })),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.playerWall ? "ok" : "dz"),
          text: OPT.playerWall ? "✅ رصاصك لا يخترق الجدران" : "🚫 رصاصك يخترق الجدران",
          onclick: function () { OPT.playerWall = !OPT.playerWall; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.meshMove ? "ok" : "dz"),
          text: OPT.meshMove ? "✅ حركة تصطدم بالمباني فعلياً" : "🚫 حركة تقريبية",
          onclick: function () { OPT.meshMove = !OPT.meshMove; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.exactWalls ? "ok" : ""),
          text: OPT.exactWalls ? "🎯 اصطدام دقيق للرصاص" : "⚡ اصطدام تقريبي (أسرع)",
          onclick: function () { OPT.exactWalls = !OPT.exactWalls; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.gunFlip ? "ok" : "dz"),
          text: OPT.gunFlip ? "✅ السلاح يشير للأمام" : "🚫 اتجاه السلاح الأصلي",
          onclick: function () { OPT.gunFlip = !OPT.gunFlip; persist(); applyGunLive(); renderPlay(); }
        }),
      ]),
      row("ضرر إصابة الرأس", slider(1, 4, 0.1, OPT.headMul, function (v) { OPT.headMul = v; persist(); })),
      el("div", { class: "rs-hint", text: "الإصابة صارت تُحسب على كرتين: رأس (نصف قطر 0.34م) وجسم (0.62م)، ويُفحص الجدار حتى نقطة الإصابة نفسها — فإن كان الجدار منخفضاً والرأس ظاهراً تُحسب إصابة رأس، وإن كان يحجبه فلا إصابة. وإن كان العدو ملتصقاً بزاوية جدار وتراه الكاميرا فعلاً، تُحتسب الإصابة — ما تراه عينك تصيبه يدك." })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🧲 مساعد التصويب وزرّ الضرب" }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.fireBtnOnly ? "ok" : "dz"),
          text: OPT.fireBtnOnly ? "✅ لا يطلق إلا بزرّ الضرب" : "🚫 لمسة الشاشة تُطلق أيضاً",
          onclick: function () { OPT.fireBtnOnly = !OPT.fireBtnOnly; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.aimAssist && !OPT.directAim ? "ok" : "dz"),
          text: OPT.aimAssist && !OPT.directAim ? "🧲 مساعد التصويب مفعّل" : "🎯 بلا مساعدة إطلاقاً",
          onclick: function () {
            if (OPT.aimAssist && !OPT.directAim) { OPT.aimAssist = false; OPT.directAim = true; }
            else { OPT.aimAssist = true; OPT.directAim = false; }
            persist(); renderPlay();
          }
        }),
        el("button", {
          class: "rs-chip " + (OPT.aimAdsOnly ? "ok" : ""),
          text: OPT.aimAdsOnly ? "🔭 عند التصويب فقط" : "♾️ في كل الأوقات",
          onclick: function () { OPT.aimAdsOnly = !OPT.aimAdsOnly; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.parallax ? "ok" : "dz"),
          text: OPT.parallax ? "✅ الرصاصة تذهب حيث تشير العلامة" : "🚫 اتجاه الكاميرا الخام",
          onclick: function () { OPT.parallax = !OPT.parallax; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.shotFx ? "ok" : "dz"),
          text: OPT.shotFx ? "✨ خيط رصاص وصاروخ RPG" : "▫️ الخط الرفيع الأصلي",
          onclick: function () { OPT.shotFx = !OPT.shotFx; persist(); renderPlay(); }
        })
      ]),
      row("قوّة القفل", slider(0, 1, 0.05, OPT.aimPow, function (v) { OPT.aimPow = v; persist(); })),
      row("إخراج مؤخّرة السلاح", slider(0, 0.4, 0.02, OPT.holdPush, function (v) { OPT.holdPush = v; persist(); applyGunLive(); })),
      row("إبعاد السلاح عن الجسم", slider(0, 0.3, 0.01, OPT.holdOut, function (v) { OPT.holdOut = v; persist(); applyGunLive(); })),
      row("اتساع المخروط", slider(0.75, 0.99, 0.01, OPT.aimCone, function (v) { OPT.aimCone = v; persist(); })),
      el("div", {
        class: "rs-hint", text: "القفل الكامل (1) يوجّه الرصاصة إلى العدو مباشرةً ما دام داخل المخروط ولا جدار بينكما — " +
          "المخروط الحالي ≈ " + Math.round(Math.acos(clamp(OPT.aimCone, -1, 1)) * 180 / Math.PI) + "° حول مركز الشاشة. " +
          "المساعدة لا تعمل أبداً على عدوٍّ خلف جدار."
      })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🎒 العلاجات والقنابل" }),
      el("div", { class: "rs-hint", text: "أربعة علاجات على يمين الشاشة (ضمادة · حقيبة إسعاف · درع · مشروب طاقة) والقنبلة على اليسار — كما في ببجي. تجدها في الصناديق وفي غنائم من تقتلهم." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.itemRails ? "ok" : "dz"),
          text: OPT.itemRails ? "✅ الشريطان ظاهران" : "🚫 مخفيّان",
          onclick: function () {
            OPT.itemRails = !OPT.itemRails; persist(); renderPlay();
            if (!OPT.itemRails && RAILS) { RAILS.wrap.remove(); RAILS = null; }
          }
        })
      ]),
      row("فتيل القنبلة (ث)", slider(1.5, 6, 0.5, OPT.nadeFuse, function (v) { OPT.nadeFuse = v; persist(); })),
      row("قوّة الرمي", slider(8, 30, 1, OPT.nadeSpeed, function (v) { OPT.nadeSpeed = v; persist(); })),
      row("نصف قطر الانفجار", slider(3, 14, 0.5, OPT.nadeR, function (v) { OPT.nadeR = v; persist(); })),
      row("ضرر الانفجار", slider(40, 200, 5, OPT.nadeDmg, function (v) { OPT.nadeDmg = v; persist(); })),
      el("div", { class: "rs-hint", text: "الضرر يتناقص كلما بَعُد العدو عن مركز الانفجار، ولا يمرّ عبر الجدران." })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🪂 التحكّم تحت المظلّة" }),
      el("div", { class: "rs-hint", text: "ارفع الاندفاع واخفض الكبح لتنطلق بسرعة نحو المكان الذي تريده." }),
      row("قوّة الاندفاع", slider(10, 70, 2, OPT.chuteAcc, function (v) { OPT.chuteAcc = v; persist(); })),
      row("الكبح", slider(1, 5, 0.1, OPT.chuteDamp, function (v) { OPT.chuteDamp = v; persist(); })),
      el("div", { class: "rs-hint", text: "السرعة القصوى ≈ الاندفاع ÷ الكبح  (الحالية ≈ " + Math.round(OPT.chuteAcc / OPT.chuteDamp) + " م/ث)" })
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "📦 الغنائم والأزرار السياقية" }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.ctxButtons ? "ok" : ""),
          text: OPT.ctxButtons ? "✅ زرّا الفتح/الالتقاط يظهران عند الحاجة" : "👁️ يظهران دائماً",
          onclick: function () { OPT.ctxButtons = !OPT.ctxButtons; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.botDrop ? "ok" : "dz"),
          text: OPT.botDrop ? "✅ الأعداء يُسقطون غنائمهم" : "🚫 لا يسقط شيء",
          onclick: function () { OPT.botDrop = !OPT.botDrop; persist(); renderPlay(); }
        })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🎤 الميكروفون مع الأصدقاء" }),
      el("div", { class: "rs-hint", text: "صوت مباشر داخل نفس الروم فقط — يمرّ على نفس اتصال WebRTC بلا خادم. زر 🎤 داخل اللعبة يدور بين: ميكروفون مفتوح ← استماع فقط ← إغلاق تام." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.voice ? "ok" : "dz"), text: OPT.voice ? "✅ الميكروفون مُفعَّل" : "🚫 بلا ميكروفون",
          onclick: function () { OPT.voice = !OPT.voice; persist(); renderPlay(); }
        }),
        el("button", {
          class: "rs-chip " + (OPT.voiceMic ? "ok" : ""), text: OPT.voiceMic ? "🎤 يبدأ مفتوحاً" : "👂 يبدأ على استماع فقط",
          onclick: function () { OPT.voiceMic = !OPT.voiceMic; persist(); renderPlay(); }
        })
      ])
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "⏱️ مدّة المباراة" }),
      el("div", { class: "rs-hint", text: "تتحكّم بسرعة تقلّص الزون: كلما زادت الدقائق طالت المباراة." }),
      row("بالدقائق", slider(6, 35, 1, OPT.matchMin, function (v) {
        OPT.matchMin = v; persist();
        if (P.map && P.map.zone) {
          var Z = P.map.zone, ph = Z.phases || 7;
          var T = Math.max(120, v * 60 - (Z.firstDelay || 25));
          Z.holdTime = Math.round((T / ph) * 0.6); Z.shrinkTime = Math.round((T / ph) * 0.4);
        }
      }))
    ]));

    s.appendChild(el("div", { class: "rs-card" }, [
      el("h4", { text: "🌐 اللعب أونلاين" }),
      el("div", { class: "rs-hint", text: "اللعبة تدعم اللعب الجماعي عبر WebRTC: من يضغط «أون لاين» يدخل نفس الروم تلقائياً، ومن يريد صديقاً بعينه يكتبان نفس رمز الروم. عند انتهاء الانتظار أو اكتمال العدد تبدأ المباراة والباقي بوتات." }),
      el("div", { class: "rs-chips" }, [
        el("button", {
          class: "rs-chip " + (OPT.online ? "ok" : ""),
          text: OPT.online ? "🌐 يبدأ على وضع أونلاين" : "🤖 يبدأ ضد الروبوتات",
          onclick: function () { OPT.online = !OPT.online; persist(); renderPlay(); }
        })
      ]),
      row("عدد اللاعبين", slider(2, 25, 1, OPT.netTarget, function (v) { OPT.netTarget = v; persist(); })),
      row("أقصى انتظار (ث)", slider(20, 600, 10, OPT.netWait, function (v) { OPT.netWait = v; persist(); })),
      el("div", { class: "rs-hint", text: "5 دقائق = 300 ثانية. تبدأ المباراة فوراً إذا اكتمل العدد قبل انتهاء الوقت." })
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
        el("button", {
          class: "rs-chip", text: "✏️ غيّر الاسم", onclick: function () {
            playerName("");
            askName(function () { renderPlay(); toast("تم تغيير الاسم ✔"); });
          }
        }),
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

  function applyGunLive() {
    try {
      var g = window.__runtime && window.__runtime.game;
      if (g && g.refreshGunModel) g.refreshGunModel();
    } catch (e) { }
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

  /* ------------------------------------------------------------------
     حركة حقيقية: شعاع عند الصدر (جدار) + شعاع عند الركبة (عائق منخفض)
     + مسبار عمودي لمعرفة أرض الوجهة. يمنع الصعود فوق البيوت،
     ويجعل المرور من الأبواب فورياً بلا أي توقّف.
     ------------------------------------------------------------------ */
  var RAD = 0.42;

  function floorUnder(x, y, z, depth) {
    var d = meshHit(x, y, z, 0, -1, 0, depth || 8);
    return d == null ? null : y - d;
  }

  function meshPass(game, fromX, fromY, fromZ, x, z, step) {
    var dx = x - fromX, dz = z - fromZ, len = Math.hypot(dx, dz);
    if (len < 1e-5) return true;
    dx /= len; dz /= len;
    var need = len + RAD;
    if (meshHit(fromX, fromY + 1.15, fromZ, dx, 0, dz, need) != null) return false;
    if (meshHit(fromX, fromY + 0.70, fromZ, dx, 0, dz, need) != null) return false;
    var low = meshHit(fromX, fromY + 0.22, fromZ, dx, 0, dz, need);
    if (low != null) {
      var f = floorUnder(x, fromY + 1.4, z, 3.2);
      if (f == null || f - fromY > step) return false;
    }
    return true;
  }

  window.__ROYAL_PASS__ = function (game, x, z, curG, tgtG, step) {
    if (OPT.meshMove && TRI && !OPT.build) {
      if (meshPass(game, game.pos.x, game.pos.y, game.pos.z, x, z, step)) { blockStart = 0; return true; }
      return blocked();
    }
    return passHeightfield(game, x, z, curG, tgtG, step);
  };

  window.__ROYAL_MOVE__ = function (game, pos, x, z) {
    if (!OPT.meshMove || !TRI) return game.groundY(x, z, pos.y) - game.groundY(pos.x, pos.z, pos.y) <= 0.55;
    return meshPass(game, pos.x, pos.y, pos.z, x, z, 0.45);
  };

  function passHeightfield(game, x, z, curG, tgtG, step) {
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
  var relaxUntil = 0;
  function blocked() {
    var now = performance.now();
    if (now < relaxUntil) return true;              /* نافذة مرور مفتوحة */
    if (!blockStart) { blockStart = now; return false; }
    if (now - blockStart > 900) {                   /* عالق؟ افتح المرور 1.6 ثانية كاملة */
      relaxUntil = now + 1600; blockStart = 0; return true;
    }
    return false;
  }

  /* الوادي/الماء الداخلي: نسمح بالحركة فيه، ويبقى البحر الخارجي هو الحدّ */
  window.__ROYAL_WATEROK__ = function () { return OPT.freeWater || OPT.build; };

  /* ارتفاع الأرض: لا يقفز فوق سطح البيت عند محاولة الدخول من باب صغير */
  window.__ROYAL_GY__ = function (game, x, z, yArg, g) {
    /* الأرض الحقيقية من مضلّعات الخريطة: تمنع السقوط من فوق الجسور
       والمصاعد وأرضيات البيوت التي لا تراها الخريطة الارتفاعية. */
    if (OPT.meshGround && TRI) {
      var py = (yArg === undefined) ? (game.pos ? game.pos.y : 1e5) : yArg;
      var from = py + 1.5;
      var d = meshHit(x, from, z, 0, -1, 0, 16);
      if (d != null) return from - d;
    }
    if (!OPT.doorFix) return g;
    var Q = game.Q, f = Q.heightAt(x, z), rf = Q.roofAt(x, z);
    if (rf - f < 0.35) return g;                       /* أرض مكشوفة */
    var y = (yArg === undefined) ? (game.pos ? game.pos.y : 1e5) : yArg;
    if (y >= rf - 0.12) return rf;                     /* نحن فعلاً فوق السطح */
    return f;                                          /* غير ذلك: ندخل تحت/داخل المبنى */
  };

  /* الشخصية تنظر لجهة حركتها بدل أن تُدير ظهرها */
  /* المحرّك أصلاً يفصل بين الجذع والقدمين: الجذع يتبع اتجاه التصويب
     (`yaw`) والقدمان تلتفتان لجهة الجري (`moveYaw` المحصور بـ ±60°) —
     تماماً كما في ببجي. لو استبدلنا زاوية الجسم بزاوية الحركة يلتفّ
     الجسم والسلاح معه بعيداً عن علامة التصويب، فيبدو اللاعب ينظر لجهة
     والسلاح لجهة أخرى، ويتبدّل ذلك بين الوقوف والجري. لذلك لا نتدخّل. */
  window.__ROYAL_FACE__ = function (game, camYaw, moveYaw, aiming) {
    if (!OPT.faceFlip) return undefined;                  /* اترك المحرّك يعمل */
    return camYaw + Math.PI;
  };

  /* ------------------------------------------------------------------
     زاوية جسم اللاعب كانت تُكتب من ثلاثة أماكن (تحديث الشخصية، وسطر
     المظلّة، والتنعيم) فتختلف بينها بنصف دورة أحياناً — ومن هنا كان
     الجسم والسلاح ينقلبان «بدل مرات». نجعل لها مصدراً واحداً لا ثاني
     له: زاوية التصويب نفسها، تُكتب كل إطار بلا تنعيم ولا تأخير.
     (القدمان تبقيان تلتفتان لجهة الجري عبر legYaw في المحرّك.) */
  window.__ROYAL_BODY__ = function (ch, yaw) {
    try {
      if (!OPT.bodyLock) return yaw;
      var g = window.__runtime && window.__runtime.game;
      if (!g || g.player !== ch) return yaw;               /* البوتات كما هي */
      if (g.phase !== "ground") return yaw;                /* الطائرة والمظلّة */
      return g.yaw + Math.PI + (OPT.faceFlip ? Math.PI : 0);
    } catch (e) { return yaw; }
  };

  /* ضرر الزون يتدرّج: يبدأ خفيفاً ويشتدّ كلما طال بقاؤك وبَعُدت */
  var outT = 0, outLast = 0;
  window.__ROYAL_ZONE__ = function (game, base, dt, distOut) {
    var now = performance.now();
    if (now - outLast > 400) outT = 0;
    outLast = now;
    outT += dt;
    var ramp = Math.min(1, outT / Math.max(0.3, OPT.zoneRamp));
    var far = 1 + Math.min(1.2, Math.max(0, distOut) / 90);
    return base * (0.18 + 0.82 * ramp * ramp) * far;
  };

  /* ============================================================
     اصطدام دقيق بمضلّعات الخريطة (شبكة تسريع + Möller–Trumbore)
     ============================================================ */
  var TRI = null;

  window.__ROYAL_MAPMESH__ = function (game) {
    TRI = null;
    if (!OPT.exactWalls) return;
    try { TRI = buildTriGrid(game); }
    catch (e) { console.warn("tri grid", e); TRI = null; }
  };

  function buildTriGrid(game) {
    var root = game.mapRoot; if (!root) return null;
    var t0 = performance.now();
    root.updateMatrixWorld(true);

    /* 1) اجمع المثلّثات في إحداثيات العالم */
    var chunks = [], total = 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      var g = o.geometry, pos = g.attributes.position, idx = g.index;
      var n = idx ? idx.count : pos.count;
      if (n < 3) return;
      chunks.push({ m: o.matrixWorld.elements, pos: pos, idx: idx, n: n });
      total += (n / 3) | 0;
    });
    if (!total || total > 900000) return null;

    var V = new Float32Array(total * 9), w = 0;
    var minX = 1e30, maxX = -1e30, minZ = 1e30, maxZ = -1e30;
    function xf(e, x, y, z, out, o2) {
      out[o2] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[o2 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[o2 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    for (var ci = 0; ci < chunks.length; ci++) {
      var c = chunks[ci], pa = c.pos.array, ia = c.idx ? c.idx.array : null;
      for (var k = 0; k + 2 < c.n; k += 3) {
        for (var v = 0; v < 3; v++) {
          var pi = (ia ? ia[k + v] : (k + v)) * 3;
          xf(c.m, pa[pi], pa[pi + 1], pa[pi + 2], V, w + v * 3);
        }
        for (var v2 = 0; v2 < 3; v2++) {
          var X = V[w + v2 * 3], Z = V[w + v2 * 3 + 2];
          if (X < minX) minX = X; if (X > maxX) maxX = X;
          if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
        }
        w += 9;
      }
    }
    var nTri = w / 9;
    if (!nTri) return null;

    /* 2) شبكة تسريع على المستوى الأفقي */
    var G = nTri > 300000 ? 192 : nTri > 80000 ? 128 : 80;
    var sx = (maxX - minX) / G || 1, sz = (maxZ - minZ) / G || 1;
    var count = new Int32Array(G * G);
    function cellRange(i) {
      var ax = V[i * 9], az = V[i * 9 + 2], bx = V[i * 9 + 3], bz = V[i * 9 + 5], cx = V[i * 9 + 6], cz = V[i * 9 + 8];
      var x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
      var z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      return [
        Math.max(0, Math.min(G - 1, ((x0 - minX) / sx) | 0)), Math.max(0, Math.min(G - 1, ((x1 - minX) / sx) | 0)),
        Math.max(0, Math.min(G - 1, ((z0 - minZ) / sz) | 0)), Math.max(0, Math.min(G - 1, ((z1 - minZ) / sz) | 0))
      ];
    }
    var i2, r2, gx, gz;
    for (i2 = 0; i2 < nTri; i2++) {
      r2 = cellRange(i2);
      for (gz = r2[2]; gz <= r2[3]; gz++) for (gx = r2[0]; gx <= r2[1]; gx++) count[gz * G + gx]++;
    }
    var start = new Int32Array(G * G + 1), acc = 0;
    for (i2 = 0; i2 < G * G; i2++) { start[i2] = acc; acc += count[i2]; }
    start[G * G] = acc;
    if (acc > 6000000) return null;
    var items = new Int32Array(acc), fill = start.slice(0, G * G);
    for (i2 = 0; i2 < nTri; i2++) {
      r2 = cellRange(i2);
      for (gz = r2[2]; gz <= r2[3]; gz++) for (gx = r2[0]; gx <= r2[1]; gx++) items[fill[gz * G + gx]++] = i2;
    }
    console.log("[royal] collision mesh:", nTri, "tris,", G + "x" + G, "grid in", Math.round(performance.now() - t0) + "ms");
    return { V: V, n: nTri, G: G, minX: minX, minZ: minZ, sx: sx, sz: sz, start: start, items: items };
  }

  /* تقاطع شعاع/مثلّث */
  function triHit(V, i, ox, oy, oz, dx, dy, dz, maxD) {
    var o = i * 9;
    var ax = V[o], ay = V[o + 1], az = V[o + 2];
    var e1x = V[o + 3] - ax, e1y = V[o + 4] - ay, e1z = V[o + 5] - az;
    var e2x = V[o + 6] - ax, e2y = V[o + 7] - ay, e2z = V[o + 8] - az;
    var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    var det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-7 && det < 1e-7) return -1;
    var inv = 1 / det;
    var tx = ox - ax, ty = oy - ay, tz = oz - az;
    var u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-5 || u > 1.00001) return -1;
    var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    var v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-5 || u + v > 1.00001) return -1;
    var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return (t > 0.05 && t < maxD) ? t : -1;
  }

  /* يمشي الشعاع على خلايا الشبكة ويرجع أقرب اصطدام أو null */
  function meshHit(ox, oy, oz, dx, dy, dz, maxD) {
    var T = TRI; if (!T) return null;
    var G = T.G, best = -1, seen = {}, i, j, hit;
    var steps = Math.min(512, Math.ceil(maxD / Math.min(T.sx, T.sz)) + 2);
    var stepLen = maxD / steps;
    for (var s2 = 0; s2 <= steps; s2++) {
      var d = s2 * stepLen;
      var gx = ((ox + dx * d - T.minX) / T.sx) | 0;
      var gz = ((oz + dz * d - T.minZ) / T.sz) | 0;
      if (gx < 0 || gz < 0 || gx >= G || gz >= G) continue;
      var cell = gz * G + gx;
      if (seen[cell]) continue;
      seen[cell] = 1;
      for (i = T.start[cell], j = T.start[cell + 1]; i < j; i++) {
        hit = triHit(T.V, T.items[i], ox, oy, oz, dx, dy, dz, best > 0 ? best : maxD);
        if (hit > 0 && (best < 0 || hit < best)) best = hit;
      }
    }
    return best > 0 ? best : null;
  }

  /* ------- اصطدام الرصاص بالجدران (للاعب وللبوتات معاً) ------- */
  /* يرجع مسافة أول اصطدام أو null إذا كان الطريق خالياً */
  function wallHit(game, ox, oy, oz, dx, dy, dz, maxD) {
    if (TRI) return meshHit(ox, oy, oz, dx, dy, dz, maxD);
    var Q = game.Q;
    if (!Q || !Q.roofAt) return null;
    var bothIn = Q.isIndoor && Q.isIndoor(ox, oz);
    var step = 0.8, d = 1.2;
    for (; d < maxD; d += step) {
      var x = ox + dx * d, y = oy + dy * d, z = oz + dz * d;
      if (Q.heightAt(x, z) > y + 0.05) return d;              /* أرض/تضاريس */
      if (Q.roofAt(x, z) > y + 0.3) {                          /* بناء فوق الشعاع */
        if (!(bothIn && Q.isIndoor(x, z))) return d;           /* داخل نفس المبنى: يمرّ */
      }
      if (d > 40) step = 1.6;
    }
    return null;
  }

  window.__ROYAL_WALL__ = function (game, origin, dir, maxD) {
    if (!OPT.playerWall) return null;
    return wallHit(game, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxD);
  };

  /* خطّ النظر: الأعداء لا يطلقون عبر الجدران والتضاريس */
  window.__ROYAL_LOS__ = function (game, from, to) {
    if (!OPT.botLOS) return true;
    var dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    if (len < 2) return true;
    var hit = wallHit(game, from.x, from.y, from.z, dx / len, dy / len, dz / len, len - 0.8);
    return hit == null;
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
    try { voiceButton(game); } catch (e) { console.warn("voice", e); }
    if (OPT.ctxButtons) try { ctxSet(game.hud, "open", false); ctxSet(game.hud, "pickup", false); } catch (e) { }
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
    B = {
      game: game, mode: "place", sel: -1, ghost: null, ghostBox: null, ghostDims: null,
      hit: null, raf: 0, fly: true, flySpeed: 10, up: false, down: false,
      cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.62 }   /* موجب = ننظر للأسفل */
    };
    game.__build = true;
    document.body.classList.add("rs-building");   /* أخفِ أزرار اللعب أثناء البناء */

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
        B.cam.x = game.pos.x; B.cam.z = game.pos.z;
        B.cam.y = game.Q.heightAt(game.pos.x, game.pos.z) + 26;
        if (game.player) game.player.group.visible = false;
      } catch (e) { console.warn(e); }
    }, 80);

    makeGhost(game);
    buildBar();
    B.raf = requestAnimationFrame(buildTick);
    toast("🕊️ كاميرا حرّة — العصا للطيران، 🔼🔽 للارتفاع، ⚡ للسرعة", 4600);
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

  /* ---- كاميرا طائرة حرّة (وضع البناء) ---- */
  var FLY_PAD = 0.4;      /* هامش صغير يسمح بالمرور من الأبواب */
  function flyClear(c, tx, ty, tz) {
    var dx = tx - c.x, dy = ty - c.y, dz = tz - c.z;
    var dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-4) return true;
    return meshHit(c.x, c.y, c.z, dx / dl, dy / dl, dz / dl, dl + FLY_PAD) == null;
  }
  window.__ROYAL_FLY__ = function (game, dt) {
    if (!B || !B.fly || game.disposed) return false;
    var hud = game.hud; if (!hud) return false;
    var c = B.cam;
    if (!c) return false;

    var sens = 0.0032 * (OPT.sens || 1);
    var lk = hud.takeLook();
    c.yaw -= lk.x * sens;
    c.pitch = clamp(c.pitch + lk.y * sens, -1.45, 1.45);
    if (Math.abs(hud.input.aim.x) > 0.05 || Math.abs(hud.input.aim.y) > 0.05) {
      c.yaw -= hud.input.aim.x * 2.6 * dt;
      c.pitch = clamp(c.pitch + hud.input.aim.y * 1.5 * dt, -1.45, 1.45);
    }

    var cy = Math.cos(c.pitch);
    var fx = -Math.sin(c.yaw) * cy, fy = -Math.sin(c.pitch), fz = -Math.cos(c.yaw) * cy;
    var rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    var sp = B.flySpeed * (hud.input.run ? 2.4 : 1) * (hud.input.crouch ? 0.3 : 1);
    var mx = hud.input.move.x, my = -hud.input.move.y;
    var nx = c.x + (fx * my + rx * mx) * sp * dt;
    var nz = c.z + (fz * my + rz * mx) * sp * dt;
    var ny = c.y + (fy * my) * sp * dt + (B.up ? sp * dt : 0) - (B.down ? sp * dt : 0);

    /* لا اختراق للجدران — ومع ذلك ننزلق بمحاذاتها بدل التوقّف التام */
    if (TRI) {
      if (!flyClear(c, nx, ny, nz)) {
        /* انزلق بمحاذاة العائق: جرّب إسقاط محور واحد ثم محورين،
           وتجاهل أي محاولة لا تُحرّكنا فعلياً (وإلّا نتجمّد في مكاننا). */
        var want = (nx - c.x) * (nx - c.x) + (ny - c.y) * (ny - c.y) + (nz - c.z) * (nz - c.z);
        var cands = [[nx, c.y, nz], [nx, ny, c.z], [c.x, ny, nz],
        [nx, c.y, c.z], [c.x, c.y, nz], [c.x, ny, c.z]];
        var moved = false, ci, q, dd;
        for (ci = 0; ci < cands.length && !moved; ci++) {
          q = cands[ci];
          dd = (q[0] - c.x) * (q[0] - c.x) + (q[1] - c.y) * (q[1] - c.y) + (q[2] - c.z) * (q[2] - c.z);
          if (dd < want * 0.15) continue;
          if (flyClear(c, q[0], q[1], q[2])) { nx = q[0]; ny = q[1]; nz = q[2]; moved = true; }
        }
        if (!moved) {                       /* منحدر أو جدار: انزلق صاعداً بمحاذاته */
          var rise = c.y + Math.max(0.5, sp * dt);
          if (flyClear(c, c.x, rise, c.z)) { nx = c.x; nz = c.z; ny = rise; moved = true; }
        }
        if (!moved) { nx = c.x; ny = c.y; nz = c.z; }
      }
      /* لا نزول تحت الأرض ولا تحت أرضية بيت أو جسر */
      var gh = meshHit(nx, ny + 120, nz, 0, -1, 0, 260);
      if (gh != null) { var floorY = (ny + 120) - gh; if (ny < floorY + 1.1) ny = floorY + 1.1; }
    }
    var hf = game.Q.heightAt(nx, nz) + 1.1;
    if (ny < hf) ny = hf;
    c.x = nx; c.z = nz;
    c.y = clamp(ny, game.an.yMin - 5, game.an.yMax + 500);

    game.camera.position.set(c.x, c.y, c.z);
    game.camera.lookAt(c.x + fx, c.y + fy, c.z + fz);
    if (Math.abs(game.camera.fov - 68) > 0.1) { game.camera.fov = 68; game.camera.updateProjectionMatrix(); }
    game.pos.set(c.x, c.y, c.z);                    /* حتى تتبع الخريطة المصغّرة */
    if (game.player) game.player.group.visible = false;
    if (game.mm) try { game.mm.draw(c.x, c.z, c.yaw + Math.PI, []); } catch (e) { }
    var lab = document.getElementById("bb-alt");
    if (lab) lab.textContent = Math.round(c.y - game.Q.heightAt(c.x, c.z)) + "م";
    return true;
  };

  function buildTick() {
    if (!B || !B.game || B.game.disposed) return;
    var game = B.game, T = window.__ROYAL_THREE__;
    if (T && B.ghost && game.phase === "ground") {
      var dir = new T.V3();
      game.camera.getWorldDirection(dir);
      var o = game.camera.position, hit = null, d, px, pz, py, gy;
      /* الأولوية: اصطدام حقيقي بمضلّعات الخريطة — يسمح بالوضع داخل
         البيوت وفوق الجسور والأسطح، لا على الأرض المكشوفة فقط. */
      if (TRI) {
        var md = meshHit(o.x, o.y, o.z, dir.x, dir.y, dir.z, 34);
        if (md != null) hit = { x: o.x + dir.x * md, y: o.y + dir.y * md, z: o.z + dir.z * md };
      }
      if (!hit) for (d = 1.5; d < 30; d += 0.4) {
        px = o.x + dir.x * d; py = o.y + dir.y * d; pz = o.z + dir.z * d;
        gy = game.Q.groundFor(px, pz, py);
        if (py <= gy) { hit = { x: px, z: pz, y: gy }; break; }
      }
      if (!hit) {
        var fx = game.pos.x - Math.sin(game.yaw) * 4, fz = game.pos.z - Math.cos(game.yaw) * 4;
        hit = { x: fx, z: fz, y: game.Q.groundFor(fx, fz, game.pos.y) };
      }
      var ok = true;
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

  var SPD = [6, 10, 20, 45];      /* درجات سرعة كاميرا البناء */
  function holdBtn(icon, title, cb) {
    var n = el("button", { class: "bb", title: title, text: icon });
    n.addEventListener("pointerdown", function (e) { e.preventDefault(); cb(true); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { n.addEventListener(ev, function () { cb(false); }); });
    return n;
  }

  function buildBar() {
    if (document.getElementById("rs-build")) return;
    var bar = el("div", { id: "rs-build" }, [
      el("div", { class: "bb-top" }, [
        el("b", { text: "🏗️ البناء" }),
        el("span", { id: "bb-n", text: "" }),
        el("i", { id: "bb-pos", text: "" }),
        el("i", { id: "bb-alt", text: "", style: "margin-inline-start:8px" })
      ]),
      el("div", { class: "bb-tools" }, [
        el("button", { class: "bb ok", text: "📦 ضع", onclick: doPlace }),
        el("button", { class: "bb", text: "✋ اختر", onclick: doPick }),
        el("button", { class: "bb dz", text: "🗑️ احذف المحدَّد", onclick: doDel }),
        el("button", { class: "bb save", text: "💾 حفظ وخروج", onclick: doSave })
      ]),
      el("div", { class: "bb-mini" }, [
        holdBtn("🔼", "اصعد", function (v) { B.up = v; }),
        holdBtn("🔽", "انزل", function (v) { B.down = v; }),
        el("button", {
          class: "bb", id: "bb-spd", title: "السرعة",
          text: "⚡" + (SPD.indexOf(B ? B.flySpeed : 10) + 1 || 2), onclick: function () {
            B.flySpeed = SPD[(SPD.indexOf(B.flySpeed) + 1) % SPD.length];
            document.getElementById("bb-spd").textContent = "⚡" + (SPD.indexOf(B.flySpeed) + 1);
          }
        }),
        el("button", { class: "bb", id: "bb-move", title: "حرّك المحدَّد", text: "↔️", onclick: doMove }),
        el("button", { class: "bb", title: "دوّر", text: "🔄", onclick: function () { withSel(function (c) { c.ry = (c.ry || 0) + 0.4; }); } }),
        el("button", { class: "bb", title: "كبّر", text: "➕", onclick: function () { withSel(function (c) { c.scale = clamp((c.scale || 1) + 0.1, 0.5, 2.5); }); } }),
        el("button", { class: "bb", title: "صغّر", text: "➖", onclick: function () { withSel(function (c) { c.scale = clamp((c.scale || 1) - 0.1, 0.5, 2.5); }); } })
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
    B.game.crates.push({ id: "cr_b" + Date.now().toString(36), x: B.hit.x, y: B.hit.y, z: B.hit.z, ry: 0, scale: 1, opened: false, fixedY: B.hit.y });
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

  /* ============================================================
     6.35) الميكروفون مع الأصدقاء (فوق نفس اتصال WebRTC)
     ============================================================ */
  var VOICE = { stream: null, pcs: [], els: {}, mic: true, listen: true, asked: false };

  window.__ROYAL_VOICE_PC__ = function (pc, peerId) {
    if (!OPT.voice) return;
    VOICE.pcs.push(pc);
    pc.ontrack = function (e) {
      if (!e.streams || !e.streams[0]) return;
      var a = VOICE.els[peerId];
      if (!a) {
        a = document.createElement("audio");
        a.autoplay = true; a.playsInline = true;
        a.style.display = "none";
        document.body.appendChild(a);
        VOICE.els[peerId] = a;
      }
      a.srcObject = e.streams[0];
      a.muted = !VOICE.listen;
      a.play().catch(function () { });
    };
    try { pc.addTransceiver("audio", { direction: "sendrecv" }); } catch (e) { }
    attachMic(pc);
    ensureMic();
  };

  function attachMic(pc) {
    if (!VOICE.stream) return;
    try {
      var senders = pc.getSenders ? pc.getSenders() : [];
      var has = senders.some(function (sd) { return sd.track && sd.track.kind === "audio"; });
      if (!has) VOICE.stream.getAudioTracks().forEach(function (tr) { pc.addTrack(tr, VOICE.stream); });
    } catch (e) { console.warn("mic attach", e); }
  }

  function ensureMic(cb) {
    if (!OPT.voice || VOICE.stream || VOICE.asked) { cb && cb(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { VOICE.asked = true; return; }
    VOICE.asked = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (st) {
        VOICE.stream = st;
        st.getAudioTracks().forEach(function (tr) { tr.enabled = !!VOICE.mic; });
        VOICE.pcs.forEach(attachMic);
        voiceBtnSync();
        toast(VOICE.mic ? "🎤 الميكروفون مفتوح" : "🔇 الميكروفون مغلق", 1800);
        cb && cb();
      })
      .catch(function (e) {
        console.warn("mic denied", e);
        toast("تعذّر فتح الميكروفون — اسمح به من إعدادات المتصفّح", 3200);
      });
  }

  function voiceCycle() {
    if (VOICE.mic && VOICE.listen) { VOICE.mic = false; VOICE.listen = true; toast("👂 استماع فقط — ميكروفونك مغلق"); }
    else if (!VOICE.mic && VOICE.listen) { VOICE.listen = false; toast("🔇 الصوت مغلق تماماً"); }
    else { VOICE.mic = true; VOICE.listen = true; toast("🎤 الميكروفون والسماع مفتوحان"); ensureMic(); }
    if (VOICE.stream) VOICE.stream.getAudioTracks().forEach(function (tr) { tr.enabled = !!VOICE.mic; });
    for (var k in VOICE.els) VOICE.els[k].muted = !VOICE.listen;
    voiceBtnSync();
  }

  function voiceBtnSync() {
    var b = document.getElementById("rv-btn"); if (!b) return;
    b.textContent = VOICE.mic ? "🎤" : (VOICE.listen ? "👂" : "🔇");
    b.className = VOICE.mic ? "on" : (VOICE.listen ? "listen" : "off");
  }

  function voiceButton(game) {
    if (!OPT.voice || document.getElementById("rv-btn")) return;
    if (!game.net) return;                       /* أونلاين فقط */
    var b = el("div", { id: "rv-btn", text: "🎤", onclick: voiceCycle });
    (game.hud && game.hud.node ? game.hud.node : document.body).appendChild(b);
    VOICE.mic = !!OPT.voiceMic;
    voiceBtnSync();
    ensureMic();
  }

  /* ---- الطائرة تواصل طيرانها بعد القفز حتى تختفي ---- */
  window.__ROYAL_SHIP__ = function (game) {
    try {
      if (!game.ship) return;
      var d = game.shipDir || { x: 0, z: 1 };
      var L = Math.hypot(d.x, d.z) || 1, dx = d.x / L, dz = d.z / L;
      var sp = (game.P.map.flight && game.P.map.flight.speed) || 105;
      var t0 = performance.now(), last = t0;
      (function step() {
        if (!game.ship || game.disposed) return;
        var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        game.ship.position.x += dx * sp * dt;
        game.ship.position.z += dz * sp * dt;
        game.ship.position.y += 6 * dt;                       /* تصعد قليلاً */
        game.ship.rotation.z = Math.sin(now * 0.0006) * 0.05;
        if ((now - t0) / 1000 > 30) {
          try { game.scene.remove(game.ship); } catch (e) { }
          game.ship = null; return;
        }
        requestAnimationFrame(step);
      })();
    } catch (e) { console.warn("ship", e); }
  };

  /* ---- دفع عصا التحرّك للنهاية = جري ---- */
  window.__ROYAL_STICKRUN__ = function (hud, mag) {
    if (!OPT.stickRun) return;
    if (mag >= OPT.stickRunAt) { hud.input.run = true; hud.__srun = true; }
    else if (hud.__srun && mag < OPT.stickRunAt - 0.12) { hud.input.run = false; hud.__srun = false; }
  };

  /* ---- أزرار سياقية: فتح الصندوق / الالتقاط ---- */
  function ctxSet(hud, id, on) {
    var w = hud && hud.widgets && hud.widgets[id];
    if (!w || !w.cfg || !w.cfg.visible) return;        /* المخفي يبقى مخفياً */
    if (w.__ctx === on) return;
    w.__ctx = on;
    w.node.classList.toggle("ctx-off", !on);
  }
  window.__ROYAL_CTX__ = function (game, crate, loot) {
    if (!OPT.ctxButtons) return;
    ctxSet(game.hud, "open", !!crate);
    ctxSet(game.hud, "pickup", !!loot);
  };

  /* ---- غنائم الأعداء ---- */
  window.__ROYAL_DROP__ = function (game, bot) {
    try { dropLoot(game, bot); } catch (e) { console.warn("drop", e); }
  };
  function dropLoot(game, bot) {
    if (!OPT.botDrop || !game.spawnPickup) return;
    var defs = game.wdefs || [];
    if (!defs.length) return;
    var w = defs[(Math.random() * defs.length) | 0];
    var out = [{ t: "weapon", def: w }, { t: "ammo", kind: w.ammo, n: (w.mag || 10) * 2 }];
    if (Math.random() < 0.55) out.push({ t: "item", kind: "heal", n: 1 });
    if (Math.random() < 0.35) out.push({ t: "item", kind: "shield", n: 1 });
    if (Math.random() < 0.22) out.push({ t: "item", kind: "med", n: 1 });
    if (Math.random() < 0.45) out.push({ t: "item", kind: "nade", n: 1 });
    var y = game.Q.heightAt(bot.pos.x, bot.pos.z);
    out.forEach(function (p, i) {
      var a = (i / out.length) * 6.2832;
      game.spawnPickup(bot.pos.x + Math.cos(a) * 1.15, y + 1.2, bot.pos.z + Math.sin(a) * 1.15, p);
    });
    game.hud && game.hud.feed && game.hud.feed("\u{1F392} " + bot.name + " \u0623\u0633\u0642\u0637 \u063A\u0646\u0627\u0626\u0645\u0647");
  }

  /* ---- إصابة دقيقة: رأس / جسم + فحص جدار لنقطة الإصابة نفسها ---- */
  function sphereHit(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxD) {
    var mx = cx - ox, my = cy - oy, mz = cz - oz;
    var tca = mx * dx + my * dy + mz * dz;
    if (tca < 0.4 || tca > maxD) return -1;
    var d2 = (mx * mx + my * my + mz * mz) - tca * tca;
    if (d2 > r * r) return -1;
    var thc = Math.sqrt(r * r - d2);
    var t0 = tca - thc;
    return t0 > 0.4 ? t0 : tca;
  }

  window.__ROYAL_HIT__ = function (game, o, d, bot, maxD) {
    var H = bot.ch.totalH || 1.7;
    var bx = bot.pos.x, bz = bot.pos.z, by = bot.pos.y;
    var headY = by + H * 0.88, bodyY = by + H * 0.48;
    var dh = sphereHit(o.x, o.y, o.z, d.x, d.y, d.z, bx, headY, bz, 0.34, maxD);
    var db = sphereHit(o.x, o.y, o.z, d.x, d.y, d.z, bx, bodyY, bz, 0.62, maxD);
    var head = false, dist = -1;
    if (dh > 0 && (db < 0 || dh <= db)) { head = true; dist = dh; }
    else if (db > 0) { head = false; dist = db; }
    if (dist < 0) return null;
    /* هل يحجب جدارٌ نقطة الإصابة تحديداً؟ */
    if (OPT.playerWall) {
      var w = wallHit(game, o.x, o.y, o.z, d.x, d.y, d.z, dist - 0.15);
      /* العدو الملتصق بزاوية جدار: الشعاع إلى نقطة الإصابة يخدش الزاوية
         فيُلغى الرصاص رغم أنه مكشوف أمامك. نسمح بهامش جانبي ±18سم عند
         نقطة الإصابة نفسها فقط — يكفي لتجاوز خدش الزاوية، ولا يكفي
         أبداً لاختراق جدار حقيقي. */
      if (w != null && exposedAt(game, o, d, dist)) w = null;
      if (w != null) return null;
    }
    return { d: dist, head: head };
  };

  function exposedAt(game, o, d, dist) {
    var hx = o.x + d.x * dist, hy = o.y + d.y * dist, hz = o.z + d.z * dist;
    var rx = -d.z, rz = d.x;                       /* متجه جانبي أفقي */
    var rl = Math.sqrt(rx * rx + rz * rz) || 1; rx /= rl; rz /= rl;
    var offs = [0.18, -0.18];
    for (var i = 0; i < offs.length; i++) {
      var px = hx + rx * offs[i], pz = hz + rz * offs[i];
      var vx = px - o.x, vy = hy - o.y, vz = pz - o.z;
      var L = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (L < 1e-4) return true;
      if (wallHit(game, o.x, o.y, o.z, vx / L, vy / L, vz / L, L - 0.12) == null) return true;
    }
    return false;
  }

  /* ------- أقرب عدوّ يقطعه الشعاع (للتصحيح البصري للتصويب) ------- */
  function nearestBotAlong(game, ox, oy, oz, dx, dy, dz, maxD) {
    var best = null, i, b, H, dh, db, d;
    for (i = 0; i < game.bots.length; i++) {
      b = game.bots[i];
      if (!b.alive || !b.landed || b.ally) continue;
      H = (b.ch && b.ch.totalH) || 1.7;
      dh = sphereHit(ox, oy, oz, dx, dy, dz, b.pos.x, b.pos.y + H * 0.88, b.pos.z, 0.34, maxD);
      db = sphereHit(ox, oy, oz, dx, dy, dz, b.pos.x, b.pos.y + H * 0.48, b.pos.z, 0.62, maxD);
      d = (dh > 0 && (db < 0 || dh < db)) ? dh : db;
      if (d > 0 && (best == null || d < best)) best = d;
    }
    return best;
  }

  /* ------------------------------------------------------------------
     تصحيح فرق المنظور: الرصاصة تنطلق من صدر اللاعب بينما التصويب من
     الكاميرا التي تبعد عنه أمتاراً في منظور الشخص الثالث. الشعاعان
     متوازيان فيمرّ الرصاص بجانب العدو رغم أن التصويب على وجهه.
     الحلّ: نحسب أين ينظر مركز الشاشة فعلاً، ثم نصوّب من الصدر إلى
     تلك النقطة — مع الحفاظ على انتشار الطلقة كما هو. */
  function parallaxFix(game, o, dir, range) {
    var cam = game.camera; if (!cam) return dir;
    cam.updateWorldMatrix(true, false);
    var e = cam.matrixWorld.elements;
    var fx = -e[8], fy = -e[9], fz = -e[10];
    var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    var cx = e[12], cy = e[13], cz = e[14];
    var d = nearestBotAlong(game, cx, cy, cz, fx, fy, fz, range);
    var w = wallHit(game, cx, cy, cz, fx, fy, fz, d == null ? range : d);
    if (w != null && (d == null || w < d)) d = w;
    if (d == null || d > range) d = range;
    if (d < 2) d = 2;
    var vx = (cx + fx * d) - o.x, vy = (cy + fy * d) - o.y, vz = (cz + fz * d) - o.z;
    var L = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1; vx /= L; vy /= L; vz /= L;
    /* أزِح القاعدة فقط، فيبقى تشتّت الطلقة كما ولّده المحرّك */
    var nx = dir.x + (vx - fx), ny = dir.y + (vy - fy), nz = dir.z + (vz - fz);
    var n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    dir.set(nx / n, ny / n, nz / n);
    return dir;
  }

  /* ------------------------------------------------------------------
     مؤخّرة السلاح كانت مدفونة داخل جسم الشخصية: المحرّك يضع محور
     السلاح عند 74% من طوله، فيبقى 26% منه خلف قبضة اليد — أي داخل
     الصدر. ندفع السلاح للأمام وللخارج بمقدار يتناسب مع طوله. */
  window.__ROYAL_HOLD__ = function (node, def) {
    if (!OPT.holdFix) return;
    var back = (def.len || 0.8) * 0.26;                 /* ما يقع خلف اليد */
    var push = Math.max(0, back - OPT.holdClear) + OPT.holdPush;
    node.position.set(
      def.hold.px + OPT.holdOut,
      def.hold.py + OPT.holdUp,
      def.hold.pz + push
    );
  };

  /* سلاح المنظور الأول: ادفعه خارج مستوى القصّ حتى لا يُقَصّ ويظهر مجوّفاً */
  window.__ROYAL_FPS__ = function (node, def) {
    if (!OPT.fpsFix) return;
    var back = (def.len || 0.8) * 0.26;              /* ما يمتدّ نحو الكاميرا */
    var need = OPT.camNear + back + OPT.fpsClear;
    if (node.position.z > -need) node.position.z = -need;
  };

  /* ============================================================
     6.39) مؤثّرات الطلقة: خيط رصاص لامع + صاروخ RPG حقيقي
     ============================================================ */
  var FX = { list: [], game: null, pool: [] };

  function fxMat(color, opacity) {
    var T = window.__ROYAL_THREE__;
    return new T.Basic({ color: color, transparent: true, opacity: opacity, depthWrite: false });
  }
  function fxAdd(game, obj) { game.scene.add(obj); return obj; }
  function fxKill(o) {
    try {
      if (o.parent) o.parent.remove(o);
      o.traverse && o.traverse(function (m) {
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      });
    } catch (e) { }
  }

  /* صاروخ الـ RPG: جسم + رأس حربي + زعانف + لهب خلفي */
  function makeRocket() {
    var T = window.__ROYAL_THREE__, g = new T.Group();
    var body = new T.Mesh(new T.Cyl(0.055, 0.055, 0.34, 10, 1), new T.Std({ color: 0x2f3a2a, roughness: 0.7 }));
    body.rotation.x = Math.PI / 2;
    var nose = new T.Mesh(new T.Cyl(0.005, 0.082, 0.20, 10, 1), new T.Std({ color: 0x6b2b1f, roughness: 0.6 }));
    nose.rotation.x = -Math.PI / 2; nose.position.z = 0.26;
    var ring = new T.Mesh(new T.Cyl(0.085, 0.085, 0.05, 10, 1), new T.Std({ color: 0x1b1b1b, roughness: 0.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.z = 0.13;
    var i, fin;
    for (i = 0; i < 4; i++) {
      fin = new T.Mesh(new T.Box(0.012, 0.13, 0.13), new T.Std({ color: 0x232823, roughness: 0.8 }));
      fin.position.z = -0.16;
      fin.rotation.z = i * Math.PI / 2;
      fin.position.x = Math.cos(i * Math.PI / 2) * 0.07;
      fin.position.y = Math.sin(i * Math.PI / 2) * 0.07;
      g.add(fin);
    }
    var flame = new T.Mesh(new T.Cyl(0.015, 0.07, 0.5, 10, 1), fxMat(0xff8a2b, 0.55));
    flame.rotation.x = -Math.PI / 2; flame.position.z = -0.44;
    var core = new T.Mesh(new T.Cyl(0.008, 0.036, 0.28, 8, 1), fxMat(0xfff0b8, 0.85));
    core.rotation.x = -Math.PI / 2; core.position.z = -0.32;
    g.add(body); g.add(nose); g.add(ring); g.add(flame); g.add(core);
    g.__flame = flame; g.__core = core;
    return g;
  }

  function faceAlong(obj, dx, dy, dz) {
    /* يوجّه المحور +Z للجسم نحو الاتجاه المعطى */
    var yaw = Math.atan2(dx, dz);
    var pitch = Math.atan2(-dy, Math.sqrt(dx * dx + dz * dz));
    obj.rotation.set(pitch, yaw, 0, "YXZ");
  }

  window.__ROYAL_SHOT__ = function (game, from, to, def) {
    if (!OPT.shotFx || !window.__ROYAL_THREE__) return false;
    try {
      FX.game = game;
      var T = window.__ROYAL_THREE__;
      var dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      dx /= dist; dy /= dist; dz /= dist;

      /* ومضة الفوّهة — دائماً */
      var mz = new T.Mesh(new T.Sph(def.kind === "rpg" ? 0.17 : 0.1, 10, 8),
        fxMat(def.kind === "rpg" ? 0xffc06a : 0xffe9a0, 0.75));
      mz.position.set(from.x, from.y, from.z);
      fxAdd(game, mz);
      FX.list.push({ o: mz, k: "flash", t: 0, life: 0.06, s0: 1, s1: 1.9 });

      if (def.kind === "rpg") {
        var rk = makeRocket();
        rk.position.set(from.x, from.y, from.z);
        faceAlong(rk, dx, dy, dz);
        fxAdd(game, rk);
        FX.list.push({
          o: rk, k: "rocket", t: 0, life: dist / 200 + 0.02,
          fx: from.x, fy: from.y, fz: from.z, dx: dx, dy: dy, dz: dz,
          dist: dist, spd: 200, smoke: 0
        });
        return true;
      }

      /* خيط الرصاصة: أسطوانة رفيعة لامعة تنطلق نحو نقطة الإصابة */
      var len = Math.min(dist, def.kind === "sniper" ? 26 : 11);
      var rad = def.kind === "sniper" ? 0.035 : def.kind === "shotgun" ? 0.018 : 0.026;
      var tr = new T.Mesh(new T.Cyl(rad, rad, len, 6, 1),
        fxMat(def.kind === "sniper" ? 0xcfe6ff : 0xffe27a, 0.95));
      tr.rotation.x = Math.PI / 2;                 /* المحور صار +Z */
      var wrap = new T.Group(); wrap.add(tr);
      wrap.position.set(from.x, from.y, from.z);
      faceAlong(wrap, dx, dy, dz);
      tr.position.z = len * 0.5;
      fxAdd(game, wrap);
      var spd = def.kind === "sniper" ? 900 : 560;
      FX.list.push({
        o: wrap, k: "tracer", t: 0, life: Math.min(0.5, dist / spd + 0.03),
        fx: from.x, fy: from.y, fz: from.z, dx: dx, dy: dy, dz: dz,
        dist: dist, spd: spd
      });

      /* شرارة الارتطام */
      var sp = new T.Mesh(new T.Sph(0.1, 6, 5), fxMat(0xfff3c4, 0.9));
      sp.position.set(to.x - dx * 0.06, to.y - dy * 0.06, to.z - dz * 0.06);
      fxAdd(game, sp);
      FX.list.push({ o: sp, k: "flash", t: 0, life: 0.16, s0: 0.6, s1: 2.4, delay: dist / spd });
      return true;
    } catch (e) { console.warn("shot fx", e); return false; }
  };

  function boom(game, x, y, z) {
    var T = window.__ROYAL_THREE__;
    var core = new T.Mesh(new T.Sph(0.8, 12, 10), fxMat(0xffd27a, 0.95));
    core.position.set(x, y, z); fxAdd(game, core);
    FX.list.push({ o: core, k: "flash", t: 0, life: 0.42, s0: 0.5, s1: 5.4 });
    var sm = new T.Mesh(new T.Sph(1.1, 10, 8), fxMat(0x3a3630, 0.75));
    sm.position.set(x, y, z); fxAdd(game, sm);
    FX.list.push({ o: sm, k: "flash", t: 0, life: 1.1, s0: 0.7, s1: 4.2 });
    try { game.flash.position.set(x, y, z); game.flash.intensity = 60; } catch (e) { }
  }

  window.__ROYAL_FX__ = function (game, dt) {
    /* شريطا العلاج والقنابل: ابنِهما مرّة، وحدّث الأعداد كل ربع ثانية */
    if (OPT.itemRails && !game.__build && game.hud) {
      railT -= dt;
      if (railT <= 0) {
        railT = 0.25;
        buildRails(game);
        syncRails(game);
        if (RAILS) RAILS.wrap.style.display = game.phase === "ground" ? "" : "none";
      }
    }
    var L = FX.list; if (!L.length) return;
    var T = window.__ROYAL_THREE__;
    for (var i = L.length - 1; i >= 0; i--) {
      var f = L[i];
      f.t += dt;
      if (f.delay) { if (f.t < f.delay) continue; }
      var age = f.t - (f.delay || 0);
      var p = age / f.life;
      if (f.k === "flash") {
        if (p >= 1) { fxKill(f.o); L.splice(i, 1); continue; }
        var s = f.s0 + (f.s1 - f.s0) * p;
        f.o.scale.set(s, s, s);
        f.o.material.opacity = (1 - p) * 0.95;
        continue;
      }
      if (f.k === "tracer") {
        var d = Math.min(f.dist, f.spd * age);
        f.o.position.set(f.fx + f.dx * d, f.fy + f.dy * d, f.fz + f.dz * d);
        if (p >= 1) { fxKill(f.o); L.splice(i, 1); }
        else f.o.children[0].material.opacity = 0.95 * (1 - p * p);
        continue;
      }
      if (f.k === "nade") {
        f.vy -= 22 * dt;
        var nx2 = f.o.position.x + f.vx * dt;
        var ny2 = f.o.position.y + f.vy * dt;
        var nz2 = f.o.position.z + f.vz * dt;
        var fl2 = game.Q.groundFor ? game.Q.groundFor(nx2, nz2, ny2) : game.Q.heightAt(nx2, nz2);
        if (ny2 <= fl2 + 0.11) {                 /* ارتداد عن الأرض */
          ny2 = fl2 + 0.11;
          if (f.vy < -1.2) { f.vy = -f.vy * 0.36; f.bounce++; }
          else f.vy = 0;
          f.vx *= 0.62; f.vz *= 0.62;
        } else if (TRI) {                        /* ارتداد عن الجدران */
          var mdx = nx2 - f.o.position.x, mdz = nz2 - f.o.position.z;
          var ml = Math.sqrt(mdx * mdx + mdz * mdz);
          if (ml > 1e-4 && meshHit(f.o.position.x, f.o.position.y, f.o.position.z,
            mdx / ml, 0, mdz / ml, ml + 0.2) != null) {
            f.vx = -f.vx * 0.45; f.vz = -f.vz * 0.45;
            nx2 = f.o.position.x; nz2 = f.o.position.z;
          }
        }
        f.o.position.set(nx2, ny2, nz2);
        f.o.rotation.x += dt * 7; f.o.rotation.z += dt * 5;
        if (p >= 1) { nadeBoom(game, nx2, ny2, nz2); fxKill(f.o); L.splice(i, 1); }
        continue;
      }
      if (f.k === "rocket") {
        var rd = Math.min(f.dist, f.spd * age);
        f.o.position.set(f.fx + f.dx * rd, f.fy + f.dy * rd, f.fz + f.dz * rd);
        if (f.o.__flame) {
          var k = 0.75 + Math.random() * 0.6;
          f.o.__flame.scale.set(k, 0.85 + Math.random() * 0.4, k);
          f.o.__flame.material.opacity = 0.4 + Math.random() * 0.3;
          if (f.o.__core) f.o.__core.material.opacity = 0.7 + Math.random() * 0.3;
        }
        f.smoke -= dt;
        if (f.smoke <= 0 && L.length < 90) {
          f.smoke = 0.022;
          var pf = new T.Mesh(new T.Sph(0.15, 8, 6), fxMat(0x9a978f, 0.34));
          pf.position.copy(f.o.position);
          fxAdd(game, pf);
          L.push({ o: pf, k: "flash", t: 0, life: 0.9, s0: 0.5, s1: 3.4 });
        }
        if (rd >= f.dist - 0.01) {
          boom(game, f.fx + f.dx * f.dist, f.fy + f.dy * f.dist, f.fz + f.dz * f.dist);
          fxKill(f.o); L.splice(i, 1);
        }
        continue;
      }
      fxKill(f.o); L.splice(i, 1);
    }
  };

  /* ============================================================
     6.40) شريطا العلاجات (يمين) والقنابل (يسار) — بأسلوب ببجي
     ============================================================ */
  var HEALS = [
    { k: "heal", emo: "🩹", name: "ضمادة", hp: 40 },
    { k: "med", emo: "🧰", name: "حقيبة إسعاف", hp: 999 },
    { k: "shield", emo: "🛡️", name: "درع", sh: 50 },
    { k: "boost", emo: "🥤", name: "مشروب طاقة", boost: 12 }
  ];
  var RAILS = null, railT = 0;

  /* لوحتان أفقيّتان فوق شريط الأسلحة تماماً كببجي:
     «قنابل» على اليسار و«علاجات» على اليمين، بلاطات بنفس شكل خانات السلاح. */
  function buildRails(game) {
    if (RAILS && document.body.contains(RAILS.wrap)) return;
    var hud = game.hud && game.hud.node; if (!hud) return;

    function tile(icon, title, onTap) {
      return el("button", { class: "ri-tile", title: title, onclick: function (e) { e.preventDefault(); onTap(); } }, [
        el("i", { text: icon }), el("b", { text: "0" })
      ]);
    }
    var nade = tile("💣", "قنبلة يدوية", function () { throwNade(game); });
    nade.__k = "nade"; nade.classList.add("nade");
    var wrap = el("div", { id: "ri-bar" }, [nade]);
    HEALS.forEach(function (h) {
      var t = tile(h.emo, h.name, function () { useHeal(game, h); });
      t.__k = h.k; wrap.appendChild(t);
    });
    /* في نفس صفّ خانات السلاح تماماً — لا يغطّي الشاشة أبداً */
    var box = hud.querySelector("#ammobox") || document.getElementById("ammobox");
    if (box) box.appendChild(wrap); else hud.appendChild(wrap);
    RAILS = { wrap: wrap, tiles: wrap.querySelectorAll(".ri-tile") };
    syncRails(game);
  }

  function syncRails(game) {
    if (!RAILS) return;
    var it = (game.inv && game.inv.items) || {};
    var ts = RAILS.tiles, i, n;
    for (i = 0; i < ts.length; i++) {
      n = it[ts[i].__k] || 0;
      ts[i].querySelector("b").textContent = n;
      ts[i].classList.toggle("empty", n <= 0);
    }
  }

  function useHeal(game, h) {
    var inv = game.inv; if (!inv) return;
    if ((inv.items[h.k] || 0) <= 0) { game.hud.feed("لا يوجد " + h.name); return; }
    if (h.k === "med") {                       /* نوع جديد لا يعرفه المحرّك */
      inv.items.med--;
      game.stats.hp = game.stats.maxHp;
      game.hud.feed("🧰 صحّة كاملة");
      game.hud.setHP(game.stats.hp, game.stats.maxHp, game.stats.shield);
      try { game.scene && window.__ROYAL_AUDIO__; } catch (e) { }
    } else game.useItem(h.k);
    syncRails(game);
  }

  /* ---- القنبلة اليدوية: رمي بقوس، ارتداد، فتيل، ثم انفجار ---- */
  function throwNade(game) {
    var inv = game.inv; if (!inv) return;
    if ((inv.items.nade || 0) <= 0) { game.hud.feed("لا توجد قنابل"); return; }
    if (!window.__ROYAL_THREE__) return;
    inv.items.nade--; syncRails(game);
    var T = window.__ROYAL_THREE__;
    var cam = game.camera; cam.updateWorldMatrix(true, false);
    var e = cam.matrixWorld.elements;
    var fx = -e[8], fy = -e[9], fz = -e[10];
    var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    var o = { x: game.pos.x, y: game.pos.y + game.player.totalH * 0.78, z: game.pos.z };
    var g = new T.Group();
    var body = new T.Mesh(new T.Sph(0.11, 10, 8), new T.Std({ color: 0x2f4a24, roughness: 0.75 }));
    var top = new T.Mesh(new T.Cyl(0.045, 0.045, 0.07, 8, 1), new T.Std({ color: 0x6a6a6a, roughness: 0.6 }));
    top.position.y = 0.12;
    g.add(body); g.add(top);
    g.position.set(o.x + fx * 0.5, o.y, o.z + fz * 0.5);
    game.scene.add(g);
    var sp = OPT.nadeSpeed;
    FX.list.push({
      o: g, k: "nade", t: 0, life: OPT.nadeFuse,
      vx: fx * sp, vy: fy * sp + 4.2, vz: fz * sp, bounce: 0
    });
    game.hud.feed("💣 رميتَ قنبلة");
  }

  function nadeBoom(game, x, y, z) {
    boom(game, x, y, z);
    var R = OPT.nadeR, DM = OPT.nadeDmg, i, b, d, dmg;
    for (i = 0; i < game.bots.length; i++) {
      b = game.bots[i];
      if (!b.alive || !b.landed) continue;
      var H = (b.ch && b.ch.totalH) || 1.7;
      var bx = b.pos.x - x, by = (b.pos.y + H * 0.5) - y, bz = b.pos.z - z;
      d = Math.sqrt(bx * bx + by * by + bz * bz);
      if (d > R) continue;
      if (d > 1 && wallHit(game, x, y, z, bx / d, by / d, bz / d, d - 0.6) != null) continue;
      dmg = DM * (1 - d / R);
      b.hp -= dmg;
      b.aggro = game.pos.clone();
      if (b.hp <= 0) game.killBot(b, true);
    }
    var px = game.pos.x - x, py = (game.pos.y + 0.9) - y, pz = game.pos.z - z;
    d = Math.sqrt(px * px + py * py + pz * pz);
    if (d < R && game.damage) {
      try { game.damage(DM * (1 - d / R) * 0.8, "قنبلة"); } catch (e) { }
    }
  }

  /* ------- مساعد التصويب: يقفل على العدو عند تفعيل وضع التصويب ------- */
  window.__ROYAL_AIM__ = function (game, o, dir, range, pellets) {
    try {
      if (OPT.parallax) parallaxFix(game, o, dir, range);
      if (OPT.directAim || !OPT.aimAssist || pellets !== 1) return dir;
      var inp = game.hud && game.hud.input;
      if (OPT.aimAdsOnly && !(inp && (inp.aiming || inp.scopeOn))) return dir;
      var cone = OPT.aimCone, best = null, bestScore = -1, i, b, H, vx, vy, vz, L, dot, sc;
      for (i = 0; i < game.bots.length; i++) {
        b = game.bots[i];
        if (!b.alive || !b.landed || b.ally) continue;
        H = (b.ch && b.ch.totalH) || 1.7;
        vx = b.pos.x - o.x; vy = (b.pos.y + H * 0.55) - o.y; vz = b.pos.z - o.z;
        L = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (L > range || L < 0.6) continue;
        vx /= L; vy /= L; vz /= L;
        dot = vx * dir.x + vy * dir.y + vz * dir.z;
        if (dot < cone) continue;
        /* لا مساعدة على عدوٍّ خلف جدار */
        if (wallHit(game, o.x, o.y, o.z, vx, vy, vz, L - 0.6) != null) continue;
        sc = dot * 2 + (1 - L / range);
        if (sc > bestScore) { bestScore = sc; best = { x: vx, y: vy, z: vz }; }
      }
      if (!best) return dir;
      var k = clamp(OPT.aimPow, 0, 1);
      var nx = dir.x + (best.x - dir.x) * k;
      var ny = dir.y + (best.y - dir.y) * k;
      var nz = dir.z + (best.z - dir.z) * k;
      var n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      dir.set(nx / n, ny / n, nz / n);
    } catch (e) { }
    return dir;
  };

  /* ============================================================
     6.38) أصوات مرفوعة: طلقات، تعبئة، وموسيقى القائمة
     ============================================================ */
  var SFX = { buf: {}, ready: {}, ctx: null, menuSrc: null, menuGain: null };

  function sfxCtx() {
    if (SFX.ctx) return SFX.ctx;
    var A = window.__ROYAL_AUDIO__;
    try { SFX.ctx = (A && A.init && A.init()) || (A && A.ctx && A.ctx()) || null; } catch (e) { }
    return SFX.ctx;
  }

  function loadSfx(name, dataUrl) {
    var ctx = sfxCtx(); if (!ctx || SFX.ready[name]) return;
    SFX.ready[name] = "loading";
    fetch(dataUrl).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) { SFX.buf[name] = buf; SFX.ready[name] = "ok"; })
      .catch(function (e) { console.warn("sfx " + name, e); SFX.ready[name] = "fail"; });
  }

  function initSfx() {
    var B = window.__ROYAL_SFXDATA__; if (!B) return;
    if (!sfxCtx()) return;
    for (var k in B) loadSfx(k, B[k]);
  }

  /* يشغّل جزءاً من المقطع فقط ويقطعه عند الطلقة التالية */
  function playClip(name, seconds, gain) {
    var ctx = sfxCtx(), buf = SFX.buf[name];
    if (!ctx || !buf) return false;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain == null ? 0.9 : gain, t);
    var dur = Math.min(seconds || 1, buf.duration);
    g.gain.setValueAtTime(g.gain.value, t + dur - 0.04);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);      /* قطع ناعم بلا طقطقة */
    src.connect(g); g.connect(ctx.destination);
    src.start(t, 0, dur + 0.02);
    src.stop(t + dur + 0.03);
    return true;
  }

  window.__ROYAL_GUNSFX__ = function (kind) {
    if (!OPT.customSfx) return false;
    initSfx();
    if (kind === "sniper" && playClip("sniper", OPT.sfxSniperSec, 0.95)) return true;
    if (kind === "rpg" && playClip("rpg", OPT.sfxRpgSec, 1)) return true;
    if (kind === "pistol" || kind === "shotgun" || kind === "sniper" || kind === "rpg")
      return playClip("pistol", OPT.sfxPistolSec, 0.85);
    return playClip("rifle", OPT.sfxRifleSec, 0.75);      /* رشّاش: جزء قصير لكل طلقة */
  };

  window.__ROYAL_RELSFX__ = function (phase) {
    if (!OPT.customSfx || phase !== "start") return false;
    initSfx();
    return playClip("reload", 2.5, 0.9);
  };

  /* موسيقى القائمة الرئيسية */
  window.__ROYAL_MENU__ = function () {
    if (!OPT.customSfx) return false;
    initSfx();
    var ctx = sfxCtx(), buf = SFX.buf.menu;
    if (!ctx || !buf) {
      /* لم تُفكّ بعد — أعِد المحاولة بعد قليل واكتم المولّد الأصلي */
      setTimeout(function () { try { window.__ROYAL_MENU__(); } catch (e) { } }, 700);
      return true;
    }
    if (SFX.menuSrc) return true;
    var g = ctx.createGain(); g.gain.value = 0;
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.connect(g); g.connect(ctx.destination); src.start();
    g.gain.linearRampToValueAtTime(OPT.menuVol, ctx.currentTime + 1.2);
    SFX.menuSrc = src; SFX.menuGain = g;
    return true;
  };

  function stopMenuMusic() {
    if (!SFX.menuSrc) return;
    try {
      var ctx = sfxCtx();
      SFX.menuGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      var s2 = SFX.menuSrc;
      setTimeout(function () { try { s2.stop(); } catch (e) { } }, 700);
    } catch (e) { }
    SFX.menuSrc = null; SFX.menuGain = null;
  }

  /* أوقف موسيقى القائمة عند بدء المباراة */
  setInterval(function () {
    if (SFX.menuSrc && document.getElementById("gameroot")) stopMenuMusic();
  }, 600);
  addEventListener("pointerdown", function () { initSfx(); }, { once: true });

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
