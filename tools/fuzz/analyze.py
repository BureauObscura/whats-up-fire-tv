import json,re,sys,glob,collections
d=sys.argv[1];types=collections.Counter();seeds=collections.defaultdict(set);ex={};n=0;heap=[]
for f in glob.glob(d+'/*.json')+glob.glob(d+'/*.bad'):
    t=open(f).read();n+=1;seed=f.split('/')[-1].split('.')[0]
    try:j=json.loads(t);fs=j.get('findings',[]);heap.append(j.get('heapMax',0))
    except Exception:fs=re.findall(r'"((?:[A-Z][A-Z-]+)[^"\\]*(?:\\.[^"\\]*)*)"',t)
    for x in fs:
        k=x.split(' ')[0]
        if not re.match(r'^[A-Z][A-Z-]+$',k):continue
        types[k]+=1;seeds[k].add(seed);ex.setdefault(k,x[:230])
print('runs',n,'heapMax max',max(heap or [0]))
for k,c in types.most_common():print(f'{k:22} {c:6} findings in {len(seeds[k]):4} runs | {ex[k]}')
