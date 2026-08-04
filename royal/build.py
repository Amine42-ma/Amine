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

import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


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
]


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
    setup_tag = '<script id="royal-setup">\n' + js + '\n</script>\n'
    html = html.replace(tag, setup_tag + tag, 1)

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
