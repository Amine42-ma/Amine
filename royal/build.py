#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
بطل رويال — أداة الترقيع
========================
تأخذ ملف اللعبة المُصدَّر من «Royal Builder» وتُضيف إليه:

  1. لوحة إعداد كاملة قبل بدء اللعب (ترتيب الأزرار / العدّادات /
     أيقونات وألوان الأسلحة / الأشجار والصناديق / إعدادات اللعب).
  2. منع الصعود فوق الأشياء (ثلاثة أوضاع).
  3. أشجار حقيقية على الخريطة تعمل كعوائق صلبة.
  4. شارة واضحة للسلاح المحمول + تلوين خانات الأسلحة بلونها.
  5. دعم رفع صور مخصّصة كأيقونات للأزرار والأسلحة.

الاستعمال:
    python3 build.py <input.html> <output.html>
"""

import base64
import gzip
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# نماذج ثلاثية الأبعاد تُستبدَل داخل الحمولة: معرّف الأصل -> ملف .glb
ASSET_SWAPS = {
    "bundled_w_pistol": os.path.join(HERE, "assets", "pistol.glb"),
}

# مقاطع صوتية تُدمَج داخل الملف: الاسم -> ملف mp3
SFX_FILES = {
    "pistol": os.path.join(HERE, "assets", "sfx", "pistol.mp3"),
    "rifle":  os.path.join(HERE, "assets", "sfx", "rifle.mp3"),
    "reload": os.path.join(HERE, "assets", "sfx", "reload.mp3"),
    "menu":   os.path.join(HERE, "assets", "sfx", "menu.mp3"),
}


def sfx_block():
    """يبني كتلة <script> فيها المقاطع الصوتية كـ data:URI."""
    parts = []
    for name, path in SFX_FILES.items():
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        parts.append('%s:"data:audio/mpeg;base64,%s"' % (_json_key(name), b64))
        print("  \u2714 \u0635\u0648\u062A %s (%.0f \u0643\u0628)" % (name, len(b64) / 1365.0))
    if not parts:
        return ""
    return '<script id="royal-sfx">window.__ROYAL_SFXDATA__={%s};</script>\n' % ",".join(parts)


def _json_key(k):
    return '"%s"' % k


class PatchError(RuntimeError):
    pass


def patch_once(text, needle, replacement, label):
    """يستبدل نصاً يجب أن يظهر مرّة واحدة فقط، ويشتكي بوضوح إن لم يظهر."""
    n = text.count(needle)
    if n != 1:
        raise PatchError(
            "الترقيع «%s» فشل: عدد التطابقات = %d (المتوقّع 1)" % (label, n))
    return text.replace(needle, replacement, 1)


# --------------------------------------------------------------------------
# ترقيعات المحرّك (النص مُصغَّر minified — كل مرساة تحقّقنا من تفرّدها)
# --------------------------------------------------------------------------

ENGINE_PATCHES = [
    # 1) قبل بناء اللعبة: افتح لوحة الإعداد وانتظر ضغطة «ابدأ اللعبة».
    (
        'boot-setup',
        'if(t&&t.mode==="game"){let i=Kh(',
        'if(t&&t.mode==="game"){'
        'if(window.__ROYAL_SETUP__)try{t.project=await window.__ROYAL_SETUP__(t.project)}'
        'catch(_rs){console.error("royal setup",_rs)}'
        'let i=Kh(',
    ),

    # 2) أيقونات الأزرار: اقبل data:/blob:/http بجانب معرّف الأصل.
    (
        'icon-dataurl',
        'iconFor(t){if(t.icon){let e=Qt(t.icon);if(e)return g("img",{src:e,alt:""})}',
        'iconFor(t){if(t.icon){let e=/^(data:|blob:|https?:)/.test(t.icon)?t.icon:Qt(t.icon);'
        'if(e)return g("img",{src:e,alt:""})}',
    ),

    # 3) تلوين الأزرار حسب اللون المختار عند كل إعادة تخطيط.
    (
        'hud-skin',
        's.classList.toggle("hidden",!o.visible)',
        's.classList.toggle("hidden",!o.visible),'
        'window.__ROYAL_SKIN__&&window.__ROYAL_SKIN__(s,o)',
    ),

    # 4) إعادة وضع شارة السلاح مع كل تخطيط/تغيير حجم للشاشة.
    (
        'hud-layout-end',
        'this.minimap&&this.minimap.layout(t,e,n)}',
        'this.minimap&&this.minimap.layout(t,e,n),'
        'window.__ROYAL_HUDL__&&window.__ROYAL_HUDL__(this)}',
    ),

    # 5) اختبار الحركة: يمرّ عبر __ROYAL_PASS__ (منع التسلّق + عوائق الأشجار).
    (
        'move-collision',
        'let b=.55,w=this.pos.x+this.vel.x*t,A=this.pos.z+this.vel.z*t,E=this.pos.y,'
        'z=this.groundY(this.pos.x,this.pos.z,E),M=this.groundY(w,this.pos.z,E),'
        'T=this.groundY(this.pos.x,A,E),'
        'C=M-z<=b&&!this.Q.isBlocked(w,this.pos.z),'
        'D=T-z<=b&&!this.Q.isBlocked(this.pos.x,A);',

        'let b=(window.__ROYAL_OPT__&&window.__ROYAL_OPT__.stepH!=null?window.__ROYAL_OPT__.stepH:.55),'
        'w=this.pos.x+this.vel.x*t,A=this.pos.z+this.vel.z*t,E=this.pos.y,'
        'z=this.groundY(this.pos.x,this.pos.z,E),M=this.groundY(w,this.pos.z,E),'
        'T=this.groundY(this.pos.x,A,E),'
        'C=window.__ROYAL_PASS__?window.__ROYAL_PASS__(this,w,this.pos.z,z,M,b)'
        ':(M-z<=b&&!this.Q.isBlocked(w,this.pos.z)),'
        'D=window.__ROYAL_PASS__?window.__ROYAL_PASS__(this,this.pos.x,A,z,T,b)'
        ':(T-z<=b&&!this.Q.isBlocked(this.pos.x,A));',
    ),

    # 6) بعد بناء الصناديق: ابنِ الأشجار التي وضعها اللاعب.
    (
        'world-extras',
        'this.buildCrates(),',
        'this.buildCrates(),window.__ROYAL_WORLD__&&window.__ROYAL_WORLD__(this),',
    ),

    # 7) شريط الأسلحة: أبلغ الشارة + لوّن الخانات.
    (
        'slots-hook',
        'setSlots(t,e){let n=this.ammoBox.querySelectorAll(".wslot");',
        'setSlots(t,e){window.__ROYAL_WEAP__&&window.__ROYAL_WEAP__(this,t,e);'
        'let n=this.ammoBox.querySelectorAll(".wslot");',
    ),

    # 8) صورة السلاح المخصّصة تسبق الصورة المولَّدة ثلاثياً.
    (
        'slot-custom-icon',
        'let l=this.thumbs?.[i.def.id]',
        'let l=(i.def.icon&&/^(data:|blob:|https?:)/.test(i.def.icon))?i.def.icon:this.thumbs?.[i.def.id]',
    ),

    # 9) عدّاد الذخيرة داخل الشارة.
    (
        'ammo-hook',
        'setAmmo(t){t&&(',
        'setAmmo(t){window.__ROYAL_AMMO__&&window.__ROYAL_AMMO__(this,t),t&&(',
    ),

    # 10) تصدير أصناف three.js + نظام الصوت (قبل إقلاع المحرّك).
    (
        'three-export',
        'document.readyState==="loading"?addEventListener("DOMContentLoaded",ep):ep()',
        'window.__ROYAL_THREE__={Group:te,Mesh:Dt,Box:on,Cyl:Br,Sph:gn,Ico:Hr,Std:ue,'
        'Basic:Ee,V3:P,Quat:Ne,Mat4:Wt,Inst:ss,Box3:Me,Color:Rt};'
        'window.__ROYAL_AUDIO__={init:function(){try{return us()}catch(e){return null}},'
        'ctx:function(){try{return Pt}catch(e){return null}},'
        'sfx:function(){try{return gi}catch(e){return null}}};'
        '(function(){var _g=jt.gun,_r=jt.reload,_rd=jt.reloadDone;'
        'jt.gun=function(k){if(window.__ROYAL_GUNSFX__&&window.__ROYAL_GUNSFX__(k))return;_g.call(jt,k)};'
        'jt.reload=function(){if(window.__ROYAL_RELSFX__&&window.__ROYAL_RELSFX__("start"))return;_r.call(jt)};'
        'jt.reloadDone=function(){if(window.__ROYAL_RELSFX__&&window.__ROYAL_RELSFX__("done"))return;_rd.call(jt)}})();'
        'window.__ROYAL_MENUMUSIC__=function(on){try{on?null:(Ia&&(clearInterval(Ia),Ia=null))}catch(e){}};'
        'document.readyState==="loading"?addEventListener("DOMContentLoaded",ep):ep()',
    ),

    # 11) عصا التصويب: دعم «تثبيت التصويب» (اضغط/اضغط).
    (
        'sticky-aim-reset',
        'a=()=>{s=!1,o=-1,e.style.transform="translate(0,0)",i.x=0,i.y=0,'
        't.id==="aim"&&(this.input.aiming=!1,this.cross.classList.remove("on"))}',

        'a=()=>{s=!1,o=-1,e.style.transform="translate(0,0)",i.x=0,i.y=0,'
        't.id==="aim"&&!(window.__ROYAL_STICK__&&window.__ROYAL_STICK__(this,t,"up"))'
        '&&(this.input.aiming=!1,this.cross.classList.remove("on"))}',
    ),
    (
        'sticky-aim-down',
        'l.preventDefault(),s=!0,o=l.pointerId,n.setPointerCapture(l.pointerId),'
        't.id==="aim"&&(this.input.aiming=!0,this.cross.classList.add("on")),c(l)',

        'l.preventDefault(),s=!0,o=l.pointerId,n.setPointerCapture(l.pointerId),'
        't.id==="aim"&&!(window.__ROYAL_STICK__&&window.__ROYAL_STICK__(this,t,"down"))'
        '&&(this.input.aiming=!0,this.cross.classList.add("on")),c(l)',
    ),
    (
        'sticky-aim-move',
        't.id==="aim"&&Math.hypot(i.x,i.y)>.16&&(this.input.aiming=!0,this.cross.classList.add("on"))',
        't.id==="aim"&&Math.hypot(i.x,i.y)>.16&&!(window.__ROYAL_OPT__&&window.__ROYAL_OPT__.stickyAim)'
        '&&(this.input.aiming=!0,this.cross.classList.add("on"))',
    ),

    # 12) عرض/طول مستقلّان لكل زر.
    (
        'button-wh',
        's.style.width=s.style.height=a+"px",s.style.left=o.x*t-a/2+"px",s.style.top=o.y*e-a/2+"px"',
        'var _w=a*(o.wk||1),_h=a*(o.hk||1);'
        's.style.width=_w+"px",s.style.height=_h+"px",'
        's.style.left=o.x*t-_w/2+"px",s.style.top=o.y*e-_h/2+"px"',
    ),

    # 13) الماء الداخلي (الأودية) لم يعد يدفع اللاعب للخارج — البحر وحده هو الحدّ.
    (
        'inner-water',
        'if(!this.Q.isLand(this.pos.x,this.pos.z)){let e=this.Q.nearestLand(this.pos.x,this.pos.z,3);',
        'if(!(window.__ROYAL_WATEROK__&&window.__ROYAL_WATEROK__())'
        '&&!this.Q.isLand(this.pos.x,this.pos.z)){let e=this.Q.nearestLand(this.pos.x,this.pos.z,3);',
    ),

    # 14) وضع البناء: لا زون ولا ضرر.
    (
        'zone-off',
        'updZone(t){let e=this.zone;',
        'updZone(t){if(window.__ROYAL_OPT__&&window.__ROYAL_OPT__.build)return;let e=this.zone;',
    ),

    # 15) نداء بعد اكتمال بناء المباراة (HUD والبوتات جاهزة).
    (
        'ready-hook',
        't(1,"\\u0627\\u0646\\u0637\\u0644\\u0642!"),this.beginFlight(),this.loop()',
        't(1,"\\u0627\\u0646\\u0637\\u0644\\u0642!"),'
        'window.__ROYAL_READY__&&window.__ROYAL_READY__(this),'
        'this.beginFlight(),this.loop()',
    ),

    # 16) ارتفاع الأرض: يمنع القفز فوق أسطح البيوت الصغيرة عند محاولة الدخول.
    (
        'ground-hook',
        'groundY(t,e,n){return this.Q.groundFor(t,e,n===void 0?this.pos?.y??1e5:n)}',
        'groundY(t,e,n){var _g=this.Q.groundFor(t,e,n===void 0?this.pos?.y??1e5:n);'
        'return window.__ROYAL_GY__?window.__ROYAL_GY__(this,t,e,n,_g):_g}',
    ),

    # 17) اتجاه الشخصية: تنظر لجهة حركتها بدل ظهرها للكاميرا.
    (
        'face-move',
        'let O=this.yaw+Math.PI,U=I>.6?Math.atan2(this.vel.x,this.vel.z):void 0;this.player.update(t,{',
        'let O=this.yaw+Math.PI,U=I>.6?Math.atan2(this.vel.x,this.vel.z):void 0;'
        'if(window.__ROYAL_FACE__){var _fy=window.__ROYAL_FACE__(this,O,U,e.aiming||e.shoot);'
        'if(_fy!==void 0){O=_fy;U=void 0}}'
        'this.player.update(t,{',
    ),

    # 18) الأعداء لا يطلقون النار عبر الجدران.
    (
        'bot-los',
        's.fire=me(.35,1.1)/(.4+this.P.match.botSkill);let M=s.pos.clone();M.y+=s.ch.totalH*.7;'
        'let T=this.pos.clone();T.y+=this.player.totalH*.6,this.addTracer(M,T),'
        'Math.random()<this.P.match.botSkill*wt(1-E/70,.15,1)&&this.damage(me(4,9),s.name)',

        's.fire=me(.35,1.1)/(.4+this.P.match.botSkill);let M=s.pos.clone();M.y+=s.ch.totalH*.7;'
        'let T=this.pos.clone();T.y+=this.player.totalH*.6;'
        'if(!window.__ROYAL_LOS__||window.__ROYAL_LOS__(this,M,T)){this.addTracer(M,T),'
        'Math.random()<this.P.match.botSkill*wt(1-E/70,.15,1)&&this.damage(me(4,9),s.name)}',
    ),

    # 19) صوت الهبوط/الرياح: طبقتان (هدير منخفض + هسيس هوائي) بدل ضجيج حادّ.
    (
        'wind-sound',
        'start(){if(!us()||this.on||!Vn.sfx)return;this.on=!0;let t=Pt.currentTime,'
        'e=Pt.createBufferSource();e.buffer=Na(),e.loop=!0;let n=Pt.createBiquadFilter();'
        'n.type="bandpass",n.frequency.value=900,n.Q.value=.5;let i=Pt.createGain();'
        'i.gain.setValueAtTime(1e-4,t),i.gain.exponentialRampToValueAtTime(.3,t+.8),'
        'e.connect(n),n.connect(i),i.connect(gi),e.start(t),this.n={s:e,g:i,bp:n}}'
        'set(t){if(!this.on)return;let e=Pt.currentTime;'
        'this.n.g.gain.setTargetAtTime(.06+.34*t,e,.2),'
        'this.n.bp.frequency.setTargetAtTime(500+1400*t,e,.2)}',

        'start(){if(!us()||this.on||!Vn.sfx)return;this.on=!0;let t=Pt.currentTime,'
        'e=Pt.createBufferSource();e.buffer=Na(),e.loop=!0;'
        'let n=Pt.createBiquadFilter();n.type="lowpass",n.frequency.value=300,n.Q.value=.9;'
        'let r2=Pt.createBiquadFilter();r2.type="bandpass",r2.frequency.value=1100,r2.Q.value=.7;'
        'let g2=Pt.createGain();g2.gain.value=.30;'
        'let i=Pt.createGain();'
        'i.gain.setValueAtTime(1e-4,t),i.gain.exponentialRampToValueAtTime(.26,t+1.1);'
        'e.connect(n),n.connect(i),e.connect(r2),r2.connect(g2),g2.connect(i),i.connect(gi);'
        'let l2=Pt.createOscillator();l2.frequency.value=.23;'
        'let l3=Pt.createGain();l3.gain.value=70;l2.connect(l3),l3.connect(n.frequency),l2.start(t);'
        'e.start(t),this.n={s:e,g:i,bp:n,air:r2,ag:g2,lfo:l2}}'
        'set(t){if(!this.on)return;let e=Pt.currentTime;'
        'this.n.g.gain.setTargetAtTime(.05+.30*t,e,.28),'
        'this.n.bp.frequency.setTargetAtTime(190+520*t,e,.28),'
        'this.n.air.frequency.setTargetAtTime(850+1500*t,e,.28),'
        'this.n.ag.gain.setTargetAtTime(.10+.34*t*t,e,.28)}',
    ),

    # 20) ضرر الزون على اللاعب يتدرّج بدل أن يبدأ كاملاً.
    (
        'zone-ramp',
        'let c=(e.cfg.damageStart??2)+e.phase*(e.cfg.damageStep??3);'
        'this.damage(c*t,"\\u0627\\u0644\\u0632\\u0648\\u0646")',

        'let c=(e.cfg.damageStart??2)+e.phase*(e.cfg.damageStep??3);'
        'if(window.__ROYAL_ZONE__)c=window.__ROYAL_ZONE__(this,c,t,n-e.r);'
        'c>0&&this.damage(c*t,"\\u0627\\u0644\\u0632\\u0648\\u0646")',
    ),

    # 21) البوتات خارج الزون تتأذّى أسرع وتتّجه نحو المركز حتى تموت أو تعود.
    (
        'zone-bots',
        'for(let o of this.bots)!o.alive||!o.landed||Math.hypot(o.pos.x-i.cx,o.pos.z-i.cz)>i.r'
        '&&(o.hp-=s*t,o.hp<=0&&this.killBot(o,!1))',

        'for(let o of this.bots)!o.alive||!o.landed||Math.hypot(o.pos.x-i.cx,o.pos.z-i.cz)>i.r'
        '&&(o.hp-=s*t*((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.zoneBotMul)||1),'
        'o.target&&(o.target.x+=(i.cx-o.target.x)*.35,o.target.z+=(i.cz-o.target.z)*.35),'
        'o.hp<=0&&this.killBot(o,!1))',
    ),

    # 22) سلاح اليد لا يُقصّ من منظور الشخص الثالث.
    (
        'handgun-cull',
        'n.rotation.set(e.hold.rx,e.hold.ry,e.hold.rz),this.handGun.add(n)',
        'n.rotation.set(e.hold.rx,e.hold.ry,e.hold.rz),'
        'n.traverse(_m=>{_m.isMesh&&(_m.frustumCulled=!1,_m.renderOrder=2)}),'
        'this.handGun.add(n)',
    ),

    # 23) أثناء الهبوط بالمظلة: الشخصية تنظر لجهة سقوطها لا لعكسها.
    (
        'chute-face',
        'Math.hypot(this.vel.x,this.vel.z)>.4&&(this.player.st.yaw=Math.atan2(this.vel.x,this.vel.z)),'
        'this.player.root.rotation.y=this.player.st.yaw',

        'Math.hypot(this.vel.x,this.vel.z)>.4&&(this.player.st.yaw=Math.atan2(this.vel.x,this.vel.z)),'
        'this.player.root.rotation.y=this.player.st.yaw+((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.faceFlip)?Math.PI:0)',
    ),

    # 24) زرّ التقريب يُخرجك من التصويب أيضاً (كان يعلق مع تثبيت التصويب).
    (
        'scope-exit',
        'else if(t.id==="scope"){o&&(this.input.scopeOn=!this.input.scopeOn,'
        'n.classList.toggle("locked",this.input.scopeOn));return}',

        'else if(t.id==="scope"){if(o){if(this.input.scopeOn||this.input.aiming)'
        '{this.input.scopeOn=!1,this.input.aiming=!1,this.cross.classList.remove("on")}'
        'else this.input.scopeOn=!0;n.classList.toggle("locked",this.input.scopeOn)}return}',
    ),

    # 25) رصاص اللاعب لا يخترق الجدران والتضاريس.
    (
        'player-wall',
        'let c=t.clone().addScaledVector(e,i||o?s:n.range);',
        'let _md=i||o?s:n.range;'
        'if(window.__ROYAL_WALL__){let _wd=window.__ROYAL_WALL__(this,t,e,_md);'
        'if(_wd!=null){_md=_wd;if(_wd<s-.05){i=null;o=null}}}'
        'let c=t.clone().addScaledVector(e,_md);',
    ),

    # 26) حساسية النظر: قابلة للضبط + تنعيم.
    (
        'look-sens',
        'a=(this.P.match.lookSens||1)*.0032,c=this.hud.takeLook();this[e]-=c.x*a,',
        'a=(this.P.match.lookSens||1)*.0032*((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.sens)||1)'
        '*((this.hud.input.aiming||this.hud.input.scopeOn)?((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.adsSens)||1):1),'
        'c=this.hud.takeLook();'
        'if(window.__ROYAL_OPT__&&window.__ROYAL_OPT__.smooth>0){var _s=window.__ROYAL_OPT__.smooth;'
        'this._lkx=(this._lkx||0)*_s+c.x*(1-_s);this._lky=(this._lky||0)*_s+c.y*(1-_s);'
        'c={x:this._lkx,y:this._lky}}'
        'this[e]-=c.x*a,',
    ),

    # 27) الأونلاين: ابدأ فوراً عند اكتمال العدد المطلوب.
    (
        'net-target',
        'p<=0&&_()},1e3)',
        'p<=0&&_(),b>=((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.netTarget)||99)&&_()},1e3)',
    ),

    # 28) الميكروفون: نمرّر اتصال WebRTC لطبقة الصوت قبل إنشاء العرض.
    (
        'voice-pc',
        'n={pc:i,dc:null,open:!1},this.conns.set(t,n);',
        'n={pc:i,dc:null,open:!1},this.conns.set(t,n);'
        'try{window.__ROYAL_VOICE_PC__&&window.__ROYAL_VOICE_PC__(i,t)}catch(_v){}',
    ),

    # 29) تصحيح اتجاه السلاح بعد قلب دوران الشخصية.
    (
        'gun-yaw',
        'n.rotation.set(e.hold.rx,e.hold.ry,e.hold.rz),'
        'n.traverse(_m=>{_m.isMesh&&(_m.frustumCulled=!1,_m.renderOrder=2)}),',

        'n.rotation.set(e.hold.rx,e.hold.ry+((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.gunFlip)?Math.PI:0),e.hold.rz),'
        'n.traverse(_m=>{_m.isMesh&&(_m.frustumCulled=!1,_m.renderOrder=2)}),',
    ),

    # 30) خريطة مضلّعات دقيقة للاصطدام: نمرّر جذر الخريطة بعد تحميلها.
    (
        'map-mesh',
        'this.Q=Ga(this.an),',
        'this.Q=Ga(this.an),window.__ROYAL_MAPMESH__&&window.__ROYAL_MAPMESH__(this),',
    ),

    # 31) زرّا «فتح الصندوق» و«الالتقاط» يظهران فقط عند وجود شيء قريب.
    (
        'ctx-buttons',
        'this.nearCrate=e,',
        'this.nearCrate=e,window.__ROYAL_CTX__&&window.__ROYAL_CTX__(this,e,i),',
    ),

    # 32) الأعداء يُسقطون غنائمهم عند مقتلهم.
    (
        'bot-drop',
        'killBot(t,e){t.alive=!1,t.ch.group.visible=!1,this.stats.alive--,',
        'killBot(t,e){t.alive=!1,'
        'window.__ROYAL_DROP__&&window.__ROYAL_DROP__(this,t),'
        't.ch.group.visible=!1,this.stats.alive--,',
    ),

    # 33) إصابة دقيقة: كرة رأس + كرة جسم بدل كرة واحدة كبيرة.
    (
        'precise-hit',
        'for(let l of this.bots){if(!l.alive||!l.landed||l.ally)continue;'
        'a.copy(l.pos).sub(t),a.y+=l.ch.totalH*.55;let h=a.dot(e);if(h<.6||h>s)continue;'
        'a.clone().addScaledVector(e,-h).length()<1.05&&(i=l,s=h)}',

        'this._hs=!1;for(let l of this.bots){if(!l.alive||!l.landed||l.ally)continue;'
        'if(window.__ROYAL_HIT__){let _r=window.__ROYAL_HIT__(this,t,e,l,s);'
        'if(_r){i=l,s=_r.d,this._hs=_r.head}continue}'
        'a.copy(l.pos).sub(t),a.y+=l.ch.totalH*.55;let h=a.dot(e);if(h<.6||h>s)continue;'
        'a.clone().addScaledVector(e,-h).length()<1.05&&(i=l,s=h)}',
    ),

    # 34) ضرر إضافي لإصابة الرأس.
    (
        'headshot',
        'if(i){jt.hit();let l=n.damage;',
        'if(i){jt.hit();let l=n.damage*(this._hs?((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.headMul)||2.2):1);'
        'this._hs&&this.hud.feed("\\u{1F3AF} \\u0625\\u0635\\u0627\\u0628\\u0629 \\u0631\\u0623\\u0633!");',
    ),

    # 38) موسيقى القائمة: أعطِ الأولوية للمقطوعة التي رفعها المطوّر.
    (
        'menu-music',
        'function lh(){if(!us()||Ia||!Vn.music)return;',
        'function lh(){if(!us()||Ia||!Vn.music)return;'
        'if(window.__ROYAL_MENU__&&window.__ROYAL_MENU__())return;',
    ),

    # 36) المظلّة: تسارع وكبح قابلان للضبط ليكون التحرّك سلساً وسريعاً.
    (
        'chute-accel',
        'let i=e?16:26,s=n.move.x',
        'let i=e?((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.chuteAcc)||16):26,s=n.move.x',
    ),
    (
        'chute-damp',
        'let d=e?2.6:1.1;',
        'let d=e?((window.__ROYAL_OPT__&&window.__ROYAL_OPT__.chuteDamp)||2.6):1.1;',
    ),

    # 37) البوتات تستعمل نفس اصطدام المضلّعات فلا تصعد فوق البيوت.
    (
        'bot-move',
        'this.groundY(_,s.pos.z,m)-p<=.55?s.pos.x=_:s.vel.x*=-.4,'
        'this.groundY(s.pos.x,v,m)-p<=.55?s.pos.z=v:s.vel.z*=-.4,',

        '(window.__ROYAL_MOVE__?window.__ROYAL_MOVE__(this,s.pos,_,s.pos.z):this.groundY(_,s.pos.z,m)-p<=.55)'
        '?s.pos.x=_:s.vel.x*=-.4,'
        '(window.__ROYAL_MOVE__?window.__ROYAL_MOVE__(this,s.pos,s.pos.x,v):this.groundY(s.pos.x,v,m)-p<=.55)'
        '?s.pos.z=v:s.vel.z*=-.4,',
    ),

    # 35) مساعدة التصويب اختيارية (تصويب مباشر عند إطفائها).
    (
        'aim-assist',
        'd===1&&(y=this.aimAssist(c,y,s.range)),this.shootRay(c,y,s)}',
        'd===1&&!(window.__ROYAL_OPT__&&window.__ROYAL_OPT__.directAim)&&(y=this.aimAssist(c,y,s.range)),'
        'this.shootRay(c,y,s)}',
    ),
]


def swap_assets(html):
    """يفك ضغط حمولة اللعبة ويستبدل نماذج .glb المطلوبة ثم يعيد ضغطها."""
    swaps = {k: v for k, v in ASSET_SWAPS.items() if os.path.exists(v)}
    if not swaps:
        return html

    m = re.search(r'(<script id="royal-payload-gz"[^>]*>)(.*?)(</script>)', html, re.S)
    if not m:
        raise PatchError("لم أجد كتلة الحمولة royal-payload-gz")

    data = gzip.decompress(base64.b64decode(m.group(2).strip())).decode("utf-8")

    for asset_id, path in swaps.items():
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        # ‏{"id":"<asset_id>", ... ,"b64":"<data>"}  — نستبدل أول b64 بعد المعرّف فقط
        pat = r'("id":"%s"(?:(?!"b64").)*?"b64":")[^"]*(")' % re.escape(asset_id)
        data, n = re.subn(pat, lambda mm: mm.group(1) + b64 + mm.group(2), data, count=1)
        if n != 1:
            raise PatchError("استبدال النموذج «%s» فشل (تطابقات=%d)" % (asset_id, n))
        print("  ✔ نموذج %s ← %s (%.0f كيلوبايت)" % (asset_id, os.path.basename(path), len(b64) / 1365.0))

    packed = base64.b64encode(
        gzip.compress(data.encode("utf-8"), 9)).decode("ascii")
    return html[:m.start(2)] + packed + html[m.end(2):]


def check_syntax(html):
    """يتأكّد أن كتلتي السكربت صالحتان نحوياً — يمنع شحن ملف مكسور."""
    import json as _json
    import subprocess
    import tempfile
    blocks = {}
    for name in ("royal-setup", "royal-engine"):
        tag = '<script id="%s">' % name
        i = html.index(tag) + len(tag)
        j = html.index("</script>", i)
        blocks[name] = html[i:j]
    with tempfile.TemporaryDirectory() as d:
        paths = {}
        for k, v in blocks.items():
            fp = os.path.join(d, k + ".js")
            with io.open(fp, "w", encoding="utf-8") as f:
                f.write(v)
            paths[k] = fp
        script = ";".join(
            "try{new Function(require('fs').readFileSync(%s,'utf8'))}"
            "catch(e){console.log('BAD %s: '+e.message);process.exit(3)}" % (_json.dumps(p), k)
            for k, p in paths.items())
        r = subprocess.run(["node", "-e", script + ";console.log('syntax ok')"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise PatchError("خطأ صياغة في الملف الناتج:\n" + (r.stdout + r.stderr).strip())
    print("  ✔ فحص الصياغة")


def build(src_path, out_path):
    with io.open(src_path, "r", encoding="utf-8") as f:
        html = f.read()

    with io.open(os.path.join(HERE, "setup.css"), "r", encoding="utf-8") as f:
        css = f.read()
    with io.open(os.path.join(HERE, "setup.js"), "r", encoding="utf-8") as f:
        js = f.read()

    if "__ROYAL_SETUP__" in html:
        raise PatchError("هذا الملف مُرقَّع مسبقاً — استخدم الملف الأصلي.")

    # ---- 1) أضف الستايل إلى نهاية ستايل اللعبة
    marker = "</style>\n<div id=\"app\"></div>"
    if marker not in html:
        raise PatchError("لم أجد نهاية كتلة <style id=\"royal-css\">")
    html = html.replace(marker, "\n" + css + "\n" + marker, 1)

    # ---- 2) رقّع المحرّك
    tag = '<script id="royal-engine">'
    i = html.index(tag)
    j = html.index("</script>", i)
    engine = html[i + len(tag):j]

    for label, needle, repl in ENGINE_PATCHES:
        engine = patch_once(engine, needle, repl, label)
        print("  ✔ %s" % label)

    html = html[:i + len(tag)] + engine + html[j:]

    # ---- 3) احقن سكربت الإعداد قبل المحرّك
    prefs = '<script id="royal-prefs" type="application/json">null</script>\n' + sfx_block()
    setup_tag = '<script id="royal-setup">\n' + js + '\n</script>\n'
    html = html.replace(tag, prefs + setup_tag + tag, 1)

    # ---- 4) استبدال النماذج ثلاثية الأبعاد داخل الحمولة
    html = swap_assets(html)

    # ---- 5) تحقّق من سلامة الصياغة قبل الكتابة
    check_syntax(html)

    with io.open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print("\nتم: %s  (%.1f ميجابايت)" % (out_path, os.path.getsize(out_path) / 1048576.0))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    try:
        build(sys.argv[1], sys.argv[2])
    except PatchError as e:
        print("خطأ: %s" % e)
        sys.exit(2)
