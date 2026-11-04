// Phase-1 screens as sheets. Each screen has exactly one primary action.
import type { ReactNode } from 'react';
import { Icon } from './icons.tsx';

export type Sheet = { id: string; kind: string; title: string; body: ReactNode; inspect: { label: string; value: string }[] };
export type Screen = { id: string; title: string; group: 'project' | 'later' | 'system'; icon: string; primary: string; sheets: Sheet[]; later?: boolean };

const empty = (icon: string, title: string, text: string) => (
  <div className="empty"><Icon name={icon} /><b>{title}</b><span>{text}</span></div>
);

export const SCREENS: Screen[] = [
  {
    id: 'library', title: 'المكتبة', group: 'project', icon: 'library', primary: 'استورد ملفات',
    sheets: [
      { id: 'lib-drop', kind: 'استيراد', title: 'اسحب ملفاتك هنا', body: empty('drop', 'المكتبة فاضية', 'صور وفيديو وصوت. كل ملف بيتسجل بأصله: الأداة والبرومبت والـ seed والنسخة والرخصة.'),
        inspect: [{ label: 'السقف', value: 'فيديو 1080p · صور 2K' }, { label: 'البحث', value: 'بالكلمات الآن · بالمعنى لاحقاً' }] },
      { id: 'lib-watch', kind: 'الفولدر المراقَب', title: 'Inbox', body: <p>أي ملف ينزل في الفولدر ده بيتسجل لوحده ويترتبط باللقطة من اسمه أو من الكيت.</p>,
        inspect: [{ label: 'المسار', value: '~/Ghorfa/Inbox' }, { label: 'الحالة', value: 'يتوصل في خطوة المكتبة' }] }
    ]
  },
  {
    id: 'characters', title: 'الشخصيات', group: 'project', icon: 'character', primary: 'اسحب من Higgsfield',
    sheets: [
      { id: 'char-donia', kind: 'بطاقة شخصية', title: 'دنيا', body: <p>المرجع «Donia-Final» ومشروع «I Am The World — Donia Wardrobe (Locked)». البطاقة بتتملي من الملفات المعتمدة في خطوة الشخصيات.</p>,
        inspect: [{ label: 'البراند', value: 'LIINE24' }, { label: 'المراجع', value: 'لحد ٢٠' }, { label: 'تطابق الوش', value: '٩٥٪ من خط الأساس' }, { label: 'الاحتشام', value: 'الصدر والضهر مغطيين' }] }
    ]
  },
  {
    id: 'song', title: 'الأغنية', group: 'project', icon: 'song', primary: 'حلّل الأغنية',
    sheets: [
      { id: 'song-bpm', kind: 'الإيقاع', title: 'BPM والأقسام وشبكة البارات', body: <p>بيتقاس من <span className="ltr mono">I_Am_The_World_v44_FINAL.flac</span>. القياس القديم 71.9، والجديد بيستنى «اعتمد».</p>,
        inspect: [{ label: 'القياس السابق', value: '71.9' }, { label: 'الحالة', value: 'غير معتمد' }] },
      { id: 'song-rules', kind: 'القواعد', title: 'ملف قواعد الكتابة', body: <p>ملف واحد قابل للتعديل لكل براند ولغة: گ بدل ج، ئ/أ بدل ق، المد على كلمة أو اتنين، الستايل أقل من ١٠٠٠ حرف.</p>,
        inspect: [{ label: 'downtempo', value: 'ممنوع في ستايل Suno بس' }] },
      { id: 'song-suno', kind: 'Suno', title: 'باكدج Suno', body: <p>الكلمات والستايل بأزرار نسخ. والتوليد عن طريق Suno MCP الرسمي لما يتأكد ويتوصل.</p>,
        inspect: [{ label: 'الطريقة', value: 'MCP (Beta) · جسر لو وقع' }] }
    ]
  },
  { id: 'clip', title: 'الكليب', group: 'later', icon: 'clip', primary: '', sheets: [], later: true },
  { id: 'reels', title: 'الريلز', group: 'later', icon: 'reels', primary: '', sheets: [], later: true },
  { id: 'release', title: 'النشر', group: 'later', icon: 'release', primary: '', sheets: [], later: true },
  {
    id: 'connections', title: 'الاتصالات', group: 'system', icon: 'connections', primary: 'اختبر الاتصالات',
    sheets: [
      { id: 'conn-list', kind: 'الاشتراكات', title: 'المولدات', body: (
        <div className="rows">
          {[['Higgsfield', 'MCP · خطة Max · Kling وMiniMax وSeedance'], ['Suno', 'MCP رسمي (Beta)'], ['Runway', 'MCP مستضاف · OAuth'],
            ['Grok Imagine', 'جسر سريع'], ['Google Flow', 'جسر'], ['Wan', 'جسر'], ['Claude', 'المساعد'], ['Gemini', 'تحليل · رأي تاني']].map(([n, m]) => (
            <div className="row" key={n}><span className="dot" /><b className="ltr">{n}</b><span className="v">{m}</span></div>
          ))}
        </div>),
        inspect: [{ label: 'القاعدة', value: 'MCP رسمي من موقع الشركة · من غير API keys · من غير وسطاء' }, { label: 'الحالة', value: 'لسه ما اتوصلش (خطوة ٥)' }] }
    ]
  },
  {
    id: 'skills', title: 'السكيلز', group: 'system', icon: 'skills', primary: 'سكيل جديد',
    sheets: [
      { id: 'skill-shape', kind: 'البنية', title: 'ملف لكل وصفة', body: <p className="ltr mono" style={{ textAlign: 'right' }}>inputs · steps · checks · on_fail · approval</p>,
        inspect: [{ label: 'المحرك', value: 'لاحقاً' }] }
    ]
  }
];
