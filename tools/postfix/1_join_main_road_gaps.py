import json,glob,os,math,collections
from shapely.geometry import LineString,Point
from shapely.strtree import STRtree
from shapely.ops import nearest_points
G='/home/claude/game/public/data/city/'
files={}; recs=[]   # recs: (file, idx)
for f in sorted(glob.glob(G+'t_*.json')):
    t=json.load(open(f)); files[f]=t
    for i,r in enumerate(t['roads']): recs.append((f,i))
L=[LineString(files[f]['roads'][i]['pts']) if len(files[f]['roads'][i]['pts'])>1 else None for f,i in recs]
valid=[k for k,l in enumerate(L) if l is not None]
tree=STRtree([L[k] for k in valid])
IMP={'trunk':5,'trunk_link':4,'primary':5,'primary_link':4,'secondary':4,'secondary_link':3,'tertiary':3,'tertiary_link':3,'unclassified':2,'residential':2,'living_street':1,'service':1}
tb=lambda v:min(v%500,500-v%500)
from shapely.geometry import Polygon
WATER=[]
for f,t in files.items():
    for Lnd in t.get('land',[]):
        if Lnd['k']=='water':
            if Lnd.get('line'): WATER.append(LineString(Lnd['pts']).buffer(Lnd['w']/2))
            elif len(Lnd['pts'])>=3:
                P_=Polygon(Lnd['pts']); WATER.append(P_ if P_.is_valid else P_.buffer(0))
snapped=collections.Counter(); dirty=set()
for k in valid:
    f,i=recs[k]; r=files[f]['roads'][i]; kind=r.get('kind')
    if kind not in IMP: continue
    pts=r['pts']
    for end in (0,-1):
        p=pts[end]
        if tb(p[0])<30 or tb(p[1])<30: continue
        q=pts[1] if end==0 else pts[-2]
        dx,dz=p[0]-q[0],p[1]-q[1]; dl=math.hypot(dx,dz)
        if dl<0.5: continue
        if IMP[kind]<3: continue                     # only real through roads; small lanes may be genuine dead ends
        P=Point(p); maxgap=40
        best=None
        for j in tree.query(P.buffer(maxgap)):
            kk=valid[j]
            if kk==k: continue
            o=files[recs[kk][0]]['roads'][recs[kk][1]]
            if o.get('g') is not None and o.get('g')==r.get('g'): continue
            if o.get('kind') not in IMP or IMP[o['kind']]<IMP[kind]-1: continue
            d=L[kk].distance(P)
            if d<1.0 or d>maxgap: continue           # already touching, or too far
            c=nearest_points(L[kk],P)[0]
            vx,vz=c.x-p[0],c.y-p[1]; vl=math.hypot(vx,vz)
            cosang=(dx*vx+dz*vz)/(dl*vl)
            if cosang<math.cos(math.radians(30)): continue   # must point at it
            seg=LineString([p,(c.x,c.y)])
            # the bridge must not cross anything else, run along the target, or cross water
            if any(valid[m]!=kk and valid[m]!=k and L[valid[m]].distance(seg)<0.5 and not (files[recs[valid[m]][0]]['roads'][recs[valid[m]][1]].get('g')==r.get('g')) for m in tree.query(seg.buffer(0.5))): continue
            tg=L[kk]; pos=tg.project(c); a0=tg.interpolate(max(0,pos-3)); a1=tg.interpolate(min(tg.length,pos+3))
            tx,tz=a1.x-a0.x,a1.y-a0.y; tl=math.hypot(tx,tz) or 1
            if abs((vx*tx+vz*tz)/(vl*tl))>0.87: continue   # meets the target at under 30 degrees: that is a parallel run
            if any(w.intersects(seg) for w in WATER): continue
            if best is None or d<best[0]: best=(d,c)
        if best:
            c=best[1]; newp=[round(c.x,1),round(c.y,1)]
            if end==0: pts.insert(0,newp)
            else: pts.append(newp)
            snapped[kind]+=1; dirty.add(f)
print(snapped, sum(snapped.values()),'files',len(dirty))
for f in dirty:
    json.dump(files[f],open(f,'w'),separators=(',',':'))
