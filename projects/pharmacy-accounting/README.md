# Pharmacy Accounting — خطة التنفيذ بعد البحث

> برنامج محاسبة ومخزون لموزّع أدوية/كوزماتيكس طبي (≈200 صنف) في قطاع غزة.
> واجهة إنجليزية من الشمال لليمين، ثيم أبيض بأسلوب آبل، عملة الشيكل.
> هذا الملف هو المرجع المقفول للمشروع. أي قرار هنا لا يتغيّر إلا بطلب صريح من ربيع.

---

## 0. خلاصة البحث (ليش بنبني ولا بنشتري)

قارنت Bisan (رام الله)، Zoho Books، Odoo، QuickBooks، bexio وBanana (سويسرا)، وأنظمة التوزيع الدوائي (MEDEIL, Logic ERP, Sage X3).

| المتطلب عند ربيع | الجاهز في السوق | القرار |
|---|---|---|
| ممنوع الحذف نهائياً، إلغاء = قيد عكسي | ERPNext وCustomBooks بيعملوها، Zoho/QuickBooks بيسمحوا بالحذف | نبني الدفتر **append-only** من اليوم الأول |
| عمود بونص (كمية مجانية) على سطر الفاتورة | غير موجود في Zoho/QuickBooks/bexio، موجود بس في أنظمة التوزيع الدوائي الهندية/الخليجية الثقيلة | نبني |
| إدخال الفاتورة بالصوت/صورة/رسالة واتساب بالعربي | التطبيقات الموجودة (Voice Accountant, Dext, Tally Ira) إنجليزية وما بتعرف أصنافك | نبني زر إدخال ذكي مربوط بـ Claude مع تأكيد قبل الترحيل |
| 3 مناطق (غزة / الوسطى / الجنوب) + أنواع زباين | ممكن بالتخصيص في Odoo بس بتعقيد | نبني |
| حجم بيانات ≈20MB، 200 صنف، مستخدمين قليلين | كل الأنظمة الكبيرة Overkill وبتكلفة شهرية | تطبيق ويب خفيف محلي-أولاً مع نسخة سحابية |
| شكل الطباعة الأنيق | قوالب الأنظمة الجاهزة محدودة | قالب A4 مصمم خصيصاً |

**النتيجة:** نظام مخصص، يسرق أفضل ما في كل واحد: دقة ترقيم Bisan، نظافة bexio/Banana، قيود ERPNext العكسية، وذكاء التطبيقات الحديثة.

**المبدأ الذي ثبت في كل المصادر:** التصحيح يكون بالإضافة، لا بالتعديل أو الحذف. الفاتورة اللي انطبعت لا تتغير؛ الخطأ ينصلح بإشعار أو بقيد عكسي، والأصل بيضل ظاهر.

---

## 1. القرارات المقفولة

1. **اللغة:** الواجهة إنجليزية LTR. الأسماء والعناوين ممكن تنكتب عربي داخل الحقول. طباعة الفاتورة ثنائية (إنجليزي أساسي + سطر عربي اختياري).
2. **العملة:** الشيكل (ILS) فقط في النسخة الأولى. الدولار/الدينار لاحقاً كحقل عرض فقط.
3. **الضريبة:** حقل VAT بنسبة افتراضية 16% (النسبة القياسية في فلسطين حسب PwC وDeloitte 2026) **قابل للتعطيل بالكامل من الإعدادات**، لأن تعامل الأدوية مع الضريبة بيختلف حسب الصنف والترخيص. ← *سؤال مفتوح لربيع: الفواتير الحالية فيها ضريبة ولا لأ؟*
4. **الأرقام مقدسة:** رقم الصنف، رقم الزبون، رقم المورد، رقم كل مستند — تسلسلي بلا فجوات، يُمنح لحظة الترحيل، لا يُعاد استخدامه أبداً حتى لو أُلغي المستند.
5. **لا حذف:** قاعدة البيانات نفسها ما فيها صلاحية DELETE لأي مستخدم بما فيهم المدير. الإلغاء = حالة `Voided` + قيد عكسي + سبب مكتوب + اسم من ألغى + وقت.
6. **السعر الافتراضي:** سعر الشراء وسعر البيع ينحطّوا عند تأسيس الصنف. وقت الفاتورة السعر بيجي تلقائي وممكن تعديله على السطر فقط (ما بيغيّر سعر الصنف إلا إذا المدير فعّل "update default from last purchase").
7. **الخصم:** عمود خصم على كل سطر (نسبة أو مبلغ) + حقل خصم على مجمل الفاتورة بالشيكل.
8. **رقم المرجع (رقم السند) اختياري** على كل فاتورة وسند، حقل حر للربط مع ورقة خارجية.
9. **المناطق:** Gaza، Middle Area، South. كل زبون لازم ينتمي لمنطقة. المنطقة للتقارير والفرز فقط، لا تؤثر على أي مبلغ.
10. **أنواع الزباين:** Pharmacy، Medical Warehouse، Medical Cosmetics Center، Other.
11. **البونص:** عمود `Bonus Qty` على سطر فاتورة المبيعات والمشتريات. يدخل/يخرج من المخزون بالكمية، بقيمة صفر، ويظهر منفصلاً في التقارير (Qty / Bonus / Total Qty / Total ILS).
12. **إضافة زبون أو مورد = صلاحية المدير فقط** افتراضياً (المدير يقدر يمنحها لغيره).

---

## 2. المستندات (Documents)

| الرمز | المستند | الأثر |
|---|---|---|
| `PI` | Purchase Invoice | مخزون + ، ذمم موردين + |
| `PR` | Purchase Return | مخزون − ، ذمم موردين − |
| `SI` | Sales Invoice | مخزون − ، ذمم زباين + |
| `SR` | Sales Return | مخزون + ، ذمم زباين − |
| `RV` | Receipt Voucher (سند قبض) | صندوق/بنك + ، ذمم زباين − |
| `PV` | Payment Voucher (سند صرف) | صندوق/بنك − ، ذمم موردين − (أو مصروف) |
| `CN` | Credit Note (إشعار دائن) | ذمم زباين − ، خصم خارجي كمصروف. نفس ستايل السند، بس فلوس وزباين بدون أصناف |
| `DN` | Debit Note (إشعار مدين) | ذمم زباين + |
| `JV` | Journal Voucher (سند قيد) | قيد يدوي للمدير فقط |

كل مستند: `Draft → Posted → (Voided)`. الرقم يُمنح عند Posted. المسودة ممكن تتعدل وتُهمل؛ المرحَّل لا.

**حقول مشتركة:** Date، Party (زبون/مورد)، Reference No. (اختياري)، Notes، Created by، Posted at.
**حقول الفاتورة:** أسطر (Item، Qty، Bonus، Unit Price، Line Discount، Line Total)، Invoice Discount (ILS)، VAT (إن فُعّل)، Grand Total، Paid Now (اختياري يولّد RV تلقائياً).

---

## 3. البيانات (Data Model)

```
items          id, code (ITM-0001), name_en, name_ar, unit, default_purchase_price,
               default_sale_price, category, barcode?, is_active, created_at
customers      id, code (CUS-0001), name, phone, region (gaza|middle|south),
               type (pharmacy|warehouse|cosmetics|other), opening_balance, is_active
suppliers      id, code (SUP-0001), name, phone, opening_balance, is_active
documents      id, type (PI|PR|SI|SR|RV|PV|CN|DN|JV), number, date, party_id,
               reference_no?, status (draft|posted|voided), discount_amount,
               vat_rate, subtotal, total, notes, created_by, posted_at,
               voided_at?, voided_by?, void_reason?, reversal_of?
document_lines id, document_id, item_id, qty, bonus_qty, unit_price,
               line_discount, line_total
ledger_entries id, document_id, account, debit, credit, party_id?, created_at
               ← append-only: لا UPDATE ولا DELETE على هذا الجدول أبداً
stock_moves    id, document_id, item_id, qty_delta, is_bonus, created_at
               ← append-only كذلك
sequences      doc_type, next_number    ← قفل على مستوى قاعدة البيانات
users          id, name, email, role, permissions(json), is_active
audit_log      id, user_id, action, table, row_id, before, after, at
```

الرصيد والمخزون **محسوبان دائماً** من `ledger_entries` و`stock_moves`، لا يُخزَّنان كأرقام قابلة للتعديل. هذا اللي بيخلي الميزان يطلع صح مهما صار.

---

## 4. المعمارية والتخزين ("يسجل في مكانين")

```
المتصفح (Laptop / iPad / Phone)                   السحابة
┌────────────────────────────────┐                ┌──────────────────────────┐
│ PWA — HTML/CSS/TypeScript      │  مزامنة فورية   │ Postgres (Supabase)       │
│ SQLite محلي (WASM) في IndexedDB│ ◄────────────► │ Auth + Row-Level Security │
│ يشتغل بدون إنترنت             │   PowerSync     │ Edge Functions (مفاتيح AI)│
│ طابور كتابة offline            │                │ Storage (صور الفواتير)    │
└────────────────────────────────┘                └──────────────────────────┘
                                                          │
                                                  نسخة احتياطية يومية
                                                  (JSON + Excel) → Google Drive
                                                  + تنزيل يدوي بزر واحد
```

- **المكان الأول:** قاعدة محلية على كل جهاز → السرعة والعمل بدون نت.
- **المكان الثاني:** Postgres سحابي → المرجع الرسمي، صلاحيات على مستوى الصف.
- **المكان الثالث (إضافي):** تصدير يومي تلقائي JSON + Excel على Google Drive تبع المدير.
- 20MB بيانات = سنوات من الفواتير. لا مشكلة حجم.
- البديل الأبسط إذا بدنا نختصر: Supabase فقط مع كاش محلي، بدون PowerSync (نخسر الكتابة offline).

**الحماية:** النسخة السحابية مملوكة لحساب المدير. المحاسب بيدخل بحسابه وصلاحياته من قاعدة البيانات نفسها (RLS)، مش من الواجهة بس. لو حاول يتجاوز، قاعدة البيانات بترفض.

---

## 5. المستخدمون والصلاحيات

| الصلاحية | Admin | Accountant (افتراضي) | Viewer |
|---|---|---|---|
| إنشاء/ترحيل فواتير وسندات | ✔ | ✔ | ✘ |
| إلغاء (Void) مستند | ✔ | ✘ | ✘ |
| إضافة/تعديل صنف | ✔ | ✘ | ✘ |
| إضافة زبون / مورد | ✔ | ✘ | ✘ |
| تعديل الأسعار الافتراضية | ✔ | ✘ | ✘ |
| التقارير وكشوف الحساب | ✔ | ✔ | ✔ |
| سند قيد يدوي JV | ✔ | ✘ | ✘ |
| إدارة المستخدمين والصلاحيات | ✔ | ✘ | ✘ |
| تصدير نسخة احتياطية | ✔ | ✘ | ✘ |
| حذف أي شيء | ✘ | ✘ | ✘ |

المدير يقدر يعدّل مصفوفة الصلاحيات لأي مستخدم من شاشة Users. الافتراضي فوق.

---

## 6. التقارير

1. **Trial Balance** (الميزان / "الصندوق"): كل الحسابات، مدين/دائن، لازم يتوازن دائماً. يُطبع كصفحة واحدة أنيقة.
2. **Inventory Count** (جرد): لكل صنف: Opening، Purchased، Bonus In، Sold، Bonus Out، Returned، On Hand، Cost Value.
3. **Sales by Date**: يوم / أسبوع / شهر / فترة حرة، بالكمية والبونص والشيكل.
4. **Sales by Item**: Qty، Bonus، Total Qty، Total ILS، Avg Price.
5. **Sales by Region**: Gaza / Middle / South، مع توزيع الزباين كبطاقات، نفس الأرقام فقط ترتيب.
6. **Sales by Customer Type**.
7. **Customer Statement — Brief**: التاريخ، نوع الحركة، الرقم، مدين، دائن، الرصيد.
8. **Customer Statement — Detailed**: نفس السابق + تفاصيل أسطر كل فاتورة.
9. **Supplier Statement** (نفس المنطق).
10. **Aged Receivables**: 0-30 / 31-60 / 61-90 / +90 يوم.
11. **Cash & Bank**: حركة الصندوق والبنك.
12. **Audit Log**: من عمل شو ومتى (للمدير).

كل تقرير: فلتر تاريخ + منطقة + نوع زبون، تصدير Excel/PDF، طباعة.

---

## 7. الإدخال الذكي (الزر الأساسي)

زر واحد في شاشة الفاتورة اسمه **Smart Entry** بيقبل:
- **صوت**: تسجيل من الميكروفون (بالعربي العامي: "بنادول عشرين علبة وخمسة بونص، فولتارين عشرة").
- **صورة**: صورة طلبية مكتوبة بخط اليد أو فاتورة مورد.
- **نص**: لصق رسالة واتساب.

**الآلية:**
1. المتصفح يبعت الصوت/الصورة/النص إلى Edge Function (المفتاح على السيرفر، مش في المتصفح).
2. الصوت يتحول لنص أولاً (Claude لا يستقبل صوتاً؛ نستخدم خدمة تفريغ تدعم العربية مثل ElevenLabs Scribe أو Gemini).
3. Claude يستلم النص/الصورة + قائمة الـ200 صنف (أسماء وأكواد) ويرجّع **JSON بمخطط صارم** (Structured Outputs):
   ```json
   { "customer_hint": "صيدلية الشفاء",
     "lines": [ { "item_code": "ITM-0042", "qty": 20, "bonus_qty": 5, "confidence": 0.93 } ] }
   ```
4. الواجهة تعرض مسودة الفاتورة بالأسطر المقترحة، الأسطر الضعيفة الثقة ملوّنة للمراجعة.
5. **لا شيء يُرحَّل بدون ضغطة Post من المستخدم.** الذكاء يقترح، الإنسان يعتمد. هذا نفس النمط اللي اعتمدته كل التطبيقات الحديثة الناجحة.

النموذج: Claude (الأحدث المتاح وقت التنفيذ)، مع إمكانية تبديله لـ Gemini من الإعدادات. المفاتيح عند المدير فقط.

---

## 8. التصميم (Apple-white)

- خلفية بيضاء، مساحات فارغة واسعة، خط Inter (أقرب شيء لـ SF على الويب)، شبكة 8px.
- لون واحد للتمييز (أزرق هادئ) + رمادي للحدود الشعرية، بدون ظلال ثقيلة.
- شاشة الفاتورة = جدول يُعبّأ بالكيبورد فقط (Tab/Enter يتنقل بين الخلايا) زي Bisan وExcel، مع بحث فوري عن الصنف بأول حرفين.
- شريط أوامر `⌘K` للتنقل بأي شاشة بدون ماوس.
- الأرقام منسّقة تلقائياً: `12,450.00 ₪`.
- **الطباعة:** قالب A4 بهوامش نظيفة، شعار، رقم المستند كبير، جدول الأسطر، الإجماليات، سطر عربي اختياري، QR صغير برقم المستند للتحقق. نفس القالب للفاتورة والسند والإشعار والكشف.
- تعمل على اللابتوب والآيباد والجوال (PWA قابلة للتثبيت).

---

## 9. خطة التنفيذ (المراحل)

| المرحلة | التسليم | الهدف |
|---|---|---|
| **0 — اعتماد هذا المستند** | هذا الملف | ربيع يجاوب الأسئلة المفتوحة ويعتمد |
| **1 — النموذج البصري** | `prototype/` صفحات HTML ثابتة: Dashboard، Sales Invoice، Items، Customers، Statement، Print A4 | اعتماد الشكل قبل أي كود منطق |
| **2 — النواة** | الأصناف، الزباين، الموردون، الفواتير الأربعة، السندات، الدفتر الـappend-only، الترقيم، الميزان، كشف الحساب، الطباعة. محلي على جهاز واحد | برنامج يشتغل فعلياً لمدير واحد |
| **3 — السحابة والمستخدمون** | Supabase + PowerSync، الصلاحيات، الـVoid بقيد عكسي، النسخ الاحتياطي اليومي | أكثر من جهاز ومستخدم بأمان |
| **4 — الذكاء والتقارير** | Smart Entry (صوت/صورة/نص)، كل التقارير، التصدير | الميزة النخبوية |
| **5 — التشغيل** | استيراد الـ200 صنف والزباين بأرصدتهم الافتتاحية، تدريب، تسليم | البرنامج في الإنتاج |

كل مرحلة تُسلَّم على فرع في هذا المستودع وتُفتح عليها PR للمراجعة.

---

## 10. أسئلة مفتوحة لربيع (محتاج أجوبتها قبل المرحلة 2)

1. الفواتير الحالية فيها ضريبة قيمة مضافة ولا لأ؟
2. قائمة الـ200 صنف: موجودة Excel؟ فيها أسعار شراء وبيع؟ (ابعتها بأي شكل، أنا برتبها)
3. هل محتاجين **رقم التشغيلة وتاريخ الانتهاء** (Batch/Expiry) لكل صنف؟ توصيتي: نعم كحقلين اختياريين من البداية، لأن الإضافة لاحقاً صعبة.
4. الدفع: صندوق واحد ولا صندوق + بنك + شيكات؟
5. اسم البرنامج والشعار اللي بينطبع على الفاتورة.
6. مين المستخدمون بالضبط في البداية (مدير + كم محاسب)؟
7. هل في أرصدة افتتاحية للزباين من النظام القديم؟

---

## 11. هل الفاتورة مهمة؟

نعم، هي قلب النظام. كل شيء آخر (المخزون، الذمم، الميزان، التقارير، كشف الحساب) **مشتق** من الفواتير والسندات، ولا يُدخل يدوياً. لذلك الفاتورة لازم تكون: سريعة الإدخال، مقدسة الرقم، أنيقة الطباعة، ومستحيلة الحذف.

---

## المصادر الأساسية للبحث

- Bisan Systems (رام الله): https://bisan.com — https://www2.bisan.com/wholesale-and-retail-trade
- ERPNext Immutable Ledger: https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext
- Stampli — Void vs Delete: https://www.stampli.com/resources/void-cancel-delete-invoices/
- Designing audit-proof financial workflows: https://dev.to/oluwatosinolamilekan/designing-audit-proof-financial-workflows-with-immutable-logs-1ba
- Local-first architecture 2026 (Smashing Magazine): https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/
- Electric vs PowerSync vs LiveStore: https://kanopylabs.com/blog/electric-sql-vs-powersync-vs-livestore-local-first
- Supabase Row Level Security: https://supabase.com/docs/learn/auth-deep-dive/auth-row-level-security
- Claude Structured Outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Swiss SME accounting 2026 (bexio / Banana): https://www.scalemetrics.ai/best-accounting-software-swiss-smes-2026/
- Pharmaceutical distribution software 2026: https://us.fitgap.com/search/pharmacy-software/wholesale
- Palestine VAT 16% (PwC): https://taxsummaries.pwc.com/palestinian-territories/corporate/other-taxes
- Palestine tax highlights 2026 (Deloitte): https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-palestinianterritorieshighlights-2026.pdf
- UAE bonus cap 15% on invoiced quantity (Al Tamimi): https://www.tamimi.com/law-update-articles/uae-issues-new-code-governing-promotion-distribution-medical-products
