import json,glob
from shapely.geometry import LineString
from shapely.strtree import STRtree
D='public/data/'
LAYOUT={'khandagiri':(-5150,-2650),'baramunda':(-4300,-3700),'jaydev':(-990,-6115),'vanivihar':(800,-6560),'rasulgarh':(2551,-6279),'patia':(-2300,-10650)}
areas=[]
for a,(ox,oz) in LAYOUT.items():
    for r in json.load(open(D+f'real_{a}.json'))['roads']:
        if len(r['pts'])>1: areas.append(LineString([(p[0]+ox,p[1]+oz) for p in r['pts']]))
t=STRtree(areas); n=0
for f in glob.glob(D+'city/t_*.json'):
    d=json.load(open(f)); keep=[]; ch=False
    for r in d['roads']:
        if len(r['pts'])<2 or r.get('kind') in('footway','path','steps','track'): keep.append(r); continue
        L=LineString(r['pts']); b=L.buffer(1.5); dup=False
        for j in t.query(b):
            if areas[j].intersection(b).length>0.6*L.length: dup=True;break
        if dup: n+=1; ch=True
        else: keep.append(r)
    if ch: d['roads']=keep; json.dump(d,open(f,'w'),separators=(',',':'))
print('dedupe removed',n)
