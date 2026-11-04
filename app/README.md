# غرفة الإخراج (app/)

استوديو إنتاج شخصي: أغنية + كليب + ٣ ريلز + نشر كل ٥ أيام. بيشتغل محلي على الماك.

## التشغيل
```
cd app
npm install
npm start          # يبني الواجهة ويشغّل السيرفر على http://127.0.0.1:4317
```
محتاج Node 24 أو أحدث (Node بيشغّل TypeScript مباشرة). البيانات في `~/Library/Application Support/Ghorfa/ghorfa.sqlite`، وتقدر تغيّر المكان بـ `GHORFA_DATA`.

## البنية
- `server/`: Fastify + `node:sqlite` (FTS5). نموذج البيانات وقفل «اعتمد» في `db.ts`.
- `web/`: Vite + React. ثلاث أعمدة، وأوراق، و⌘K و⌘J، وفاتح وغامق.

الموقع (`../index.html`) وغرفة الإخراج القديمة (`../studio/`) شغالين زي ما هم لحد ما الترحيل يخلص.
