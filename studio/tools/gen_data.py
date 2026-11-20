# Regenerate studio/data.js from the I Am The World project files:  python3 studio/tools/gen_data.py
import re, json, sys
import os
root=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','projects','i-am-the-world')+'/'
md=open(root+'MAP_v7.md',encoding='utf8').read()
srt=open(root+'v44_en.srt',encoding='utf8').read()
def t2s(t):
    t=t.strip()
    if ':' in t:
        p=t.split(':'); return round(int(p[0])*60+float(p[1]),2)
    return float(t)
def rows(section):
    out=[]
    for line in section.splitlines():
        if line.startswith('|') and not re.match(r'^\|\s*-',line):
            out.append([c.strip() for c in line.strip().strip('|').split('|')])
    return out[1:]
v7part, v71part = md.split('# v7.1')
shots_tbl = v7part.split('## اللقطات')[1].split('## الحسابات')[0]
shots=[]
for r in rows(shots_tbl):
    if len(r)<6 or not r[0].isdigit(): continue
    a,b=r[1].split('–')
    clean=lambda s: re.sub(r'\*\*','',s)
    shots.append(dict(id='S'+r[0],n=int(r[0]),start=t2s(a),end=t2s(b),lyric=clean(r[2]),desc=clean(r[3]),states=r[4],tool=clean(r[5])))
long_tbl=v71part.split('| اللقطة |')[1]
longs=[]
for r in rows('| اللقطة |'+long_tbl):
    if len(r)<6: continue
    tm=r[1]
    m=re.findall(r'(\d+:\d+(?:\.\d+)?)',tm)
    st=t2s(m[0]) if m else None; en=t2s(m[1]) if len(m)>1 else None
    if 'داخل' in tm and m: en=None
    longs.append(dict(id=r[0],time=tm,start=st,end=en,dur=r[2],from_=r[3],camera=re.sub(r'\*\*','',r[4]),events=re.sub(r'\*\*','',r[5])))
cues=[]
for blk in srt.strip().split('\n\n'):
    L=blk.strip().split('\n')
    if len(L)<3: continue
    a,b=L[1].split(' --> ')
    f=lambda x: (lambda h,m,s: int(h)*3600+int(m)*60+float(s.replace(',','.')))(*x.split(':'))
    cues.append(dict(s=round(f(a),3),e=round(f(b),3),t=' '.join(L[2:])))
readme=open(root+'README.md',encoding='utf8').read()
sec=readme.split('## أقسام v44')[1].split('**الإيقاع')[0]
sections=[]
for r in rows(sec):
    if len(r)<2: continue
    m=re.match(r'(\d+:\d+(?:\.\d+)?)',r[1])
    if m: sections.append(dict(name=r[0].replace('"',''),start=t2s(m.group(1))))
data=dict(shots=shots,longs=longs,cues=cues,sections=sections)
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data.js'),'w',encoding='utf8').write('/* Generated from projects/i-am-the-world (MAP_v7.md, v44_en.srt, README.md) by studio/tools/gen_data.py */\nwindow.IATW = '+json.dumps(data,ensure_ascii=False,indent=1)+';\n')
print(len(shots),len(longs),len(cues),len(sections))
print(shots[3]); print(longs[3]); print(sections[:3])
