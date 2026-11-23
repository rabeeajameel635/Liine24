# تنزيل البرنامج على الماك من الصفر

لماك فاضي بمعالج Apple (MacBook Air M1، 8 جيجا). من غير sudo، ومن غير Homebrew، ومن غير أدوات Apple للمطورين. البرنامج بيتحط في `~/Liine24`، وآخر خطوة بيفتح على `http://127.0.0.1:4317` ببيانات فاضية.

## الطريق القصير: أمر واحد

افتح Terminal (Spotlight ← اكتب Terminal)، والصق السطر ده ودوس Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/rabeeajameel635/Liine24/refs/heads/claude/rabee-studio/install.sh | bash
```

السكريبت (`install.sh`) بيعمل الأربع خطوات اللي تحت لوحده، وبيقف بسطر `✗` لو حاجة وقعت. تقدر تشغّله تاني في أي وقت: اللي موجود بيفضل، والكود بيتحدّث.

**لو نجح:** أربع عناوين (`١ Node`، `٢ الكود`، `٣ ffmpeg`، `٤ التنصيب والتشغيل`)، وبعدها الست خطوات اللي في الخطوة ٤ تحت، وآخر سطر `البرنامج شغال هنا`، والمتصفح بيفتح لوحده.

## اللي بينزل من النت

| الحاجة | التنزيل | على القرص | منين |
|---|---|---|---|
| الكود (ZIP) | 80 ميجا | 85 ميجا | GitHub |
| Node 26.13 (بس لو مش موجود في `~/.local`) | 58 ميجا | حوالي 200 ميجا | nodejs.org، tarball رسمي |
| ffmpeg وffprobe | 38 ميجا | 91 ميجا | نسخة ffmpeg 6.1.1 جاهزة لـ arm64 من إصدارات مشروع ffmpeg-static على GitHub |
| الحزم (`npm install`) | حوالي 150 ميجا | 478 ميجا | npm |
| موديلات الوش | 37 ميجا | 37 ميجا | OpenCV Zoo |
| **المجموع** | **حوالي 365 ميجا** (305 لو Node موجود) | **حوالي 900 ميجا** (700 لو Node موجود) | |

أرقام التنزيل مقاسة. التنزيل أقل من 500 ميجا، لكن المساحة على القرص بعد الفك أكبر.

Node وffmpeg بيتأكد من بصمة SHA-256 بتاعتهم قبل ما يتحطوا، ولو البصمة مش مطابقة الملف بيتمسح والسكريبت بيقف.

## الطريق اليدوي: نفس الخطوات واحدة واحدة

انسخ كل أمر لوحده. كل الأوامر في نفس شباك Terminal، لأن الخطوة ١ بتحفظ مكان Node في المتغير `NODE_BIN` للشباك ده بس.

### ١. Node

دوّر عليه في `~/.local`:

```bash
NODE_BIN=$(ls -d ~/.local/node-v2*-darwin-arm64/bin | tail -1); echo "$NODE_BIN"
```

**لو موجود:** سطر زي `/Users/…/.local/node-v26.13.0-darwin-arm64/bin`. عدّي على أمر التأكد.

**لو مش موجود:** `no matches found` أو سطر فاضي. نزّله (من غير pkg ولا sudo):

```bash
mkdir -p ~/.local && curl -fL -o ~/.local/node.tar.gz https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.gz
```

**لو نجحت:** شريط تنزيل بيوصل 100%.

```bash
shasum -a 256 ~/.local/node.tar.gz
```

**لو نجحت:** السطر بيبدأ بـ `d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6`. لو رقم تاني، امسح الملف وما تكمّلش.

```bash
tar -xzf ~/.local/node.tar.gz -C ~/.local && rm ~/.local/node.tar.gz && NODE_BIN=~/.local/node-v26.13.0-darwin-arm64/bin
```

**لو نجحت:** مفيش أي كلام بيظهر.

أمر التأكد (بالمسار الكامل):

```bash
"$NODE_BIN/node" -v
```

**لو نجحت:** `v26.13.0`، أو أي رقم بيبدأ بـ 24 أو أكبر.

### ٢. الكود في `~/Liine24`

```bash
curl -L -o ~/Liine24.zip https://github.com/rabeeajameel635/Liine24/archive/refs/heads/claude/rabee-studio.zip
```

**لو نجحت:** عدّاد تنزيل بيقف عند حوالي 80M.

```bash
unzip -q ~/Liine24.zip -d ~ && mv ~/Liine24-claude-rabee-studio ~/Liine24 && rm ~/Liine24.zip
```

**لو نجحت:** مفيش أي كلام بيظهر.

```bash
ls ~/Liine24
```

**لو نجحت:** `CLAUDE.md  README.md  app  docs  index.html  install.sh  projects  studio`

### ٣. ffmpeg في `~/Liine24/app/bin`

البرنامج بيدوّر على ffmpeg وffprobe في الفولدر ده الأول، وبعده في باقي الجهاز.

```bash
mkdir -p ~/Liine24/app/bin && cd ~/Liine24/app/bin
```

```bash
curl -fL -o ffmpeg.gz https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz
```

```bash
curl -fL -o ffprobe.gz https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64.gz
```

**لو نجحت:** كل واحد شريط تنزيل بيوصل 100% (19 ميجا).

```bash
shasum -a 256 ffmpeg.gz ffprobe.gz
```

**لو نجحت:** السطرين دول بالظبط:

```
8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa  ffmpeg.gz
d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be  ffprobe.gz
```

```bash
gunzip ffmpeg.gz ffprobe.gz && chmod +x ffmpeg ffprobe && ./ffmpeg -version | head -1
```

**لو نجحت:** سطر بيبدأ بـ `ffmpeg version 6.1.1`.

### ٤. نصّب وشغّل

```bash
cd ~/Liine24/app && PATH="$NODE_BIN:$PATH" npm run mac-setup
```

ده بينزّل الحزم والموديلات، ويبني الواجهة، ويعمل قاعدة بيانات فاضية، ويشغّل البرنامج. أول مرة بياخد كام دقيقة حسب النت.

**لو نجحت:** ست خطوات بالترتيب، وكل سطر قدامه ✓:

```
١  الأدوات
✓ Node 26.13.0
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

### ٥. البرنامج مفتوح

المتصفح بيفتح لوحده على `http://127.0.0.1:4317/#/setup`.

**لو نجحت:** صفحة «أول تشغيل»، وفيها «موديلات الوش نزلت واتأكدت» و«سجّل الدخول ٠ من ٣».

افتح `http://127.0.0.1:4317` للرئيسية.

**لو نجحت:** «٠٪» و«كمّل غرفة ١» و«أغنية جديدة».

دي البيانات الفاضية: خطة I Am The World متقسّمة غرف، من غير ملف الأغنية، والمكتبة فاضية. الباقي (تسجيل الدخول، ملف الأغنية) في `docs/mac-checklist.md`.

## بعد كده

**التشغيل في أي يوم:** دبل كليك على `~/Liine24/app/mac-setup.command` (بيلاقي Node في `~/.local` لوحده). أول مرة الماك ممكن يقول الملف مش موثوق: كليك يمين عليه، وبعدين Open. أو من Terminal:

```bash
cd ~/Liine24/app && PATH="$(ls -d ~/.local/node-v2*-darwin-arm64/bin | tail -1):$PATH" npm start
```

**لو نجحت:** `غرفة الإخراج → http://127.0.0.1:4317`. الإيقاف بـ Ctrl+C.

**تحديث الكود:** شغّل أمر الطريق القصير تاني. بينزّل الكود الجديد فوق القديم، وNode وffmpeg والحزم والبيانات بيفضلوا.

## لما المستودع يبقى خاص

بعد القفل، أمر الطريق القصير بيبطّل يشتغل (GitHub بيطلب تسجيل دخول). التحديث بيبقى بمفتاح قراءة بس، متخزّن في Keychain بتاع الماك. المفتاح ما بيتكتبش في أي ملف ولا في المستودع.

**الترتيب: اعمل الخطوات دي والمستودع لسه عام، واتأكد إنها شغالة، وبعدها اقفل.**

1. هات آخر نسخة من السكريبت (والمستودع لسه عام) بأمر الطريق القصير اللي فوق.
2. اعمل المفتاح على GitHub: صورتك ← Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens ← Generate new token.
   - Repository access: «Only select repositories»، واختار `Liine24` بس.
   - Permissions ← Repository permissions ← Contents: «Read-only». ولا صلاحية تانية.
   - دوس Generate وانسخ المفتاح (بيبدأ بـ `github_pat_`). بيظهر مرة واحدة.
3. احفظه في Keychain:

```bash
bash ~/Liine24/install.sh token
```

بيطلب المفتاح مرتين والكتابة مخفية: الصق ودوس Enter، وكمان مرة.

**لو نجحت:** `✓ المفتاح اتحفظ في Keychain وGitHub قبله`

4. جرّب التحديث بالمفتاح:

```bash
bash ~/Liine24/install.sh
```

**لو نجحت:** تحت `٢ الكود` السطر `بينزل الكود (80 ميجا) بالمفتاح اللي في Keychain…` وبعده `✓ الكود اتحط`، والباقي زي أي تشغيل.

5. بعد ما الخطوة ٤ تنجح، اقفل المستودع. وكل تحديث بعد كده هو أمر الخطوة ٤ نفسه.

- المفتاح ليه تاريخ انتهاء بتختاره وانت بتعمله. لما ينتهي: اعمل واحد جديد وكرّر الخطوة ٣.
- عشان تمسحه من الماك: افتح Keychain Access، ودوّر على `Liine24`، وامسح العنصر. وعشان تلغيه خالص: امسحه من نفس صفحة GitHub.

## بدايل

- **git بدل ZIP** (لو git متنصّب عندك): `git clone --depth 1 https://github.com/rabeeajameel635/Liine24.git ~/Liine24`. لو `install.sh` لقى `~/Liine24/.git` بيسيب الكود زي ما هو، والتحديث يبقى `git -C ~/Liine24 pull`. على ماك من غير أدوات Apple، أمر `git` بيطلّع شباك يطلب تنزيلها (حوالي جيجا): دوس Cancel.
- **Homebrew بدل نسخة ffmpeg الجاهزة:** `brew install ffmpeg`. البرنامج بيستخدم اللي في `app/bin` لو موجود، وإلا اللي Homebrew نزّله. ده أتقل (محتاج أدوات Apple، وباسورد الماك وقت تنصيب Homebrew).

## اتجرب إزاي

**على الماك الحقيقي (٢٣ نوفمبر، MacBook Air M1، macOS 26.6.2):** أمر الطريق القصير كمّل من أوله لآخره. Node 26.13 اتلقى في `~/.local`، والكود وffmpeg وffprobe نزلوا واشتغلوا، والحزم اتنصّبت في دقيقتين، والموديلات نزلت واتأكدت، والبرنامج اشتغل على 4317. تحذير `npm warn install-scripts` على الماك بيذكر `fsevents` كمان، وده عادي.

**في السحابة على لينكس:** تنزيل Node والتأكد من بصمته (على الماك ما اتجربش، لأن Node كان موجود).

**اللي ما اتجربش:** حفظ المفتاح في Keychain والتحديث بيه. في السحابة اتأكد بس إن المفتاح بيتبعت مع الطلب وما بيتبعتش لموقع تاني عند التحويل، وإن شكل الملف اللي بيرجع مظبوط. أول تجربة حقيقية هي الخطوة ٤ في «لما المستودع يبقى خاص»، قبل القفل.
