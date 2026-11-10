// UI language: English (LTR) or Arabic (RTL). The app is written in English;
// in Arabic mode every rendered text node and placeholder is translated after render.
export const getLang = () => { try { return localStorage.getItem('lang') || 'en'; } catch { return 'en'; } };
export const setLang = (l) => { try { localStorage.setItem('lang', l); } catch {} apply(); };

export function apply() {
  const ar = getLang() === 'ar';
  document.documentElement.lang = ar ? 'ar' : 'en';
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
}

const AR = {
  // navigation
  'Dashboard': 'الرئيسية', 'Sales': 'المبيعات', 'Purchases': 'المشتريات', 'Books': 'الدفاتر', 'Reports': 'التقارير', 'Data': 'البيانات',
  'New sales invoice': 'فاتورة مبيعات جديدة', 'Sales return': 'مرتجع مبيعات', 'Receipt voucher': 'سند قبض', 'Credit note': 'إشعار دائن', 'Debit note': 'إشعار مدين',
  'Purchase invoice': 'فاتورة مشتريات', 'Purchase return': 'مرتجع مشتريات', 'Payment voucher': 'سند صرف',
  'All documents': 'كل المستندات', 'Items': 'الأصناف', 'Customers': 'الزبائن', 'Suppliers': 'الموردون',
  'Account statement': 'كشف حساب', 'Sales report': 'تقرير المبيعات', 'Inventory': 'جرد البضاعة', 'Trial balance': 'ميزان المراجعة',
  'Integrity check': 'فحص سلامة الدفاتر', 'Audit log': 'سجل التدقيق', 'Import · Excel · AI': 'استيراد · إكسل · ذكاء اصطناعي', 'Backup': 'النسخ الاحتياطي', 'Settings': 'الإعدادات',
  'Switch role': 'تبديل الصلاحية', 'Admin': 'مدير', 'Accountant': 'محاسب', 'العربية': 'English',
  // document types
  'Sales invoice': 'فاتورة مبيعات', 'Opening balance': 'رصيد افتتاحي', 'Opening stock': 'بضاعة أول المدة',
  // dashboard
  "Today's sales": 'مبيعات اليوم', 'This month': 'هذا الشهر', 'Receivables': 'ذمم الزبائن', 'Payables': 'ذمم الموردين', 'Cash, bank, cheques': 'الصندوق والبنك والشيكات',
  'Balanced': 'متوازن', 'Check': 'افحص', 'Receipt': 'سند قبض', 'Statement': 'كشف حساب', 'Import Excel / AI': 'استيراد إكسل / ذكاء اصطناعي',
  'Pending drafts': 'مسودات معلّقة', 'Latest posted': 'آخر المرحّل', 'Nothing here.': 'لا يوجد شيء هنا.',
  // tables
  'Number': 'الرقم', 'Type': 'النوع', 'Date': 'التاريخ', 'Party': 'الطرف', 'Ref.': 'مرجع', 'Total': 'المجموع', 'Status': 'الحالة',
  'draft': 'مسودة', 'posted': 'مرحّل', 'voided': 'ملغى', 'Draft': 'مسودة', 'New': 'جديد', 'Backdated': 'تاريخ رجعي', 'inactive': 'معطّل', 'reversal': 'قيد عكسي',
  'Code': 'الكود', 'Item': 'الصنف', 'Name': 'الاسم', 'Brand': 'العلامة', 'Category': 'الفئة', 'Unit': 'الوحدة', 'Buy': 'شراء', 'Public': 'جمهور', 'Pharmacist': 'صيدلي', 'On hand': 'الرصيد',
  'Batch': 'الدفعة', 'Expiry': 'الانتهاء', 'Qty': 'الكمية', 'Bonus': 'بونص', 'Price': 'السعر', 'Disc %': 'خصم %', 'Amount': 'المبلغ', 'Totals': 'المجاميع',
  'Phone': 'الهاتف', 'Region': 'المنطقة', 'Credit limit': 'سقف الدين', 'Balance': 'الرصيد', 'Approved balance': 'الرصيد المعتمد', 'Items total': 'المجموع', 'Employee advances': 'سلف الموظفين', 'Company assets': 'أصول الشركة', 'Expenses and salaries': 'المصاريف والرواتب', 'Used by': 'بيستعمله', 'Save accounts': 'حفظ الحسابات', 'Your own code and name for each account. Postings keep their fixed link, so changing a code or a name never changes a number.': 'كودك واسمك لكل حساب. القيود بتضل مربوطة بنفس الحساب، فتغيير الكود أو الاسم ما بيغيّر ولا رقم.', 'Switch to admin to change codes and names.': 'حوّل لمدير عشان تغيّر الأكواد والأسماء.', 'Receipt and payment vouchers (cash)': 'سندات القبض والصرف (نقداً)', 'Receipt and payment vouchers (bank)': 'سندات القبض والصرف (بنك)', 'Cheques received': 'الشيكات الواردة', 'Customers: sales, returns, receipts, notes': 'الزبائن: مبيعات، مرتجعات، قبض، إشعارات', 'Suppliers: purchases, returns, payments': 'الموردين: مشتريات، مرتجعات، صرف', 'Stock value': 'قيمة المخزون', 'VAT on invoices': 'ضريبة الفواتير', 'Opening balances': 'الأرصدة الافتتاحية', 'Cost of what was sold': 'كلفة البضاعة المباعة', 'Journal vouchers (soon)': 'سندات القيد (قريباً)', 'after this document': 'بعد هالمستند', 'Waiting': 'بانتظار', 'Items below zero, waiting for a purchase invoice': 'أصناف بالسالب، بانتظار فاتورة مشتريات', 'Allowed: a sale never stops at zero. The count comes back when the purchase invoice is entered.': 'مسموح: البيع ما بيوقف عند الصفر. الجرد بيرجع لما تندخل فاتورة المشتريات.', 'City': 'المدينة', 'Monogram (2–3 letters)': 'شعار الحروف (2–3 أحرف)', 'Letterhead contacts · one per line: department | person | phone': 'جهات الترويسة · كل وحدة بسطر: القسم | الاسم | الرقم', 'Password': 'كلمة المرور', 'Currency': 'العملة', 'Password · admin PIN': 'كلمة المرور · رمز المدير', 'Israeli new shekel (₪, NIS)': 'شيكل جديد (₪)', 'One currency in this version: every amount, statement and report is in shekels.': 'عملة وحدة بهالنسخة: كل المبالغ والكشوف والتقارير بالشيكل.', 'Switch to admin to set or change the admin PIN.': 'حوّل لمدير عشان تحط أو تغيّر رمز المدير.', 'Sales invoices': 'فواتير مبيعات', 'Sales returns': 'مرتجع مبيعات', 'Purchase invoices': 'فواتير مشتريات', 'Purchase returns': 'مرتجع مشتريات', 'Credit notes': 'إشعار دائن', 'Debit notes': 'إشعار مدين', 'Receipt vouchers': 'سندات قبض', 'Payment vouchers': 'سندات صرف', 'Journal vouchers': 'سندات قيد', 'Customers directory': 'دليل الزبائن', 'Suppliers directory': 'دليل الموردين', 'Accounts setup': 'تعريف الحسابات', 'Definitions': 'تعريف', 'Employees': 'الموظفين', 'Regions': 'المناطق', 'Total balance': 'إجمالي الرصيد', 'Description': 'البيان', 'no.': 'رقم', 'saved, no number yet': 'محفوظ، بدون رقم بعد', 'due': 'استحقاق', 'Void of': 'إلغاء', 'Balance brought forward': 'رصيد سابق مدوّر', 'Required balance': 'الرصيد المطلوب', 'Credit balance': 'رصيد دائن له', 'We owe': 'المستحق علينا', 'They owe us': 'المستحق لنا', 'NIS': 'شيكل', 'Period': 'الفترة', 'Amount in words': 'المبلغ كتابةً', 'Signature': 'التوقيع', 'Received by': 'المستلم', 'Printed by': 'طُبع بواسطة', 'Including saved': 'شامل المحفوظ', 'Posted only': 'المرحّل فقط', 'Saved (draft)': 'محفوظ', 'Brief': 'مختصر', 'Detailed': 'تفصيلي', 'All regions': 'كل المناطق', 'Display': 'العرض', 'Tap to choose': 'اكبس للاختيار', 'Statement options': 'خيارات الكشف', 'Choose a customer or supplier': 'اختار زبون أو مورد', 'Statement before this document': 'الكشف قبل هذا المستند', 'Open full statement': 'فتح الكشف كامل', 'Last price to this customer': 'آخر سعر لهذا الزبون', 'Last price from this supplier': 'آخر سعر من هذا المورد', 'No earlier price for this customer': 'ما في سعر سابق لهذا الزبون', 'No earlier price from this supplier': 'ما في سعر سابق من هذا المورد', 'Approve': 'اعتماد', 'This customer: earlier prices': 'أسعار هذا الزبون السابقة', 'This supplier: earlier prices': 'أسعار هذا المورد السابقة', 'hold a row: its card': 'اضغط مطوّل على سطر: بطاقته', 'Name is required': 'الاسم مطلوب', 'Edit': 'تعديل', 'This item has movements: its name takes spelling fixes only. For a different name, set Active to No (it stays in every account and report) and add a new item.': 'هذا الصنف عليه حركات: اسمه بيقبل تصحيح إملائي بس. لاسم مختلف، خليه غير فعّال (بيضل بكل الحسابات والتقارير) وضيف صنف جديد.', 'This customer has movements: its name takes spelling fixes only. For a different name, set Active to No (it stays in every account and report) and add a new customer.': 'هذا الزبون عليه حركات: اسمه بيقبل تصحيح إملائي بس. لاسم مختلف، خليه غير فعّال (بيضل بكل الحسابات والتقارير) وضيف زبون جديد.', 'This supplier has movements: its name takes spelling fixes only. For a different name, set Active to No (it stays in every account and report) and add a new supplier.': 'هذا المورد عليه حركات: اسمه بيقبل تصحيح إملائي بس. لاسم مختلف، خليه غير فعّال (بيضل بكل الحسابات والتقارير) وضيف مورد جديد.', 'Stock count': 'الجرد', 'Remove this item from the invoice?': 'هل تريد حذف الصنف من الفاتورة؟', 'Yes, remove': 'نعم، احذف', 'Rounding': 'تقريب', 'Before': 'قبل', 'Grand total': 'المجموع النهائي', 'item': 'صنف', 'items': 'أصناف', 'Save draft (F4)': 'حفظ مسودة (F4)', 'Save & print draft': 'حفظ وطباعة مسودة', 'Post & print (F9)': 'ترحيل وطباعة (F9)', 'Export to Excel': 'تصدير إكسل', 'Cancel document': 'إلغاء المستند', 'Cancel this draft? It stays in the records as cancelled.': 'إلغاء هذه المسودة؟ بتضل في السجلات كملغاة.', 'Discard this new document?': 'تجاهل هذا المستند الجديد؟', 'Exported': 'تم التصدير', 'After': 'بعد', 
  'Document': 'المستند', 'Debit': 'مدين', 'Credit': 'دائن', 'Closing balance': 'الرصيد الختامي', 'Account': 'الحساب', 'Total debit': 'مجموع المدين', 'Total credit': 'مجموع الدائن',
  'Debit balance': 'رصيد مدين', 'Credit balance': 'رصيد دائن', 'In': 'وارد', 'Bonus in': 'بونص وارد', 'Out': 'صادر', 'Bonus out': 'بونص صادر', 'Avg cost': 'متوسط الكلفة', 'Value': 'القيمة',
  'Inventory value': 'قيمة المخزون', 'Total qty': 'مجموع الكمية', 'Total ₪': 'المجموع ₪', 'When': 'الوقت', 'User': 'المستخدم', 'Action': 'الإجراء', 'Reference': 'المرجع', 'Detail': 'التفاصيل',
  // regions and types
  'Gaza': 'غزة', 'Middle Area': 'الوسطى', 'South': 'الجنوب', 'Pharmacy': 'صيدلية', 'Medical warehouse': 'مستودع طبي', 'Medical cosmetics center': 'مركز تجميل طبي', 'Other': 'أخرى',
  'Cash': 'نقداً', 'Cheque': 'شيك', 'Bank transfer': 'حوالة بنكية', 'Wallet app': 'محفظة إلكترونية', 'Cash box': 'الصندوق', 'Bank': 'البنك', 'Cheques on hand': 'صندوق الشيكات',
  'Accounts receivable': 'ذمم الزبائن', 'Accounts payable': 'ذمم الموردين', 'VAT': 'ضريبة القيمة المضافة', 'Opening balances / equity': 'أرصدة افتتاحية / حقوق ملكية',
  'Sales discounts (credit notes)': 'خصومات (إشعارات دائنة)', 'Other income (debit notes)': 'إيرادات أخرى (إشعارات مدينة)', 'Cost of goods sold': 'كلفة البضاعة المباعة',
  // editor
  'Customer': 'الزبون', 'Supplier': 'المورد', 'Reference no. (optional)': 'رقم السند (اختياري)', 'Reference no.': 'رقم السند', '(optional)': '(اختياري)', 'Salesman': 'المندوب', 'Notes': 'ملاحظات',
  'Type code or name': 'اكتب الرقم أو الاسم', 'Code or first letters': 'الرقم أو أول حروف', 'Item name': 'اسم الصنف',
  'Save draft': 'حفظ مسودة', 'Post': 'ترحيل', 'Print & post': 'طباعة وترحيل', 'Print draft': 'طباعة مسودة', 'Smart entry (AI / paste)': 'إدخال ذكي (ذكاء اصطناعي / لصق)',
  '+ Line': '+ سطر', 'Invoice discount (₪)': 'خصم على الفاتورة (₪)', 'Lines': 'عدد الأسطر', 'Total qty / bonus': 'مجموع الكمية / البونص', 'Subtotal': 'المجموع قبل الخصم',
  'Invoice discount': 'خصم الفاتورة', 'Net before VAT': 'الصافي قبل الضريبة', 'Net': 'الصافي', 'Amount (₪)': 'المبلغ (₪)', 'Method': 'طريقة الدفع', 'Into / from': 'إلى / من',
  'Cheque no.': 'رقم الشيك', 'Due date': 'تاريخ الاستحقاق', 'Remove line from draft': 'حذف السطر من المسودة',
  'Drafts can be edited freely. Posting gives the permanent number and locks the document.': 'المسودة تتعدل بحرية. الترحيل يعطي الرقم الدائم ويقفل المستند.',
  'Finish': 'إنهاء', 'Print and post this document?': 'بدك تطبع المستند وترحّله؟',
  'Print original': 'طباعة الأصلية', 'Void (reversing entry)': 'إلغاء (قيد عكسي)', 'Only the admin can void.': 'الإلغاء للمدير فقط.', 'Print history': 'سجل الطباعة', 'Original': 'أصلية',
  'Not printed yet. The first print will be marked Original, once only.': 'لم يُطبع بعد. أول طباعة تكون "أصلية"، مرة واحدة فقط.',
  'Smart entry': 'الإدخال الذكي', 'Add to draft': 'أضف للمسودة', 'Close': 'إغلاق',
  // items and parties
  'Add item': 'إضافة صنف', 'Search': 'بحث', 'Only the admin adds or edits items.': 'إضافة وتعديل الأصناف للمدير فقط.', 'New item': 'صنف جديد', 'Edit item': 'تعديل صنف',
  'Code (permanent)': 'الكود (ثابت)', 'Brand / company': 'العلامة / الشركة', 'Barcode': 'الباركود', 'Buy price': 'سعر الشراء', 'Public price': 'سعر الجمهور', 'Pharmacist price': 'سعر الصيدلي',
  'Active': 'فعّال', 'Yes': 'نعم', 'No': 'لا', 'Replaced by (if inactive)': 'حلّ محله (إذا معطّل)', 'Save': 'حفظ', 'Cancel': 'إلغاء',
  'Add customer': 'إضافة زبون', 'Add supplier': 'إضافة مورد', 'All regions': 'كل المناطق', 'Address': 'العنوان', 'Tax / licensed dealer no.': 'رقم المشتغل المرخص',
  'Credit limit (₪)': 'سقف الدين (₪)', 'Guarantor': 'الكفيل', 'Opening balance (₪)': 'رصيد افتتاحي (₪)',
  'No movements yet, so the name can still be corrected freely.': 'لا يوجد حركات بعد، فالاسم يتصلح بحرية.',
  // reports
  'Every number links to its document.': 'كل رقم بيفتح مستنده.', 'Customer or supplier': 'الزبون أو المورد', 'From': 'من', 'To': 'إلى', 'Show': 'عرض', 'Print': 'طباعة', 'Excel': 'إكسل',
  'Group by': 'تجميع حسب', 'Customer type': 'نوع الزبون', 'Posted sales minus returns, VAT included.': 'المبيعات المرحّلة ناقص المرتجعات، شامل الضريبة.',
  'Quantities come only from posted documents.': 'الكميات من المستندات المرحّلة فقط.', 'Built only from posted entries.': 'مبني من القيود المرحّلة فقط.', 'Not balanced': 'غير متوازن',
  'Runs on every visit. The forensic audit questions, answered by the system itself.': 'يشتغل مع كل فتح. أسئلة التدقيق، بيجاوب عليها النظام نفسه.',
  'Trial balance is balanced': 'ميزان المراجعة متوازن', 'No gaps in any numbering series': 'لا فجوات في أي تسلسل ترقيم', 'No item below zero': 'لا صنف تحت الصفر',
  'No backdated documents': 'لا مستندات بتاريخ رجعي', 'No drafts older than 3 days': 'لا مسودات أقدم من 3 أيام', 'OK': 'سليم', 'None': 'لا يوجد',
  'All items at zero or above': 'كل الأصناف صفر أو أكثر', 'Who did what, when. This log cannot be edited or deleted.': 'مين عمل شو ومتى. هذا السجل لا يُعدَّل ولا يُحذف.',
  'Nothing is ever deleted. Voided documents stay visible with their reversal.': 'لا شيء يُحذف أبداً. المستند الملغى يبقى ظاهراً مع قيده العكسي.', 'All': 'الكل', 'Number, party, reference': 'الرقم، الطرف، المرجع',
  // import / backup / settings
  'Bring data in from Excel, CSV, or any AI assistant. Everything is checked before it is saved, and invoices arrive as drafts.': 'أدخل البيانات من إكسل أو CSV أو أي مساعد ذكاء اصطناعي. كل شيء يُفحص قبل الحفظ، والفواتير تصل كمسودات.',
  '1 · From Excel or CSV': '1 · من إكسل أو CSV', '2 · From an AI assistant (Claude, ChatGPT, Gemini)': '2 · من مساعد ذكاء اصطناعي (Claude، ChatGPT، Gemini)',
  'What': 'ماذا', 'File': 'الملف', 'Download template': 'تحميل نموذج', 'Copy prompt': 'نسخ البرومبت', 'Check and import': 'افحص واستورد', 'Import now': 'استورد الآن',
  'Paste the JSON answer here': 'الصق جواب JSON هنا',
  'Copy this prompt, add your Excel sheet, photo or message under it, and paste the JSON answer below.': 'انسخ البرومبت، وحط تحته الإكسل أو الصورة أو الرسالة، والصق جواب JSON تحت.',
  'Download full backup (.json)': 'تحميل نسخة كاملة (.json)', 'Download everything as Excel': 'تحميل كل شيء إكسل', 'Restore': 'استرجاع',
  'No backup in the last 24 hours.': 'لا يوجد نسخة احتياطية آخر 24 ساعة.',
  'Your books live in this browser and in every backup file you keep. Keep one copy in your own Google Drive or Dropbox.': 'دفاترك محفوظة بهذا المتصفح وبكل نسخة احتياطية بتحتفظ فيها. خلي نسخة على Google Drive أو Dropbox تبعك.',
  'Restore works only into an empty app (new device or new browser), so it can never overwrite existing books. The file checksum is verified first.': 'الاسترجاع يشتغل فقط على برنامج فاضي (جهاز أو متصفح جديد)، فما بيمسح دفاتر موجودة. البصمة تُفحص أولاً.',
  'You': 'أنت', 'Your name': 'اسمك', 'Text size': 'حجم الخط', 'Normal': 'عادي', 'Large': 'كبير', 'Extra large': 'كبير جداً', 'Language': 'اللغة', 'Role': 'الصلاحية',
  'Switch to accountant': 'التحويل لمحاسب', 'Switch to admin': 'التحويل لمدير', 'Company': 'الشركة', 'Company name': 'اسم الشركة', 'Company name (Arabic)': 'اسم الشركة (عربي)',
  'Licensed dealer no.': 'رقم المشتغل المرخص', 'Branch / vehicle code (series prefix)': 'رمز الفرع / السيارة (بادئة الترقيم)', 'VAT %': 'الضريبة %', 'Prices include VAT': 'الأسعار شاملة الضريبة',
  'Save company': 'حفظ بيانات الشركة', 'Admin PIN': 'رقم المدير السري', 'New PIN': 'رقم سري جديد', 'Set PIN': 'حفظ الرقم السري',
  'Print copies': 'عدد النسخ عند الطباعة', 'Invoices': 'الفواتير', 'Vouchers': 'السندات',
  'Admin adds items, customers and suppliers, voids documents, imports and restores. Accountant enters and posts documents.': 'المدير يضيف الأصناف والزبائن والموردين ويلغي ويستورد ويسترجع. المحاسب يدخل ويرحّل المستندات.',
  'This is version 0.1. Data is stored in this browser on this device. Cloud sync, real user accounts and permissions enforced by the server come in stage 3.': 'هذه النسخة 0.1. البيانات محفوظة بهذا المتصفح على هذا الجهاز. المزامنة السحابية وحسابات المستخدمين وصلاحيات السيرفر بالمرحلة 3.',
  'Type the item code, or leave it empty and type the first letters of the name.': 'اكتب رقم الصنف، أو اتركه فاضي واكتب أول حروف من اسمه.',
  'moves: code → name → price → qty → bonus → discount → next line.': 'بتنقلك: الرقم ← الاسم ← السعر ← الكمية ← البونص ← الخصم ← السطر التالي.',
  'on an empty line finishes.': 'على سطر فاضي بتنهي الإدخال.', 'on an empty line finishes. F2 opens the item list.': 'على سطر فاضي بتنهي الإدخال. F2 بيفتح قائمة الأصناف.', 'Enter on an empty line brings you here.': 'Enter على سطر فاضي بتجيبك لهون.',
  'Print copies · Invoices': 'عدد النسخ · الفواتير', 'Print copies · Vouchers': 'عدد النسخ · السندات', 'Name': 'الاسم', '#': '#',
  'Leave this document?': 'الخروج من المستند؟', 'You started entering this document. Choose what to do with it.': 'بلّشت بهذا المستند. اختار شو بدك تعمل فيه.',
  'Print & post': 'طباعة وترحيل', 'Cancel & delete draft': 'إلغاء وحذف المسودة', 'Discard': 'إلغاء وحذف', 'Continue editing': 'كمّل الشغل',
  'Posted + saved': 'مرحّل + محفوظ', 'Saved (drafts)': 'محفوظ (مسودات)', 'Posted': 'مرحّل', 'Voided': 'ملغى', 'Cancelled drafts': 'مسودات ملغاة', 'All types': 'كل الأنواع',
  'Saved': 'محفوظ', 'DRAFT': 'مسودة', 'cancelled': 'مسودة ملغاة', 'Notes': 'ملاحظات', 'to leave.': 'للخروج.', 'Duplicate as new draft': 'نسخ كمسودة جديدة',
    'Draft cancelled': 'أُلغيت المسودة', 'Discarded': 'تم الإلغاء', 'Draft created': 'تم إنشاء مسودة',
  'Search by code or name': 'ابحث بالرقم أو الاسم', 'Code, name, or Enter / F2 for the list': 'الرقم أو الاسم، أو Enter / F2 للقائمة',
  'move': 'تنقّل', 'pick': 'اختيار', 'close': 'إغلاق', 'Nothing matches': 'لا يوجد نتائج', 'Click a row to edit it.': 'اضغط على أي سطر لتعديله.',
  'Click a row for its statement.': 'اضغط على أي سطر لكشف حسابه.', 'opens the only match.': 'بيفتح النتيجة إذا كانت وحدة.', 'opens the item list.': 'بيفتح قائمة الأصناف.',
  'Lookup': 'استعلام', 'Save': 'حفظ', 'Exit': 'خروج', 'Back': 'رجوع',
  'Drafts can be edited freely. Posting gives the permanent number and locks the document.': 'المسودة تتعدل بحرية. الترحيل يعطي الرقم الدائم ويقفل المستند.',
  'Change': 'تغيير', 'Remaining': 'المتبقي', 'Last invoice': 'آخر فاتورة', 'Last payment': 'آخر دفعة', 'Last price to this customer': 'آخر سعر لهذا الزبون',
  'Last purchase price': 'آخر سعر شراء', 'Batches in stock': 'الدفعات بالمخزن', 'Last sales': 'آخر المبيعات',
  'Invoice': 'فاتورة', 'Documents': 'المستندات', 'Menu': 'القائمة',
  'Home': 'الرئيسية', 'Invoices': 'الفواتير', 'Vouchers': 'السندات', 'Directories': 'الأدلة', 'System': 'النظام', 'Soon': 'قريباً',
  'Journal voucher': 'سند قيد', 'Chart of accounts': 'دليل الحسابات',
  'Sales by item': 'مبيعات حسب الصنف', 'Sales by customer': 'مبيعات حسب الزبون', 'Purchases by item': 'مشتريات حسب الصنف', 'Purchases by supplier': 'مشتريات حسب المورد',
  'Purchases report': 'تقرير المشتريات', 'Recent documents': 'آخر المستندات', 'AI import': 'إدخال ذكي', 'Print / PDF': 'طباعة / PDF', 'New': 'جديد',
  'Posted invoices minus returns, VAT included. Tap a row for its details.': 'الفواتير المرحّلة ناقص المرتجعات، شامل الضريبة. اضغط على أي سطر لتفاصيله.',
  'Fixed chart in this version. Balances come from posted entries only.': 'دليل ثابت بهذه النسخة. الأرصدة من القيود المرحّلة فقط.',
  'asset': 'أصول', 'liability': 'التزامات', 'equity': 'حقوق ملكية', 'income': 'إيرادات', 'expense': 'مصروفات',
  'Code or item name': 'الكود أو اسم الصنف', 'B.': 'بونص', 'Add line': 'أضف السطر', 'Lookup (F2)': 'استعلام',
  // toasts
  'Draft saved': 'تم حفظ المسودة', 'Saved': 'تم الحفظ', 'Prompt copied': 'تم نسخ البرومبت', 'Restored': 'تم الاسترجاع', 'PIN set': 'تم حفظ الرقم السري', 'Wrong PIN': 'رقم سري خطأ',
  'Voided with reversing entry': 'أُلغي بقيد عكسي',
};

// sentences built from data: [regex, replacement]
const PATTERNS = [
  [/^Posted (.+)$/, 'تم ترحيل $1'],
  [/^New (.+)$/, (m, x) => 'جديد: ' + (AR[x.charAt(0).toUpperCase() + x.slice(1)] || x)],
  [/^(Sales invoice|Sales return|Receipt voucher|Credit note|Debit note|Purchase invoice|Purchase return|Payment voucher|Opening balance|Opening stock)s$/, (m, x) => AR[x] ? 'كل ' + AR[x] : m],
  [/^Print copy (\d+)$/, 'طباعة نسخة $1'],
  [/^Save draft$/, 'حفظ مسودة'],
  [/^Copy (\d+)$/, 'نسخة $1'],
  [/^(\d+) items\. Codes are permanent\. Items are never deleted, only deactivated\.$/, '$1 صنف. الأكواد ثابتة. الأصناف لا تُحذف، تُعطّل فقط.'],
  [/^(\d+) (customers|suppliers)\. Codes are permanent\. Only the admin adds them\.$/, (m, n, k) => `${n} ${k === 'customers' ? 'زبون' : 'مورد'}. الأكواد ثابتة. الإضافة للمدير فقط.`],
  [/^Balance (.+)$/, 'الرصيد $1'],
  [/^VAT (\d+(\.\d+)?)%( \(included\))?$/, 'الضريبة $1%'],
  [/^(\d+) is used twice \((.+) and (.+)\)$/, 'الكود $1 مستعمل مرتين ($2 و $3)'],
  [/^(.+): code must be digits$/, '$1: الكود لازم يكون أرقام'],
  [/^(.+) already has movements: only a spelling fix of its name is allowed\. For a different name, deactivate it and add a new one\.$/, '$1 عليه حركات: الاسم بيقبل تصحيح إملائي بس. لاسم مختلف، خليه غير فعّال وضيف واحد جديد.'],
  [/^Debit (.+) · Credit (.+)$/, 'مدين $1 · دائن $2'],
  [/^(\d+) series checked$/, 'تم فحص $1 تسلسل'],
  [/^(\d+) matches: type more letters or pick from the list$/, '$1 نتائج: اكتب حروف أكثر أو اختار من القائمة'],
  [/^Nothing matches "(.*)"$/, 'لا شيء يطابق "$1"'],
  [/^No item with code (.+)$/, 'لا يوجد صنف بالرقم $1'],
  [/^Last backup: (.+)$/, 'آخر نسخة: $1'],
  [/^(\d+) records imported( · opening stock posted)?$/, (m, n, os) => `${n} سجل تم استيراده${os ? ' · وترحّلت بضاعة أول المدة' : ''}`],
  [/^Draft created(.*)$/, 'تم إنشاء مسودة$1'],
  [/^(\d+) lines added(.*)$/, 'أُضيف $1 سطر$2'],
];

function tr(s) {
  const k = s.trim();
  if (!k || !/[A-Za-z]/.test(k)) return null;
  if (AR[k]) return s.replace(k, AR[k]);
  for (const [re, rep] of PATTERNS) if (re.test(k)) return s.replace(k, k.replace(re, rep));
  return null;
}

export function translate(root = document.body) {
  if (getLang() !== 'ar') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && !n.parentElement.closest('script,style,textarea,.doc-print,[data-notr],[dir=auto]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { const t = tr(n.nodeValue); if (t !== null) n.nodeValue = t; }
  for (const el of root.querySelectorAll('[placeholder],[title],[data-label],[aria-label]')) {
    for (const a of ['placeholder', 'title', 'data-label', 'aria-label']) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== null) el.setAttribute(a, t); } }
  }
  for (const o of root.querySelectorAll('option')) { const t = tr(o.textContent); if (t !== null) o.textContent = t; }
}

// for confirm()/prompt()/toast() text
export function T(s) { return getLang() === 'ar' ? (tr(s) ?? s) : s; }
