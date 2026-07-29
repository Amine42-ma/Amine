# NOVA Engine 2.0

**محرك ألعاب احترافي كامل داخل ملف HTML واحد — بدون أي مكتبة خارجية.**

<div dir="rtl">

كل شيء مكتوب يدويًا: المحرك الرسومي، الفيزياء، الذكاء الاصطناعي، الصوت،
لغة البرمجة، والمحرر نفسه. لا Three.js ولا Babylon.js ولا أي اعتماد
سحابي — فقط `index.html`.

## التشغيل

افتح `index.html` في أي متصفح حديث. لا حاجة لخادم ولا تثبيت.

```bash
# اختياريًا، لتجربته على الهاتف عبر نفس الشبكة
python3 -m http.server 8080
```

## اللغة: NovaScript

لغة قريبة من اللغة الطبيعية، تدعم الكلمات المفتاحية بالعربية والإنجليزية،
مع إكمال تلقائي وفحص أخطاء فوري داخل المحرر.

```
make speed = 6

when start:
    say "بدأت اللعبة!"

when update:
    if key "W" is down:
        move forward by speed * dt

when key "space" pressed:
    jump 7

when collide with "Enemy":
    add score 1
    destroy other
```

خط الأنابيب: مُحلل لغوي ← مُحلل نحوي ← مترجم إلى إغلاقات JavaScript
(أسرع بكثير من المفسّر الشجري)، مع رسائل خطأ عربية تحمل رقم السطر والعمود.

### الجديد في 2.0 — لغة كاملة

سهلة للمبتدئ كما هي، وقوية للمحترف: أصناف ووراثة وواجهات، وبنى تُنسخ
بالقيمة، ومكوّنات تُربط بالكائنات مباشرة، ووحدات تُستورد بين الملفات،
وبرمجة غير متزامنة عبر `async/await` و Coroutines حقيقية تتوقف وتستأنف
عبر أي عمق من الاستدعاءات.

```
import "Utils"

interface Damageable:
    function takeHit(amount)

class Actor:
    make hp = 100
    function takeHit(amount):
        this.hp = this.hp - amount
        if this.hp <= 0:
            this.die()
    function die():
        say this.name + " سقط"

class Enemy extends Actor implements Damageable:
    make speed = 3
    function chase(target):
        AI.moveTo(self, target, this.speed)

struct Point:
    make x = 0
    make y = 0

component Patrol:
    make speed = 2
    make radius = 5
    when start:
        start this.loop()          # coroutine
    coroutine loop():
        repeat forever:
            await this.goTo(this.radius)
            await this.goTo(0 - this.radius)
    coroutine goTo(x):
        wait 1.5
        Physics.setVelocity(self, x, 0, 0)
    when collide with "Player":
        Audio.play("hit")
```

| الميزة | الكلمات |
|---|---|
| **الأنواع** | `class` · `struct` · `interface` · `component` · `extends` · `implements` · `new` · `this` · `super` · `static` |
| **البيانات** | مصفوفات `[]` · قواميس `Dict(...)` بواجهة `get/set/has/remove/keys/values` |
| **التدفّق** | `try/catch/finally` · `throw` · `switch/case` · `repeat` · `for each` |
| **التزامن** | `async` · `await` · `coroutine` · `yield` · `start` · `wait` |
| **الوحدات** | `import` · `export` — مع فحص الأسماء المستوردة داخل المحرر |
| **الأحداث** | `when start/update/collide/key/message` داخل الأصناف والمكوّنات |
| **الفضاءات** | `Physics` · `AI` · `Animation` · `Audio` · `UI` · `Net` · `Scene` · `Input` · `Time` · `Storage` · `Math` · `Dict` · `List` |

الـ Coroutines مبنية على مولّدات JavaScript، فتتوقف عند `wait` أو `await`
داخل أي دالة متداخلة وتستأنف من نفس النقطة — وليست مجرد مؤقتات.

## ما بداخل المحرك

| النظام | التفاصيل |
|---|---|
| **الرسومات** | WebGL2 مع تحويل تلقائي إلى WebGL1 · إضاءة PBR · ظلال PCF · انعكاسات مستوية · سماء ديناميكية بدورة ليل/نهار · ضباب ارتفاعي · توهج Bloom · FXAA · تعيين نغمة ACES · تدرّج ألوان |
| **الفيزياء** | أجسام صلبة · مصادمات OBB/كرة/كبسولة/مستوٍ/تضاريس · SAT للصناديق · محرك شخصيات (منحدرات، درجات، سلالم، سباحة) · مركبات · أقمشة وحبال (Verlet) · سوائل (SPH مبسّط) · مصاعد |
| **الذكاء الاصطناعي** | A* على شبكة تنقل مبنية تلقائيًا · آلات حالات · أشجار سلوك · قواعد قابلة للتعلّم · سلوك أسراب · مخروط رؤية وسمع |
| **البيئة** | تضاريس قابلة للنحت بالفرشاة · ماء بأمواج وانعكاس · طقس (مطر، ثلج، عاصفة، رمال، ضباب) · رياح وعصفات · أشجار وصخور وعشب مولّدة إجرائيًا |
| **الصوت** | Web Audio · مازج قنوات · صوت ثلاثي الأبعاد (HRTF) · دوبلر · مؤثرات مولّدة |
| **الحركة** | مقاطع بالمفاتيح · مزج · أحداث · IK بعظمتين و CCD · هيكل عظمي جاهز |
| **الشبكات** | غرف محلية عبر BroadcastChannel · خادم WebSocket محلي · مزامنة · دردشة · حفظ حالة العالم |
| **الصيغ** | GLB · GLTF · OBJ · FBX (نصي وثنائي) · STL · DAE · PLY · PNG · JPG · GIF · SVG · WebP · BMP · ICO · MP3 · WAV · OGG · AAC · FLAC · MP4 · WEBM · JSON · XML · TXT |

## المحرر

نوافذ قابلة للسحب والإرساء وتغيير الحجم، مع حفظ التخطيط:
الهيكل · الخصائص · المشروع · الأصول · الطرفية · محرر الكود · البرمجة المرئية
بالعقد · الخامات · الحركة · الجسيمات · التضاريس · واجهة المستخدم · الشيدر ·
الصوت · البيئة · الأداء · الشبكة · أزرار اللمس.

تراجع/إعادة بلا حدود، وضع ليلي وفاتح، اختصارات لوحة مفاتيح كاملة،
ومحرر يعمل على الهاتف واللوحي والحاسوب.

## واجهة الهاتف (2.0)

ليست نسخة مصغّرة من واجهة الحاسوب، بل هيكل مستقل يُبنى تلقائيًا عند فتح
المحرر على شاشة صغيرة أو جهاز لمس:

- شريط تبويبات سفلي: المشهد · الكائنات · الخصائص · الأصول · الكود · المزيد.
- ورقة سفلية (Bottom Sheet) قابلة للسحب لتغيير ارتفاعها أو ملء الشاشة،
  تستضيف اللوحات نفسها بنقلها في شجرة DOM — فلا تفقد حالتها عند التبديل.
- كل الأزرار بحد أدنى 44 بكسل، مع احترام مناطق الأمان (النوتش والشريط السفلي).
- قوائم السياق تتحوّل إلى قوائم إجراءات كبيرة تُفتح من الأسفل.
- زر إضافة عائم يفتح شبكة كائنات جاهزة، وشريط أدوات عمودي للتحديد/النقل/التدوير/التحجيم.
- يمكن فرض وضع الهاتف أو الحاسوب يدويًا من قائمة العرض.

## نظام اللمس (2.0)

مُميِّز إيماءات واحد لكل سطح، يتخذ القرار **مرة واحدة** عند بدء السحب،
فلا تتنازع الكاميرا والكائن على نفس اللمسة أبدًا:

| الإيماءة | النتيجة |
|---|---|
| نقرة واحدة | تحديد الكائن |
| نقرة مزدوجة | التركيز على الكائن (أو تأطير المشهد في الفراغ) |
| ضغطة مطوّلة | قائمة سياق + اهتزاز خفيف |
| سحب بإصبع | يحرّك الكاميرا، إلا إذا كانت أداة نقل/تدوير/تحجيم مفعّلة والكائن محدَّدًا |
| إصبعان | تحريك جانبي (Pan) |
| تقريب/تبعيد | تكبير (Zoom) |
| تدوير بإصبعين | تدوير المنظور |
| لمس متعدد | مدعوم كاملًا في المحرر واللعبة |

**قاعدة المشهد:** لا يتحرك أي كائن ما لم تُختَر أداة التحريك صراحةً؛
اللمس في الفراغ يحرّك الكاميرا فقط. الأداة الافتراضية هي «تحديد».

## مدير الملفات (2.0)

استيراد بالسحب والإفلات أو من مُنتقي ملفات الجهاز، مع تعرّف تلقائي على
النوع من الامتداد ثم من نوع MIME:

| النوع | الصيغ | السلوك |
|---|---|---|
| صورة | PNG · JPG · JPEG · WEBP · GIF · BMP · SVG · ICO · AVIF · TIFF | يسألك: Sprite أم لوح ثلاثي الأبعاد أم أرضية أم Texture فقط |
| مجسم | GLB · GLTF · OBJ · FBX · STL · DAE · PLY · 3DS | يدخل المشهد مباشرةً مع Collider، ويُعاد تحجيمه تلقائيًا إن كان ضخمًا أو مجهريًا |
| صوت | MP3 · WAV · OGG · AAC · FLAC · M4A · OPUS | أقصر من 20 ثانية ← Audio Asset على قناة المؤثرات، وأطول ← Music Asset على قناة الموسيقى |
| فيديو | MP4 · WEBM · OGV · MOV | لوح فيديو في المشهد |
| بيانات | JSON · XML · TXT · CSV · MD · YAML · INI | أصل بيانات يُقرأ من السكربتات |
| سكربت | NOVA · NS | يُضاف إلى ملفات المشروع ويُترجَم فورًا |
| مشروع | ‎.novaproj · .novascene‎ | يُفتح بدل أن يُخزَّن كأصل |

كل ما يُستورد يظهر في متصفح الأصول ويمكن سحبه وإفلاته داخل المشهد.

**السحب والإفلات باللمس:** سحب HTML5 القياسي لا يعمل على شاشات اللمس إطلاقًا،
لذلك أُضيفت طبقة سحب مبنية على الـ Pointer تغطي اللمس والقلم: اضغط مطوّلًا على
الأصل (‎280 مللي ثانية مع اهتزاز خفيف) ثم اسحبه إلى المشهد. تمرير عادي بالإصبع
يظل يمرّر القائمة، والنقرة تظل تحدّد. على الهاتف تنزلق الورقة السفلية تلقائيًا
أثناء السحب لتكشف المشهد تحت إصبعك، ثم تعود كما كانت.

## التحكم متعدد المنصات

- أزرار لمس قابلة للسحب وتغيير الحجم واللون والشفافية، مع دعم اللمس المتعدد.
- عصا تحكم افتراضية ومنطقة نظر.
- لوحة مفاتيح، فأرة كاملة الأزرار، عجلة، ووحدات تحكم Gamepad.
- خرائط تحكم قابلة للتخصيص لكل لعبة، مع وضع تلقائي/هاتف/حاسوب.

## التصدير

| الصيغة | الناتج |
|---|---|
| **HTML** | ملف واحد مستقل يعمل بالنقر المزدوج، دون إنترنت |
| **PWA** | حزمة قابلة للتثبيت (manifest + service worker + أيقونات) تعمل دون اتصال |
| **Android** | مشروع Gradle كامل + سكربت بناء بأمر واحد لإنتاج APK |
| **مشروع** | ‎`.novaproj`‎ قابل للاستيراد |

> **ملاحظة صريحة حول APK:** توليد ملف `.apk` نهائي يتطلب ترجمة Java إلى DEX
> وتوقيعًا رقميًا، وهي خطوة لا يمكن تنفيذها داخل المتصفح. لذلك يصدّر المحرك
> **مشروع Android كاملًا** يحتوي لعبتك مضمّنة داخل WebView أصلي، مع
> `build-apk.sh` / `build-apk.bat` لبنائه بأمر واحد. البديل الفوري بدون أي
> أدوات هو تصدير **PWA** وتثبيته من متصفح الهاتف — يعمل بملء الشاشة ودون
> إنترنت تمامًا كتطبيق أصلي.

## القوالب الجاهزة

مغامرة 3D · منصات · منظور أول · سباق · منظور علوي · لعبة 2D · مشروع فارغ.

## البنية

ملف واحد، ‎~20.6 ألف سطر، مقسّم إلى 30 وحدة مستقلة:

```
الرياضيات · ECS · الهندسة · الشيدرات · العارض · خط الأنابيب · المكوّنات ·
الفيزياء · أنظمة العالم · لغة NovaScript · NovaScript 2.0 · واجهة اللغة البرمجية ·
المدخلات · الصوت/الحركة/الذكاء · الأصول · نواة المحرك · مشغّل اللعبة · الإيماءات ·
هيكل المحرر · نواة المحرر · اللوحات · المحررات المتخصصة · واجهة الهاتف ·
مدير الملفات · السحب باللمس · البناء · القوائم · التوثيق
```

وحدات 2.0 مبنية فوق نواة 1.0 بالامتداد لا بإعادة الكتابة: تُوسِّع المُحلل
والمترجم عبر تغليف دوالهما الأصلية، وتعيد استخدام لوحات المحرر نفسها
بنقلها في شجرة DOM بدل بنائها من جديد.

الوحدات الخاصة بالمحرر موسومة بـ `data-nova="editor"` ولا تُصدَّر مع اللعبة،
فيخرج ملف اللعبة أصغر بنحو 30%.

</div>

---

## English summary

A complete, dependency-free game engine and editor in a single HTML file.
Hand-written WebGL2 renderer (PBR, shadows, planar reflections, procedural sky,
bloom, ACES), custom rigid-body physics with character/vehicle/cloth/rope/fluid
solvers, A* navmesh AI with FSM and behaviour trees, Web Audio mixer with 3D
sound, skeletal animation with IK, and **NovaScript** — a natural-language
scripting language (lexer → parser → closure compiler) with autocomplete and
live diagnostics.

Importers written from scratch for GLB/GLTF/OBJ/FBX/STL/DAE/PLY plus every
common image, audio and video format. Exports to standalone HTML, installable
PWA, or a buildable Android project. The editor itself is a dockable,
themeable, touch-capable IDE that runs on phones, tablets and desktops.

### 2.0

- **Language**: classes, inheritance, interfaces, value-semantics structs,
  attachable components, dictionaries, `try/catch/finally`, `switch`, modules
  with `import`/`export`, `async`/`await`, and generator-backed coroutines that
  suspend across arbitrary call depth. Namespaced APIs for `Physics`, `AI`,
  `Animation`, `Audio`, `UI`, `Net`, `Scene`, `Input`, `Time` and `Storage`.
- **Mobile shell**: a purpose-built phone UI — bottom tab bar, draggable bottom
  sheet, 44 px touch targets, safe-area aware, action sheets in place of
  context menus. Panels are re-parented rather than rebuilt, so state survives.
- **Gestures**: one recognizer per surface emitting tap, double tap, long
  press, drag, pan, pinch, rotate and multi-touch. The camera-versus-object
  decision is made once at drag start, so the two can never fight. Nothing in
  the scene moves unless a transform tool is active.
- **File manager**: drag-and-drop or device picker, automatic type detection,
  audio split into SFX and music by duration, models placed straight into the
  scene with auto-rescaling, and a usage prompt for images (sprite, 3D quad,
  ground, or texture only). Because HTML5 drag-and-drop never fires on touch
  screens, a pointer-based drag layer covers touch and pen: hold an asset
  briefly, then drag it into the scene. A plain swipe still scrolls the list,
  and on a phone the bottom sheet ducks out of the way mid-drag.

Open `index.html` — that's it.
