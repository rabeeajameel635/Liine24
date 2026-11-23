# تنزيل البرنامج على الماك من الصفر

لماك فاضي (MacBook Air M1، 8 جيجا)، وعليه Node 24. البرنامج بيتحط في `~/Liine24`، وآخر خطوة بيفتح على `http://127.0.0.1:4317` ببيانات فاضية.

كل الأوامر بتتكتب في Terminal (Spotlight ← اكتب Terminal). انسخ كل أمر لوحده ودوس Enter.

## اللي بينزل من النت

| الحاجة | التنزيل | على القرص | ملاحظة |
|---|---|---|---|
| الكود (git أو ZIP) | حوالي 80 ميجا | حوالي 85 ميجا | مقاس |
| الحزم (`npm install`) | حوالي 200 ميجا | حوالي 500 ميجا | تقدير للماك؛ المقاس على لينكس 784 ميجا، وأغلبه محرّك فحص الوش |
| موديلات الوش | 37 ميجا | 37 ميجا | مقاس |
| ffmpeg عن طريق Homebrew | مئات الميجات | حوالي 1 جيجا | تقدير، ما اتقاسش على ماك |
| أدوات Apple للمطورين (لو Homebrew مش موجود) | حوالي 1 جيجا | 2 لـ 3 جيجا | تقدير؛ دي أتقل حاجة، وبتنزّل git معاها |

الخطوة ٢ هي التقيلة. الباقي كله حوالي 320 ميجا تنزيل.

## ١. اتأكد من Node

```bash
node -v
```

**لو نجحت:** `v24.22.0` أو أي رقم بيبدأ بـ 24 أو أكبر.

## ٢. ffmpeg

```bash
ffmpeg -version
```

**لو نجحت:** أول سطر `ffmpeg version …`. عدّي على الخطوة ٣.

**لو طلع `command not found`:** شوف Homebrew موجود ولا لأ:

```bash
brew -v
```

لو طلع `Homebrew 4…` أو أحدث، عدّي على أمر `brew install ffmpeg` تحت. لو `command not found`، نزّله (هيطلب باسورد الماك، وهينزّل أدوات Apple للمطورين لوحده):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**لو نجحت:** آخر الكلام `Installation successful!` وتحته `Next steps`. نفّذ السطرين دول عشان Terminal يشوف `brew`:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

وبعدها:

```bash
brew install ffmpeg
```

**لو نجحت:** `ffmpeg -version` بيطبع `ffmpeg version …`.

## ٣. هات الكود في `~/Liine24`

اختار طريقة واحدة.

### الطريقة أ · git

```bash
git --version
```

**لو نجحت:** `git version 2.…`. لو ظهر شباك بيطلب تنزيل أدوات المطورين، دوس Cancel واستخدم الطريقة ب.

```bash
git clone --depth 1 https://github.com/rabeeajameel635/Liine24.git ~/Liine24
```

**لو نجحت:** `Cloning into '/Users/…/Liine24'…` وآخره `done.` من غير كلمة `fatal`.

### الطريقة ب · ZIP (من غير git)

```bash
curl -L -o ~/Liine24.zip https://github.com/rabeeajameel635/Liine24/archive/refs/heads/claude/rabee-studio.zip
```

**لو نجحت:** شريط تنزيل بيوصل 100%، وحجم حوالي 80M.

```bash
unzip -q ~/Liine24.zip -d ~ && mv ~/Liine24-claude-rabee-studio ~/Liine24 && rm ~/Liine24.zip
```

**لو نجحت:** مفيش أي كلام بيظهر.

### اتأكد (للطريقتين)

```bash
ls ~/Liine24
```

**لو نجحت:** `CLAUDE.md  README.md  app  docs  index.html  projects  studio`

## ٤. نصّب وشغّل

```bash
cd ~/Liine24/app
```

```bash
npm run mac-setup
```

ده بينزّل الحزم والموديلات، ويبني الواجهة، ويعمل قاعدة بيانات فاضية، ويشغّل البرنامج. أول مرة بياخد كام دقيقة حسب النت.

**لو نجحت:** ست خطوات بالترتيب، وكل سطر قدامه ✓:

```
١  الأدوات
✓ Node 24.22.0
✓ ffmpeg
✓ ffprobe
٢  الحزم
✓ الحزم جاهزة
٣  موديلات الوش (YuNet + SFace) والتأكد من الـ SHA-256
✓ face_detection_yunet_2023mar.onnx (MIT) اتنزل واتأكد
✓ face_recognition_sface_2021dec.onnx (Apache-2.0) اتنزل واتأكد
٤  الواجهة
✓ built in …
٥  قاعدة البيانات والبرنامج
غرفة الإخراج → http://127.0.0.1:4317
✓ قاعدة البيانات في /Users/…/Library/Application Support/Ghorfa
٦  «أول تشغيل» · http://127.0.0.1:4317/#/setup
البرنامج شغال هنا. اقفل الـ Terminal أو دوس Ctrl+C عشان توقفه.
```

- سطر `! Claude Code مش موجود` مش غلط: البرنامج بيشتغل، والفحص البصري والإلهام بيستنوه.
- تحذير `npm warn install-scripts … onnxruntime-node` وتحذير `Some chunks are larger than 500 kB` عاديين.
- لو الماك سأل إن كان node يستقبل اتصالات: Allow.
- سيب شباك الـ Terminal مفتوح. قفله بيقفل البرنامج.

## ٥. البرنامج مفتوح

المتصفح بيفتح لوحده على `http://127.0.0.1:4317/#/setup`.

**لو نجحت:** صفحة «أول تشغيل»، وفيها «موديلات الوش نزلت واتأكدت» و«سجّل الدخول ٠ من ٣».

افتح `http://127.0.0.1:4317` للرئيسية.

**لو نجحت:** «٠٪» و«كمّل غرفة ١» و«أغنية جديدة».

دي البيانات الفاضية: خطة I Am The World متقسّمة غرف، من غير ملف الأغنية، والمكتبة فاضية. الباقي (تسجيل الدخول، ملف الأغنية) في `docs/mac-checklist.md`.

## بعد كده

التشغيل في أي يوم:

```bash
cd ~/Liine24/app
```

```bash
npm start
```

**لو نجحت:** `غرفة الإخراج → http://127.0.0.1:4317`، وافتح العنوان ده في المتصفح. الإيقاف بـ Ctrl+C.

تحديث الكود: بالطريقة أ `git -C ~/Liine24 pull`. بالطريقة ب امسح `~/Liine24` وكرّر الخطوة ٣ والخطوة ٤ (البيانات في مكان تاني ومش بتتمسح).

## اتجرب إزاي

يوم ٢٣ نوفمبر، في السحابة على لينكس بـ Node 24.22.3: نسخة نضيفة من الكود وفولدر بيانات فاضي، و`npm run mac-setup` عدّى الست خطوات، والصفحتين فتحوا من غير أخطاء. **ما اتجربش على ماك حقيقي لسه**، والخطوة ٢ (Homebrew وffmpeg) ما اتجربتش خالص.
