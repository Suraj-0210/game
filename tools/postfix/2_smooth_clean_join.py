import json,glob,math,collections,os
from shapely.geometry import LineString,Polygon,Point
from shapely.strtree import STRtree
from shapely.ops import nearest_points
D='/home/claude/game/public/data/'
LAYOUT={'khandagiri':(-5150,-2650),'baramunda':(-4300,-3700),'jaydev':(-990,-6115),'vanivihar':(800,-6560),'rasulgarh':(2551,-6279),'patia':(-2300,-10650)}
NOFIX=('footway','path','steps','track','pedestrian')
# containers: each is (file, data, ox, oz, roadlist, bldlist, bkind)
cont=[]
for a,(ox,oz) in LAYOUT.items():
    f=D+f'real_{a}.json'; d=json.load(open(f)); cont.append((f,d,ox,oz,d['roads'],d['buildings'],'dict'))
for f in sorted(glob.glob(D+'city/t_*.json')):
    d=json.load(open(f)); cont.append((f,d,0,0,d['roads'],d['b'],'list'))
stats=collections.Counter(); dirty=set()
# ---- A. smooth hairpins (chamfer the corner) ----
for f,d,ox,oz,rs,bs,bk in cont:
    for r in rs:
        if r.get('kind') in NOFIX: continue
        p=r['pts']; k=1; out=[p[0]]
        for k in range(1,len(p)-1):
            a=(p[k][0]-p[k-1][0],p[k][1]-p[k-1][1]); b=(p[k+1][0]-p[k][0],p[k+1][1]-p[k][1]); la=math.hypot(*a); lb=math.hypot(*b)
            ang=math.degrees(math.acos(max(-1,min(1,(a[0]*b[0]+a[1]*b[1])/(la*lb))))) if la>0.01 and lb>0.01 else 0
            if ang>100 and la>=3 and lb>=3:
                t1=min(0.4,6/la); t2=min(0.4,6/lb)
                out.append([round(p[k][0]-a[0]*t1,1),round(p[k][1]-a[1]*t1,1)]); out.append([round(p[k][0]+b[0]*t2,1),round(p[k][1]+b[1]*t2,1)])
                stats['hairpin smoothed']+=1; dirty.add(f)
            else: out.append(p[k])
        out.append(p[-1]); r['pts']=out
# ---- B. buildings: off the roads, no overlaps ----
def foot(bk,b,ox,oz):
    if bk=='dict': x,z,w,d,yaw=b['x']+ox,b['z']+oz,b['w'],b['d'],b['yaw']
    else: x,z,w,d,yaw=b[0],b[1],b[2],b[3],b[4]
    w=min(w,60);d=min(d,60);c,s=math.cos(yaw),math.sin(yaw)
    return Polygon([(x+a*w/2*c+q*d/2*s,z-a*w/2*s+q*d/2*c) for a,q in((1,1),(1,-1),(-1,-1),(-1,1))])
allroads=[];rl=[]
for f,d,ox,oz,rs,bs,bk in cont:
    for r in rs:
        if r.get('kind') in ('footway','path','steps','track','service','pedestrian') or len(r['pts'])<2: continue
        allroads.append(LineString([(p[0]+ox,p[1]+oz) for p in r['pts']]).buffer(r['w']/2)); 
rt=STRtree(allroads)
bl=[]  # (cont idx, bld idx, polygon)
for ci,(f,d,ox,oz,rs,bs,bk) in enumerate(cont):
    for bi,b in enumerate(bs): bl.append((ci,bi,foot(bk,b,ox,oz)))
bt=STRtree([x[2] for x in bl]); kill=set()
for n,(ci,bi,P) in enumerate(bl):
    for j in rt.query(P):
        if allroads[j].intersection(P).area>0.25*P.area: kill.add(n); stats['building removed: on a road']+=1; break
for n,(ci,bi,P) in enumerate(bl):
    if n in kill: continue
    for m in bt.query(P):
        if m<=n or m in kill: continue
        Q=bl[m][2]; ov=P.intersection(Q).area
        if ov>0.35*min(P.area,Q.area):
            kill.add(n if P.area<Q.area else m); stats['building removed: overlapped another']+=1
            if n in kill: break
rm=collections.defaultdict(set)
for n in kill: rm[bl[n][0]].add(bl[n][1])
for ci,s in rm.items():
    f,d,ox,oz,rs,bs,bk=cont[ci]; bs[:]=[b for i,b in enumerate(bs) if i not in s]; dirty.add(f)
# ---- C. area edge: join road ends to the road they stop short of ----
tb=lambda v:min(v%500,500-v%500)
W=[]
for f,d,*_ in cont:
    for Ln in d.get('land',[]):
        if Ln['k']=='water' and not Ln.get('line') and len(Ln['pts'])>=3:
            P=Polygon(Ln['pts']); W.append(P if P.is_valid else P.buffer(0))
wt=STRtree(W) if W else None
allL=[];ref=[]
for ci,(f,d,ox,oz,rs,bs,bk) in enumerate(cont):
    for r in rs:
        if len(r['pts'])>=2 and r.get('kind') not in NOFIX: allL.append(LineString([(p[0]+ox,p[1]+oz) for p in r['pts']])); ref.append((ci,r))
lt=STRtree(allL)
sq=[(0,0)]+list(LAYOUT.values())
for ci,(f,d,ox,oz,rs,bs,bk) in enumerate(cont):
    if not f.endswith('.json') or '/city/' in f: continue
    for r in rs:
        if r.get('kind') in NOFIX or len(r['pts'])<2: continue
        for end in (0,-1):
            p=r['pts'][end]; X,Z=p[0]+ox,p[1]+oz
            e=max(abs(p[0]),abs(p[1]))
            if not 470<e<520: continue
            P=Point(X,Z)
            if any(allL[j].distance(P)<1 for j in lt.query(P.buffer(1)) if ref[j][1] is not r): continue
            q=r['pts'][1] if end==0 else r['pts'][-2]; dx,dz=p[0]-q[0],p[1]-q[1]; dl=math.hypot(dx,dz) or 1
            best=None
            for j in lt.query(P.buffer(70)):
                if ref[j][1] is r: continue
                dist=allL[j].distance(P)
                if dist<1 or dist>70: continue
                c=nearest_points(allL[j],P)[0]; vx,vz=c.x-X,c.y-Z; vl=math.hypot(vx,vz)
                if (dx*vx+dz*vz)/(dl*vl)<math.cos(math.radians(55)): continue
                if wt is not None and any(W[w].intersects(LineString([(X,Z),(c.x,c.y)])) for w in wt.query(LineString([(X,Z),(c.x,c.y)]))): continue
                if best is None or dist<best[0]: best=(dist,c)
            if best:
                c=best[1]; np_=[round(c.x-ox,1),round(c.y-oz,1)]
                (r['pts'].insert(0,np_) if end==0 else r['pts'].append(np_)); stats['area-edge road joined']+=1; dirty.add(f)
print(dict(stats),len(dirty))
for f,d,*_ in cont:
    if f in dirty: json.dump(d,open(f,'w'),separators=(',',':'))
