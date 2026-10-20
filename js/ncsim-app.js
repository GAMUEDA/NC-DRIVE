/* NC PART SIMULATOR — NC Path Simulator v7 (punch / turret / laser), the shop's own simulator.
   NC Drive adds window.NCSim.open(text, name) at the end so other tools can hand it a program. */
(function(){
const $=s=>document.querySelector(s);
const cvs=$('#cv'), ctx=cvs.getContext('2d');
const TV=['--t1','--t2','--t3','--t4','--t5','--t6','--t7','--t8','--t9'];
const RE=/([A-Z])\s*([-+]?\d*\.?\d+)/g;
const PUNCH_SPEED=[2,6,15,40,150], LASER_SPEED=[0.025,0.07,0.18,0.5,1.6];
let M=null, C={}, W=0,H=0,dpr=1, dirty=true;
const st={i:0,frac:0,playing:false,speed:2,follow:false,o1:true,o2:false,hidden:new Set()};
const view={cx:0,cy:0,scale:10};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const dec=()=>M&&M.units==='mm'?2:3;
const fN=v=>v==null||isNaN(v)?'—':(+v).toFixed(dec());
const uL=()=>M&&M.units==='mm'?'mm':'in';

/* ---------- shared tokenizer ---------- */
function words(line){
  const comments=[...line.matchAll(/\(([^)]*)\)/g)].map(m=>m[1].trim());
  let code=line.replace(/\([^)]*\)/g,' ');
  const sc=code.indexOf(';'); if(sc>=0){ const c=code.slice(sc+1).trim(); if(c) comments.push(c); code=code.slice(0,sc); }
  code=code.toUpperCase().trim();
  let o=null; const om=code.match(/^(?:N\d+\s*)?[O:](\d+)/); if(om) o=+om[1];
  const body=code.replace(/^N\d+/,'').replace(/^\s*[O:]\d+/,'');
  const w={},gs=[],ms=[];
  for(const m of body.matchAll(RE)){ const L=m[1],v=parseFloat(m[2]); if(L==='G')gs.push(v); else if(L==='M')ms.push(v); else if(L!=='N') w[L]=v; }
  return {comments,code,o,w,gs,ms};
}
function metaFrom(cm,meta){
  let m;
  if((m=cm.match(/SHEET\s*(?:DIM|SIZE)?\s*[:=]?\s*([\d.]+)\s*[X\s,]\s*([\d.]+)/i))) meta.sheet={w:+m[1],h:+m[2]};
  else if((m=cm.match(/THICK(?:NESS)?\s*[:=]?\s*([\d.]+)/i))) meta.thick=+m[1];
  else if((m=cm.match(/MATERIAL\s*[:=]?\s*(.+)/i))) meta.material=m[1].trim();
  else if((m=cm.match(/CLAMPS?\s*POS\s*[:=]?\s*(.+)/i))) meta.clamps=m[1].split(/-{2,}|,|\s+/).map(Number).filter(n=>!isNaN(n)&&n>0);
  else if(/^\d+\/\d+\/\d+$/.test(cm)) meta.date=cm;
}
const newMeta=()=>({prog:'',name:'',date:'',sheet:null,thick:null,material:'',clamps:[]});
function toListing(text){ return text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); }

/* ---------- detection ---------- */
function detect(text){
  const U=text.toUpperCase();
  const punch=(U.match(/UT\/T\d|M500|M546|G27\s*X|G79|G6[6-9](?!\d)|G26(?!\d)|G28\s*I|G29(?!\d)|G36(?!\d)|G37(?!\d)/g)||[]).length;
  const arcs=(U.match(/G0?[23](?![0-9])/g)||[]).length;
  const lin=(U.match(/G0?1(?![0-9])/g)||[]).length;
  if(punch>=2&&punch>=arcs) return 'punch';
  if(arcs>0||lin>3) return 'laser';
  return 'punch';
}
function unitsFrom(text,kind,ext){
  const U=text.toUpperCase();
  if(kind==='laser'){ if(/G21(?!\d)|G71(?!\d)/.test(U)) return 'mm'; if(/G20(?!\d)|G70(?!\d)/.test(U)) return 'in'; }
  else if(/G21(?!\d)/.test(U)) return 'mm';
  return ext>250?'mm':'in';
}

/* ---------- punch parser (Amada-style) ---------- */
function parsePunch(text,opt){
  const tools={}, order=[], meta=newMeta(), events=[], listing=toListing(text);
  let x=null,y=null,tool=null,c=0,mode='PUNCH';
  const addTool=(id,d)=>{ if(!tools[id]){ tools[id]=d; order.push(id);} };
  const pending=[];
  listing.forEach((line,li)=>{
    if(line==='%') return;
    const p=words(line);
    for(const cm of p.comments){
      const m=cm.match(/^UT\/T(\d+)\s+(\w+)\s+(.*?)\s+KEYED\s+(\S+)\s*$/i);
      if(m){
        const id='T'+(+m[1]), kind=m[2].toUpperCase(), rest=m[3].trim(), keyed=m[4].toUpperCase();
        const d={id,kind,keyed:keyed==='INDEX'?'INDEX':parseFloat(keyed)};
        if(kind==='ROUND'){d.shape='ROUND';d.d=parseFloat(rest);d.desc='Round';}
        else if(kind==='SQUARE'){d.shape='SQUARE';d.s=parseFloat(rest);d.desc='Square';}
        else if(kind==='RECT'||kind==='OBROUND'||kind==='OB'){const r=rest.match(/([\d.]+)\s*X\s*([\d.]+)/i)||[0,0.25,0.25];d.shape=kind==='RECT'?'RECT':'OB';d.L=+r[1];d.W=+r[2];d.desc=kind==='RECT'?'Rectangle':'Obround';}
        else { if(/BOWTIE/i.test(rest)){const mm=rest.match(/([\d.]+)\s*MM/i);d.shape='BOWTIE';d.mm=mm?+mm[1]:null;d.desc='Bowtie (special)';}
          else if(/COIN/i.test(rest)){d.shape='COIN';d.desc='Coining (special)';}
          else {d.shape='SPECIAL';d.raw=rest;d.desc='Special';} }
        addTool(id,d);
      } else metaFrom(cm,meta);
    }
    if(p.o!=null){ if(!meta.prog){ meta.prog='O'+p.o; meta.name=p.comments[0]||''; } return; }
    const w=p.w, gs=p.gs;
    p.ms.forEach(v=>{ if(v===500)mode='PUNCH'; else if(v===546)mode='COIN'; });
    if(w.T!==undefined){ tool='T'+w.T; c=0; if(!tools[tool]) addTool(tool,{id:tool,kind:'?',keyed:'INDEX',shape:'SPECIAL',raw:'',desc:'Not in tool list'}); }
    if(w.C!==undefined) c=w.C;
    if(gs.includes(27)){ events.push({type:'repo',li,d:w.X??0,x,y,tool}); return; }
    if(gs.includes(92)||gs.includes(6)||gs.includes(50)) return;
    const has=w.X!==undefined||w.Y!==undefined;
    const ang=()=>{ const t=tools[tool]; return t&&t.keyed!=='INDEX'?t.keyed:c; };
    if(gs.includes(70)){ if(has){ x=w.X??x; y=w.Y??y; events.push({type:'move',li,x,y,tool,mode}); } }
    else if(gs.includes(79)){
      if(x==null) return;
      const I=w.I||0, J=(w.J||0)*Math.PI/180, Q=w.Q||I||1, n=Math.max(1,Math.round(I/Q)), sx=x, sy=y;
      for(let k=0;k<=n;k++){ const d=I*k/n; x=sx+Math.cos(J)*d; y=sy+Math.sin(J)*d; events.push({type:'hit',li,x,y,tool,ang:ang(),mode,pat:true}); }
    }
    else if(has&&tool){ x=w.X??x; y=w.Y??y; events.push({type:'hit',li,x,y,tool,ang:ang(),mode}); }
  });
  const hits=events.filter(e=>e.type==='hit');
  if(!hits.length) throw new Error('no punch hits were found. Each hit needs a T tool and X/Y position');
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity; hits.forEach(e=>{bx0=Math.min(bx0,e.x);by0=Math.min(by0,e.y);bx1=Math.max(bx1,e.x);by1=Math.max(by1,e.y);});
  const units=opt.units!=='auto'?opt.units:unitsFrom(text,'punch',meta.sheet?meta.sheet.w:Math.max(bx1,by1));
  const k=units==='mm'?25.4:1;
  order.forEach((id,n)=>{ const t=tools[id]; t.ci=n%TV.length;
    if(t.shape==='BOWTIE') t.size=t.mm!=null?(units==='mm'?t.mm:t.mm/25.4):0.125*k;
    t.label=t.shape==='ROUND'?'Ø'+t.d.toFixed(units==='mm'?2:3):t.shape==='SQUARE'?t.s.toFixed(units==='mm'?2:4)+' sq':(t.shape==='RECT'||t.shape==='OB')?t.L.toFixed(3)+' × '+t.W.toFixed(3):t.shape==='BOWTIE'?(t.mm!=null?t.mm+' mm':'—'):t.shape==='COIN'?'—':(t.raw||'?');
  });
  let sheet;
  if(meta.sheet) sheet={x0:0,y0:0,w:meta.sheet.w,h:meta.sheet.h,declared:true};
  else { const pad=Math.max(bx1-bx0,by1-by0)*0.05+0.5*k; sheet={x0:Math.min(0,bx0-pad),y0:Math.min(0,by0-pad),declared:false}; sheet.w=bx1+pad-sheet.x0; sheet.h=by1+pad-sheet.y0; }
  const cum=[0]; let h=0; events.forEach(e=>{ if(e.type==='hit')h++; cum.push(h); });
  const counts={}; hits.forEach(e=>counts[e.tool]=(counts[e.tool]||0)+1);
  return {kind:'punch',tools,order,meta,events,listing,cum,counts,total:h,units,k,sheet,repoCount:events.filter(e=>e.type==='repo').length};
}

/* ---------- laser parser (Fanuc-style G-code) ---------- */
function parseLaser(text,opt){
  const listing=toListing(text), meta=newMeta();
  const P=listing.map(l=>l==='%'?{comments:[],code:'%',o:null,w:{},gs:[],ms:[]}:words(l));
  P.forEach(p=>p.comments.forEach(cm=>metaFrom(cm,meta)));
  const oIdx={}; P.forEach((p,i)=>{ if(p.o!=null&&oIdx[p.o]===undefined) oIdx[p.o]=i; });
  const firstO=P.findIndex(p=>p.o!=null);
  if(firstO>=0){ meta.prog='O'+P[firstO].o; meta.name=P[firstO].comments[0]||''; }
  const events=[], unknownG=new Set(), missing=new Set(); let comp=false, steps=0;
  let pc=firstO>=0?firstO:0, stack=[], abs=true, motion=0, x=0, y=0, f=null, contour=-1, lastType=null;
  const KNOWN=new Set([0,1,2,3,4,9,17,20,21,40,41,42,43,49,53,54,55,56,57,58,59,61,64,70,71,80,90,91,92,94,28,30]);
  while(pc<P.length&&steps<800000){
    steps++;
    const p=P[pc], li=pc;
    if(p.o!=null&&pc!==firstO&&stack.length===0) break;
    const w=p.w, gs=p.gs;
    let skipMotion=false;
    for(const g of gs){
      if(g===0||g===1||g===2||g===3) motion=g;
      else if(g===90) abs=true; else if(g===91) abs=false;
      else if(g===41||g===42) comp=true;
      else if(g===92){ if(w.X!==undefined) x=w.X; if(w.Y!==undefined) y=w.Y; skipMotion=true; }
      else if(g===28||g===30||g===4||g===53||g===10) skipMotion=true;
      else if(!KNOWN.has(g)) unknownG.add('G'+g);
    }
    if(w.F!==undefined) f=w.F;
    let jumped=false, stop=false;
    for(const m of p.ms){
      if(m===98){ let sub=w.P, rep=w.L||1; if(sub>=10000&&w.L===undefined){ rep=Math.floor(sub/10000)||1; sub=sub%10000; }
        if(oIdx[sub]!==undefined){ stack.push({ret:pc+1,sub,left:rep-1}); pc=oIdx[sub]+1; jumped=true; } else missing.add('O'+sub); }
      else if(m===99){ if(!stack.length){ stop=true; break; } const top=stack[stack.length-1]; if(top.left>0){ top.left--; pc=oIdx[top.sub]+1; } else { stack.pop(); pc=top.ret; } jumped=true; }
      else if(m===30||m===2){ if(!stack.length){ stop=true; break; } }
    }
    if(!skipMotion&&!jumped){
      const hasXY=w.X!==undefined||w.Y!==undefined, hasIJ=w.I!==undefined||w.J!==undefined||w.R!==undefined;
      if(hasXY||((motion===2||motion===3)&&hasIJ)){
        const nx=w.X!==undefined?(abs?w.X:x+w.X):x, ny=w.Y!==undefined?(abs?w.Y:y+w.Y):y;
        const e={type:motion===0?'rapid':'cut',g:motion,li,x0:x,y0:y,x1:nx,y1:ny,f};
        if((motion===2||motion===3)&&hasIJ){
          let cx,cy; const ccw=motion===3;
          if(w.R!==undefined&&w.I===undefined&&w.J===undefined){
            const dx=nx-x, dy=ny-y, d=Math.hypot(dx,dy), R=w.R;
            const h=Math.sqrt(Math.max(0,R*R-d*d/4)), lx=-dy/(d||1), ly=dx/(d||1), sgn=(ccw?1:-1)*(R<0?-1:1);
            cx=(x+nx)/2+lx*h*sgn; cy=(y+ny)/2+ly*h*sgn;
          } else { cx=x+(w.I||0); cy=y+(w.J||0); }
          const r=Math.hypot(x-cx,y-cy); const a0=Math.atan2(y-cy,x-cx), a1=Math.atan2(ny-cy,nx-cx);
          let sw=a1-a0; if(ccw){ while(sw<=1e-9) sw+=Math.PI*2; } else { while(sw>=-1e-9) sw-=Math.PI*2; }
          e.arc={cx,cy,r,a0,sw}; e.len=Math.abs(sw)*r;
        } else e.len=Math.hypot(nx-x,ny-y);
        if(e.type==='cut'&&lastType!=='cut'){ contour++; e.pierce=true; }
        e.contour=e.type==='cut'?contour:-1;
        lastType=e.type; events.push(e); x=nx; y=ny;
      }
    }
    if(stop) break;
    if(!jumped) pc++;
  }
  if(!events.length) throw new Error('no X/Y motion blocks were found');
  // bounds
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;
  const grow=(px,py)=>{bx0=Math.min(bx0,px);by0=Math.min(by0,py);bx1=Math.max(bx1,px);by1=Math.max(by1,py);};
  const cuts=events.filter(e=>e.type==='cut'); const src=cuts.length?cuts:events;
  src.forEach(e=>{ grow(e.x0,e.y0); grow(e.x1,e.y1); if(e.arc){ for(let k=1;k<24;k++){ const a=e.arc.a0+e.arc.sw*k/24; grow(e.arc.cx+e.arc.r*Math.cos(a),e.arc.cy+e.arc.r*Math.sin(a)); } } });
  const ext=meta.sheet?Math.max(meta.sheet.w,meta.sheet.h):Math.max(bx1-bx0,by1-by0,Math.abs(bx1),Math.abs(by1));
  const units=opt.units!=='auto'?opt.units:unitsFrom(text,'laser',ext);
  let sheet;
  if(meta.sheet) sheet={x0:0,y0:0,w:meta.sheet.w,h:meta.sheet.h,declared:true};
  else { const pad=Math.max(bx1-bx0,by1-by0)*0.05||1; sheet={x0:bx0-pad,y0:by0-pad,w:bx1-bx0+2*pad,h:by1-by0+2*pad,declared:false}; }
  // contours + cumulative
  const contours=[]; const cumCut=[0]; let cl=0, rl=0, tmin=0, noF=false;
  events.forEach((e,i)=>{ if(e.type==='cut'){ cl+=e.len; if(e.f>0) tmin+=e.len/e.f; else noF=true;
      if(e.pierce) contours.push({id:e.contour,ev:i,end:i,li:e.li,x:e.x0,y:e.y0,len:0,t:0});
      const c=contours[contours.length-1]; c.len+=e.len; c.end=i; if(e.f>0) c.t+=e.len/e.f; }
    else rl+=e.len; cumCut.push(cl); });
  const kerf=(opt.kerfMM||0)/(units==='mm'?1:25.4);
  const diag=Math.hypot(sheet.w,sheet.h);
  return {kind:'laser',meta,events,listing,units,k:units==='mm'?25.4:1,sheet,contours,cumCut,cutLen:cl,rapidLen:rl,tmin,noF,kerf,diag,comp,unknownG:[...unknownG],missing:[...missing],hasSub:Object.keys(oIdx).length>1,steps};
}

/* ---------- punch geometry ---------- */
function shapePath(t,ang,k){
  ctx.rotate(ang*Math.PI/180); ctx.beginPath();
  switch(t.shape){
    case 'ROUND': ctx.arc(0,0,t.d/2,0,Math.PI*2); break;
    case 'SQUARE': ctx.rect(-t.s/2,-t.s/2,t.s,t.s); break;
    case 'RECT': ctx.rect(-t.L/2,-t.W/2,t.L,t.W); break;
    case 'OB': { const r=Math.min(t.L,t.W)/2, a=Math.max(t.L,t.W)/2-r; ctx.arc(a,0,r,-Math.PI/2,Math.PI/2); ctx.arc(-a,0,r,Math.PI/2,Math.PI*1.5); ctx.closePath(); if(t.W>t.L){} break; }
    case 'BOWTIE': { const s=t.size/2, wst=s*.18; ctx.moveTo(-s,-s);ctx.lineTo(-wst,-wst*.6);ctx.lineTo(wst,-wst*.6);ctx.lineTo(s,-s);ctx.lineTo(s,s);ctx.lineTo(wst,wst*.6);ctx.lineTo(-wst,wst*.6);ctx.lineTo(-s,s);ctx.closePath(); break; }
    case 'COIN': ctx.arc(0,0,0.045*k,0,Math.PI*2); break;
    default: ctx.arc(0,0,0.1*k,0,Math.PI*2);
  }
}
function bbox(t,e,k){
  const a=e.ang*Math.PI/180, ca=Math.abs(Math.cos(a)), sa=Math.abs(Math.sin(a)); let hx,hy;
  if(t.shape==='RECT'||t.shape==='OB'){hx=(t.L*ca+t.W*sa)/2;hy=(t.L*sa+t.W*ca)/2;}
  else if(t.shape==='SQUARE'){hx=hy=t.s*(ca+sa)/2;}
  else { const r=t.shape==='ROUND'?t.d/2:t.shape==='BOWTIE'?t.size*.71:0.05*k; hx=hy=r; }
  return [e.x-hx,e.y-hy,e.x+hx,e.y+hy];
}
/* ---------- laser geometry ---------- */
function segPath(e,t){
  ctx.moveTo(e.x0,e.y0);
  if(e.arc){ const a=e.arc; ctx.arc(a.cx,a.cy,a.r,a.a0,a.a0+a.sw*t,a.sw<0); }
  else ctx.lineTo(e.x0+(e.x1-e.x0)*t,e.y0+(e.y1-e.y0)*t);
}
function pointAt(e,t){ if(e.arc){ const a=e.arc,an=a.a0+a.sw*t; return [a.cx+a.r*Math.cos(an),a.cy+a.r*Math.sin(an)]; } return [e.x0+(e.x1-e.x0)*t,e.y0+(e.y1-e.y0)*t]; }

/* ---------- colors / view ---------- */
function readColors(){ const cs=getComputedStyle(document.documentElement), g=n=>cs.getPropertyValue(n).trim();
  C={bed:g('--bed'),sheet:g('--sheet'),edge:g('--sheet-edge'),hole:g('--hole'),grid:g('--grid'),gtext:g('--grid-text'),accent:g('--accent'),clamp:g('--clamp'),path:g('--path'),tools:TV.map(g)}; dirty=true; }
const recolor=()=>{ readColors(); if(M) renderSide(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',recolor);
new MutationObserver(recolor).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
function resize(){ const r=cvs.getBoundingClientRect(); dpr=window.devicePixelRatio||1; W=r.width;H=r.height; cvs.width=Math.round(W*dpr); cvs.height=Math.round(H*dpr); dirty=true; }
function fitBox(x0,y0,x1,y1){ view.cx=(x0+x1)/2; view.cy=(y0+y1)/2; view.scale=Math.min(W/(x1-x0),H/(y1-y0))*.94; dirty=true; }
const S=()=>M.sheet;
const mg=()=>Math.max(S().w,S().h)*0.02;
function vFit(){ const s=S(), m=mg(), mb=M.kind==='punch'&&M.meta.clamps.length?2.2*M.k:m; fitBox(s.x0-m,s.y0-mb,s.x0+s.w+m,s.y0+s.h+m); }
function endSpan(){ const s=S(); return Math.min(s.w/2,Math.max(s.h*0.6,s.w*0.08)); }
function vLeft(){ const s=S(), m=mg(); fitBox(s.x0-m,s.y0-m,s.x0+endSpan(),s.y0+s.h+m); }
function vRight(){ const s=S(), m=mg(); fitBox(s.x0+s.w-endSpan(),s.y0-m,s.x0+s.w+m,s.y0+s.h+m); }
const toWorld=(sx,sy)=>[view.cx+(sx-W/2)/view.scale, view.cy-(sy-H/2)/view.scale];
function zoomAt(f,sx,sy){ const [wx,wy]=toWorld(sx,sy); view.scale=Math.min(20000,Math.max(0.05,view.scale*f)); view.cx=wx-(sx-W/2)/view.scale; view.cy=wy+(sy-H/2)/view.scale; dirty=true; }

/* ---------- draw ---------- */
function niceStep(){ const target=90/view.scale; for(const s of [0.01,0.025,0.05,0.1,0.25,0.5,1,2,5,10,20,50,100,200,500,1000]) if(s>=target) return s; return 2000; }
function drawGrid(){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const step=niceStep(), [x0,y1]=toWorld(0,0), [x1,y0]=toWorld(W,H);
  ctx.strokeStyle=C.grid; ctx.lineWidth=1; ctx.fillStyle=C.gtext; ctx.font='10px "IBM Plex Mono", monospace';
  const d=step<0.05?3:step<1?2:0;
  ctx.beginPath();
  for(let x=Math.ceil(x0/step)*step;x<=x1;x+=step){ const sx=Math.round(W/2+(x-view.cx)*view.scale)+.5; ctx.moveTo(sx,0);ctx.lineTo(sx,H); }
  for(let y=Math.ceil(y0/step)*step;y<=y1;y+=step){ const sy=Math.round(H/2-(y-view.cy)*view.scale)+.5; ctx.moveTo(0,sy);ctx.lineTo(W,sy); }
  ctx.stroke();
  ctx.textBaseline='bottom';
  for(let x=Math.ceil(x0/step)*step;x<=x1;x+=step){ ctx.fillText(x.toFixed(d),W/2+(x-view.cx)*view.scale+3,H-4); }
  ctx.textBaseline='middle';
  for(let y=Math.ceil(y0/step)*step;y<=y1;y+=step){ const sy=H/2-(y-view.cy)*view.scale; if(sy<24||sy>H-18) continue; ctx.fillText(y.toFixed(d),4,sy-7); }
}
function worldT(){ const s=view.scale; ctx.setTransform(dpr*s,0,0,-dpr*s,dpr*(W/2-view.cx*s),dpr*(H/2+view.cy*s)); }
function drawSheet(){
  const s=view.scale, sh=S();
  ctx.fillStyle=C.sheet; ctx.fillRect(sh.x0,sh.y0,sh.w,sh.h);
  ctx.lineWidth=1.2/s; ctx.strokeStyle=C.edge; if(!sh.declared) ctx.setLineDash([6/s,4/s]); ctx.strokeRect(sh.x0,sh.y0,sh.w,sh.h); ctx.setLineDash([]);
}
function crosshair(hx,hy,ring){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const sx=W/2+(hx-view.cx)*view.scale, sy=H/2-(hy-view.cy)*view.scale;
  ctx.strokeStyle=C.accent; ctx.lineWidth=1; ctx.beginPath();
  ctx.moveTo(sx-16,sy);ctx.lineTo(sx-5,sy);ctx.moveTo(sx+5,sy);ctx.lineTo(sx+16,sy);
  ctx.moveTo(sx,sy-16);ctx.lineTo(sx,sy-5);ctx.moveTo(sx,sy+5);ctx.lineTo(sx,sy+16); ctx.stroke();
  if(ring){ ctx.beginPath(); ctx.arc(sx,sy,10,0,Math.PI*2); ctx.stroke(); }
  return [sx,sy];
}
function punchHead(){ for(let k=st.i-1;k>=0;k--){ const e=M.events[k]; if(e.x!=null) return e; } return null; }
function drawPunch(){
  const s=view.scale, ev=M.events, n=st.i, k=M.k;
  ctx.fillStyle=C.clamp; M.meta.clamps.forEach(cx=>ctx.fillRect(cx-1.25*k,S().y0-1.5*k,2.5*k,1.9*k));
  ctx.fillStyle=C.hole;
  for(let j=0;j<n;j++){ const e=ev[j]; if(e.type!=='hit'||st.hidden.has(e.tool)) continue; const t=M.tools[e.tool]; if(t.shape==='COIN') continue;
    ctx.save(); ctx.translate(e.x,e.y); shapePath(t,e.ang,k); ctx.fill(); ctx.restore(); }
  ctx.lineWidth=1.1/s;
  for(let j=0;j<n;j++){ const e=ev[j]; if(e.type!=='hit'||st.hidden.has(e.tool)) continue; const t=M.tools[e.tool], col=C.tools[t.ci];
    ctx.save(); ctx.translate(e.x,e.y);
    if(t.shape==='COIN'){ ctx.fillStyle=col; ctx.beginPath(); ctx.arc(0,0,Math.max(0.045*k,2.2/s),0,Math.PI*2); ctx.fill(); }
    else if(st.o1){ shapePath(t,e.ang,k); ctx.strokeStyle=col; ctx.stroke(); }
    ctx.restore(); }
  if(st.o2){ ctx.lineWidth=1/s; ctx.strokeStyle=C.path; ctx.setLineDash([4/s,3/s]); ctx.beginPath(); let started=false;
    for(let j=0;j<n;j++){ const e=ev[j]; if(e.x==null) continue; if(!started){ctx.moveTo(e.x,e.y);started=true;} else ctx.lineTo(e.x,e.y); }
    ctx.stroke(); ctx.setLineDash([]); }
  const h=punchHead();
  if(h){ const t=h.tool&&M.tools[h.tool];
    if(t){ ctx.save(); ctx.translate(h.x,h.y); shapePath(t,h.type==='hit'?h.ang:(t.keyed==='INDEX'?0:t.keyed),k); ctx.lineWidth=2.2/s; ctx.strokeStyle=C.accent; ctx.stroke(); ctx.restore(); }
    crosshair(h.x,h.y,h.type==='hit'); }
}
function laserHead(){
  const ev=M.events, n=st.i;
  if(n<ev.length&&st.frac>0){ const p=pointAt(ev[n],st.frac); return {x:p[0],y:p[1],e:ev[n]}; }
  if(n>0){ const e=ev[n-1]; return {x:e.x1,y:e.y1,e}; }
  return ev.length?{x:ev[0].x0,y:ev[0].y0,e:null}:null;
}
function drawLaser(){
  const s=view.scale, ev=M.events, n=st.i, part=n<ev.length&&st.frac>0;
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(st.o2){ ctx.setLineDash([5/s,4/s]); ctx.lineWidth=1/s; ctx.strokeStyle=C.path; ctx.beginPath();
    for(let j=0;j<n;j++) if(ev[j].type==='rapid') segPath(ev[j],1);
    if(part&&ev[n].type==='rapid') segPath(ev[n],st.frac);
    ctx.stroke(); ctx.setLineDash([]); }
  ctx.lineWidth=Math.max(M.kerf,1.6/s);
  let cur=-1;
  const lim=part?n+1:n;
  for(let j=0;j<lim;j++){ const e=ev[j]; if(e.type!=='cut') continue;
    if(e.contour!==cur){ if(cur>=0) ctx.stroke(); cur=e.contour; ctx.strokeStyle=C.tools[cur%TV.length]; ctx.beginPath(); }
    segPath(e,j<n?1:st.frac); }
  if(cur>=0) ctx.stroke();
  if(st.o1){ ctx.lineWidth=1.4/s; ctx.strokeStyle=C.clamp;
    for(const c of M.contours){ if(c.ev>=lim) break; ctx.beginPath(); ctx.arc(c.x,c.y,3.2/s,0,Math.PI*2); ctx.stroke(); } }
  const h=laserHead();
  if(h){ const cutting=h.e&&h.e.type==='cut'&&(part||st.playing);
    const [sx,sy]=crosshair(h.x,h.y,false);
    if(cutting){ const g=ctx.createRadialGradient(sx,sy,0,sx,sy,14); g.addColorStop(0,'rgba(255,255,255,.95)'); g.addColorStop(.25,C.accent); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,sy,14,0,Math.PI*2); ctx.fill(); }
    else { ctx.strokeStyle=C.accent; ctx.beginPath(); ctx.arc(sx,sy,6,0,Math.PI*2); ctx.stroke(); } }
}
function draw(){
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillStyle=C.bed; ctx.fillRect(0,0,W,H);
  if(!M) return;
  drawGrid(); worldT(); drawSheet();
  if(M.kind==='punch') drawPunch(); else drawLaser();
}

/* ---------- status, side panel, listing ---------- */
const STAT={punch:['Block','Tool','X','Y','Angle','Mode','Hits'],laser:['Block','Motion','X','Y','Feed','Beam','Cut length']};
function buildStatus(){ $('#status').innerHTML=STAT[M.kind].map((l,i)=>`<div><div class="lbl">${l}${l==='X'||l==='Y'?' '+uL():''}</div><div class="v" id="s${i}">—</div></div>`).join(''); }
const setS=(i,v)=>{ const el=document.getElementById('s'+i); if(el) el.textContent=v; };
const nn=li=>{ const l=M.listing[li]||''; const m=l.match(/^N\d+/); return m?m[0]:'line '+(li+1); };
function curEvent(){ const ev=M.events; if(M.kind==='laser'&&st.i<ev.length&&st.frac>0) return ev[st.i]; return st.i>0?ev[st.i-1]:null; }
let lastLi=-2;
function updateStatus(){
  const e=curEvent();
  $('#scrub').value=st.i;
  if(M.kind==='punch'){
    const h=punchHead(), t=e&&e.tool?M.tools[e.tool]:null;
    setS(0,e?nn(e.li)+(e.pat?' (G79)':''):'start');
    setS(1,t?t.id+' '+(t.shape==='RECT'?'RE':t.shape==='ROUND'?'RO':t.shape==='SQUARE'?'SQ':t.shape==='OB'?'OB':'SP'):'—');
    setS(2,fN(h&&h.x)); setS(3,fN(h&&h.y));
    setS(4,e&&e.type==='hit'?(+e.ang).toFixed(2)+'°':'—');
    setS(5,!e?'—':e.type==='repo'?'Reposition':e.type==='move'?'Move (no hit)':e.mode==='COIN'?'Coin M546':'Punch M500');
    setS(6,M.cum[st.i]+' / '+M.total);
    let rep=0; for(let j=0;j<st.i;j++) if(M.events[j].type==='repo') rep++;
    $('#banner').textContent=e&&e.type==='repo'?'REPOSITION '+(e.d>0?'+':'')+e.d.toFixed(3)+' '+uL():(rep?'Reposition '+rep+' of '+M.repoCount:'');
    document.querySelectorAll('#sideBody tr').forEach(tr=>tr.classList.toggle('cur',!!(t&&tr.dataset.k===t.id)));
  } else {
    const h=laserHead();
    setS(0,e?nn(e.li):'start');
    setS(1,e?('G0'+e.g)+(e.arc?(e.g===2?' CW arc':' CCW arc'):e.g===0?' rapid':' line'):'—');
    setS(2,fN(h&&h.x)); setS(3,fN(h&&h.y));
    setS(4,e&&e.f!=null?e.f+' '+uL()+'/min':'—');
    setS(5,e?(e.type==='cut'?'On':'Off'):'—');
    const done=M.cumCut[st.i]+(st.i<M.events.length&&M.events[st.i].type==='cut'?M.events[st.i].len*st.frac:0);
    setS(6,done.toFixed(M.units==='mm'?0:2)+' / '+M.cutLen.toFixed(M.units==='mm'?0:2));
    const ci=e&&e.type==='cut'?e.contour:-1;
    $('#banner').textContent=ci>=0?'Contour '+(ci+1)+' of '+M.contours.length:'';
    document.querySelectorAll('#sideBody tr').forEach(tr=>tr.classList.toggle('cur',+tr.dataset.k===ci));
  }
  $('#bPlay').textContent=st.playing?'Pause':(st.i>=M.events.length?'Replay':'Play');
  const li=e?e.li:-1;
  if(li!==lastLi){ lastLi=li; const box=$('#listing'); const top=li*19; if(li>=0&&(top<box.scrollTop+19||top>box.scrollTop+box.clientHeight-38)) box.scrollTop=top-box.clientHeight/2; renderRows(); }
}
function renderSide(){
  const head=$('#sideHead'), body=$('#sideBody');
  if(M.kind==='punch'){
    $('#sideT').textContent='Tooling'; $('#sideH').textContent='click a row to show/hide its hits';
    head.innerHTML=`<tr><th>Tool</th><th>Shape</th><th>Size (${uL()})</th><th>Angle</th><th class="num">Hits</th><th>Show</th></tr>`;
    body.innerHTML=M.order.map(id=>{ const t=M.tools[id]; return `<tr data-k="${id}"><td class="mono"><span class="sw" style="background:${C.tools[t.ci]}"></span>${id}</td><td>${t.desc}</td><td class="mono">${esc(t.label)}</td><td class="mono">${t.keyed==='INDEX'?'Index':(+t.keyed).toFixed(0)+'° fixed'}</td><td class="num">${M.counts[id]||0}</td><td><input type="checkbox" aria-label="Show ${id}" ${st.hidden.has(id)?'':'checked'}></td></tr>`; }).join('');
    body.querySelectorAll('tr').forEach(tr=>{ const id=tr.dataset.k, cb=tr.querySelector('input');
      const set=v=>{ if(v) st.hidden.delete(id); else st.hidden.add(id); cb.checked=v; dirty=true; };
      cb.addEventListener('click',ev=>{ ev.stopPropagation(); set(cb.checked); });
      tr.addEventListener('click',()=>set(st.hidden.has(id))); });
  } else {
    $('#sideT').textContent='Contours'; $('#sideH').textContent='click a row to jump to it';
    head.innerHTML=`<tr><th>#</th><th>Starts</th><th class="num">Pierce X</th><th class="num">Pierce Y</th><th class="num">Length</th><th class="num">Time</th></tr>`;
    const max=600, rows=M.contours.slice(0,max);
    body.innerHTML=rows.map(c=>`<tr data-k="${c.id}"><td class="mono"><span class="sw" style="background:${C.tools[c.id%TV.length]}"></span>${c.id+1}</td><td class="mono">${esc(nn(c.li))}</td><td class="num">${fN(c.x)}</td><td class="num">${fN(c.y)}</td><td class="num">${c.len.toFixed(M.units==='mm'?1:3)}</td><td class="num">${c.t>0?fmtT(c.t):'—'}</td></tr>`).join('')+(M.contours.length>max?`<tr><td colspan="6">${M.contours.length-max} more contours not listed</td></tr>`:'');
    body.querySelectorAll('tr[data-k]').forEach(tr=>tr.addEventListener('click',()=>{ const c=M.contours[+tr.dataset.k]; st.playing=false; setI(c.end+1); const pad=Math.max(0.6*M.k,c.len/8); if(view.scale<W/(c.len||1)/4){ } view.cx=c.x; view.cy=c.y; dirty=true; }));
  }
}
const fmtT=min=>{ const s=Math.round(min*60); return s>=3600?Math.floor(s/3600)+'h '+String(Math.floor(s%3600/60)).padStart(2,'0')+'m':Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
function renderNotes(){
  const N=$('#notes'), it=[];
  if(M.kind==='punch'){
    const sh=S(), out=new Set();
    M.events.forEach(e=>{ if(e.type!=='hit') return; const b=bbox(M.tools[e.tool],e,M.k); if(b[0]<sh.x0-1e-3||b[1]<sh.y0-1e-3||b[2]>sh.x0+sh.w+1e-3||b[3]>sh.y0+sh.h+1e-3) out.add(nn(e.li)); });
    it.push(`<p>${M.total} hits across ${M.order.filter(id=>M.counts[id]).length} tools, ${M.repoCount} repositions (G27). Filled shapes show material removed; coloured outlines show each tool hit.</p>`);
    if(!sh.declared) it.push(`<p class="warn">No sheet size in the program header, so the sheet is drawn around the hits (dashed edge).</p>`);
    else if(out.size) it.push(`<p class="warn">Hits that cross the sheet edge: ${[...out].slice(0,30).join(', ')}.</p>`);
    else it.push(`<p>Every punch footprint stays inside the ${sh.w} × ${sh.h} ${uL()} sheet.</p>`);
    if(M.order.some(id=>M.tools[id].shape==='COIN')) it.push(`<p>The coining tool's shape isn't defined in the program, so its hits are drawn as dots at the hit centre.</p>`);
    if(M.order.some(id=>M.tools[id].kind==='?')) it.push(`<p class="warn">Some tools aren't in the program's tool list, so they're drawn as small circles.</p>`);
    it.push(`<p>Amada-style codes assumed: G70 positions without punching, G79 punches a line (I length, J angle, Q pitch), C sets the index angle counter-clockwise.</p>`);
  } else {
    it.push(`<p>${M.contours.length} contours (${M.contours.length} pierces). G00 is drawn as rapid travel and G01–G03 as cuts at ${(+$('#kerf').value||0).toFixed(2)} mm kerf. Beam on/off M-codes differ between machines, so every feed move counts as cutting.</p>`);
    if(!M.sheet.declared) it.push(`<p>No sheet size in the program header, so the dashed outline is the cut extent plus a margin.</p>`);
    if(M.comp) it.push(`<p class="warn">The program uses kerf compensation (G41/G42). The path is drawn on the programmed line, not the offset the control applies.</p>`);
    if(M.missing.length) it.push(`<p class="warn">Subprograms called but not found in the file: ${M.missing.join(', ')}.</p>`);
    if(M.hasSub&&!M.missing.length) it.push(`<p>Subprogram calls (M98/M99) are expanded in the simulation.</p>`);
    if(M.unknownG.length) it.push(`<p class="warn">Codes not simulated: ${M.unknownG.slice(0,20).join(', ')}.</p>`);
    if(M.noF) it.push(`<p>Some cuts have no programmed feed, so the time estimate covers only moves with an F value.</p>`);
    it.push(`<p>Arc centres use I/J incremental from the arc start, or R. Rapid time and pierce time are not included in the estimate.</p>`);
  }
  N.innerHTML=it.join('');
}
let firstEv={};
function buildListing(){
  firstEv={}; M.events.forEach((e,k)=>{ if(firstEv[e.li]===undefined) firstEv[e.li]=k; });
  $('#lsp').style.height=(M.listing.length*19)+'px'; $('#listing').scrollTop=0; lastLi=-2; renderRows();
  $('#progH').textContent=M.listing.length+' lines · click a block to jump to it';
}
function renderRows(){
  if(!M) return;
  const box=$('#listing'), sp=$('#lsp'), a=Math.max(0,Math.floor(box.scrollTop/19)-10), b=Math.min(M.listing.length,a+Math.ceil(box.clientHeight/19)+20);
  const cur=lastLi; let html='';
  for(let k=a;k<b;k++){ const l=M.listing[k];
    html+=`<div class="ln${k===cur?' on':''}${cur>=0&&k<cur?' done':''}" style="top:${k*19}px" tabindex="0" data-k="${k}"><span class="no">${k+1}</span><span class="tx">${esc(l).replace(/(\([^)]*\))/g,'<span class="cm">$1</span>')}</span></div>`; }
  sp.innerHTML=html;
}
$('#listing').addEventListener('scroll',renderRows,{passive:true});
function jumpLine(k){
  st.playing=false; let j=firstEv[k];
  if(j===undefined){ j=M.events.findIndex(e=>e.li>k); j=j<0?M.events.length:j; setI(j); }
  else { let end=j; while(end<M.events.length&&M.events[end].li===k) end++; setI(end); }
  const h=M.kind==='punch'?punchHead():laserHead(); if(h&&!visible(h.x,h.y)){ view.cx=h.x; view.cy=h.y; dirty=true; }
}
$('#lsp').addEventListener('click',e=>{ const r=e.target.closest('.ln'); if(r) jumpLine(+r.dataset.k); });
$('#lsp').addEventListener('keydown',e=>{ const r=e.target.closest('.ln'); if(r&&e.key==='Enter') jumpLine(+r.dataset.k); });
function visible(x,y){ const sx=W/2+(x-view.cx)*view.scale, sy=H/2-(y-view.cy)*view.scale; return sx>20&&sx<W-20&&sy>20&&sy<H-20; }
function renderHeader(fileName){
  const m=M.meta, sh=S(), U=uL();
  const raw=(m.name||fileName||'NC program').replace(/\.[a-z0-9]+$/i,'');
  const nm=raw.replace(/^\d+\s*-\s*/,'').replace(/\s*-\s*\d+$/,'');
  $('#partname').textContent=/[a-z]/.test(nm)?nm:nm.replace(/\b([A-Z])([A-Z]+)\b/g,(a,b,c)=>b+c.toLowerCase()).replace(/\b(Lh|Rh)\b/g,s=>s.toUpperCase());
  $('#eyebrow').textContent=[M.kind==='punch'?'Punch / turret':'Laser / plasma',m.prog,(raw.match(/^(\d+)/)||[])[1],m.date].filter(Boolean).join(' · ');
  const L=v=>v.toFixed(M.units==='mm'?0:2)+' '+U;
  const chips=M.kind==='punch'
    ?[['Sheet',sh.declared?sh.w+' × '+sh.h+' '+U:'not given'],['Thickness',m.thick!=null?m.thick+' '+U:'—'],['Material',m.material||'—'],['Tools',M.order.length],['Hits',M.total],['Repositions',M.repoCount]]
    :[['Sheet',sh.declared?sh.w+' × '+sh.h+' '+U:'not given'],['Thickness',m.thick!=null?m.thick+' '+U:'—'],['Material',m.material||'—'],['Contours',M.contours.length],['Cut',L(M.cutLen)],['Rapid',L(M.rapidLen)],['Est. cut time',M.tmin>0?fmtT(M.tmin):'—']];
  $('#chips').innerHTML=chips.map(([k,v])=>`<span class="chip">${k} <b>${esc(v)}</b></span>`).join('');
  $('#o1l').textContent=M.kind==='punch'?'Hit outlines':'Pierce points';
  $('#o2l').textContent=M.kind==='punch'?'Travel path':'Rapid moves';
}

/* ---------- load ---------- */
let curName='';
function msg(kind,html){ const el=$('#msg'); el.className=kind; el.innerHTML=html; }
function load(text,fileName,forceKind,forceUnits,keepView){
  const choice=$('#kind').value, kind=forceKind||(choice==='auto'?detect(text):choice);
  const opt={units:forceUnits||$('#units').value,kerfMM:parseFloat($('#kerf').value)||0};
  let m;
  try{ m=kind==='punch'?parsePunch(text,opt):parseLaser(text,opt); }
  catch(err){ msg('err',`<span class="pill">Not loaded</span> Couldn't simulate ${esc(fileName||'this program')} as ${kind==='punch'?'punch / turret':'laser'}: ${esc(err.message)}. Check the machine type, or that the file is plain-text G-code.`); return false; }
  const prevM=M; M=m; curName=fileName||''; if(keepView&&!(prevM&&prevM.units===M.units&&prevM.kind===M.kind)) keepView=false;
  st.hidden.clear(); st.playing=false; st.frac=0; st.o2=M.kind==='laser'; $('#o2').checked=st.o2; st.o1=true; $('#o1').checked=true;
  $('#scrub').max=M.events.length;
  const lines=M.listing.length;
  const what=M.kind==='punch'?`${M.total} hits, ${M.order.length} tools`:`${M.contours.length} contours, ${M.events.length} moves`;
  msg('ok',`<span class="pill">${choice==='auto'?'Detected':'Set'}: ${M.kind==='punch'?'Punch / turret':'Laser'}</span> ${esc(fileName||'Pasted program')} · ${lines} lines · ${what} · units ${M.units==='mm'?'mm':'inch'}`);
  buildStatus(); renderHeader(fileName); renderSide(); renderNotes(); buildListing();
  resize(); if(!keepView) vFit(); setI(M.events.length);
  return true;
}
function setI(i){ st.i=Math.max(0,Math.min(M.events.length,i)); st.frac=0; dirty=true; updateStatus(); }

/* ===== DXF CORE ===== */
const TAU=Math.PI*2;
function dxfIsText(t){ const h=t.slice(0,3000); return /^\s*0\s*\r?\n\s*SECTION\s*\r?\n/i.test(h)||(/(^|\n)\s*0\s*\r?\n\s*SECTION\s*\r?\n/i.test(h)&&/\n\s*2\s*\r?\n\s*(HEADER|ENTITIES|TABLES|BLOCKS)\s*\r?\n/i.test(h)); }
function gv(r,c){ const p=r.g.find(p=>p[0]===c); return p?p[1]:undefined; }
function gn(r,c,d=0){ const v=gv(r,c); const n=v===undefined?NaN:parseFloat(v); return isNaN(n)?d:n; }
function groupPoly(list){ const out=[]; for(let i=0;i<list.length;i++){ const r=list[i];
  if(r.type==='POLYLINE'){ r.verts=[]; while(i+1<list.length&&list[i+1].type==='VERTEX') r.verts.push(list[++i]); if(i+1<list.length&&list[i+1].type==='SEQEND') i++; out.push(r); }
  else if(r.type!=='VERTEX'&&r.type!=='SEQEND') out.push(r); } return out; }
function parseDXF(text){
  if(/^AutoCAD Binary DXF/.test(text)) throw new Error('it is a binary DXF. Save it from your CAD software as an ASCII DXF');
  const L=text.split(/\r?\n/), recs=[]; let cur=null;
  for(let i=0;i+1<L.length;i+=2){ const c=parseInt(L[i],10), v=L[i+1].trim(); if(isNaN(c)) continue;
    if(c===0){ cur={type:v.toUpperCase(),g:[]}; recs.push(cur); } else if(cur) cur.g.push([c,v]); }
  if(!recs.length) throw new Error('no DXF sections were found');
  let sec=null, blk=null, insunits=0; const blocks={}, ents=[];
  for(const r of recs){
    if(r.type==='SECTION'){ sec=(gv(r,2)||'').toUpperCase();
      if(sec==='HEADER'){ const g=r.g; for(let j=0;j<g.length-1;j++) if(g[j][0]===9&&g[j][1].toUpperCase()==='$INSUNITS') insunits=parseInt(g[j+1][1],10)||0; } continue; }
    if(r.type==='ENDSEC'){ sec=null; continue; }
    if(sec==='BLOCKS'){ if(r.type==='BLOCK'){ blk={name:gv(r,2),bx:gn(r,10),by:gn(r,20),ents:[]}; blocks[blk.name]=blk; } else if(r.type==='ENDBLK') blk=null; else if(blk) blk.ents.push(r); }
    else if(sec==='ENTITIES') ents.push(r);
  }
  for(const b of Object.values(blocks)) b.ents=groupPoly(b.ents);
  return {ents:groupPoly(ents),blocks,insunits};
}
const mMul=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];
const mI=[1,0,0,1,0,0];
const mT=(x,y)=>[1,0,0,1,x,y], mS=(sx,sy)=>[sx,0,0,sy,0,0], mR=a=>[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const mP=(M,x,y)=>[M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5]];
function xfSeg(s,M,out){
  if(s.t==='L'){ const a=mP(M,s.x0,s.y0), b=mP(M,s.x1,s.y1); out.push({t:'L',x0:a[0],y0:a[1],x1:b[0],y1:b[1],layer:s.layer}); return; }
  const n1=M[0]*M[0]+M[1]*M[1], n2=M[2]*M[2]+M[3]*M[3], dot=M[0]*M[2]+M[1]*M[3], e=1e-9*Math.max(n1,1);
  if(Math.abs(n1-n2)<e&&Math.abs(dot)<e){
    const sc=Math.sqrt(n1), det=M[0]*M[3]-M[1]*M[2], c=mP(M,s.cx,s.cy), dx=Math.cos(s.a0), dy=Math.sin(s.a0);
    out.push({t:'A',cx:c[0],cy:c[1],r:s.r*sc,a0:Math.atan2(M[1]*dx+M[3]*dy,M[0]*dx+M[2]*dy),sw:s.sw*Math.sign(det),layer:s.layer,full:s.full}); return; }
  const n=Math.max(8,Math.ceil(Math.abs(s.sw)/(Math.PI/36)));
  let p=mP(M,s.cx+s.r*Math.cos(s.a0),s.cy+s.r*Math.sin(s.a0));
  for(let k=1;k<=n;k++){ const a=s.a0+s.sw*k/n, q=mP(M,s.cx+s.r*Math.cos(a),s.cy+s.r*Math.sin(a)); out.push({t:'L',x0:p[0],y0:p[1],x1:q[0],y1:q[1],layer:s.layer}); p=q; }
}
function bulgeSeg(p,q,b){
  if(Math.abs(b)<1e-12) return {t:'L',x0:p.x,y0:p.y,x1:q.x,y1:q.y};
  const sw=4*Math.atan(b), dx=q.x-p.x, dy=q.y-p.y, c=Math.hypot(dx,dy); if(c<1e-12) return null;
  const d=(c/2)/Math.tan(sw/2), cx=(p.x+q.x)/2-dy/c*d, cy=(p.y+q.y)/2+dx/c*d;
  return {t:'A',cx,cy,r:Math.hypot(p.x-cx,p.y-cy),a0:Math.atan2(p.y-cy,p.x-cx),sw};
}
function deBoor(p,P,U,u){ let k=p; while(k<P.length-1&&u>=U[k+1]) k++;
  const d=[]; for(let j=0;j<=p;j++){ const q=P[j+k-p]; d.push({x:q.x,y:q.y}); }
  for(let r=1;r<=p;r++) for(let j=p;j>=r;j--){ const i=j+k-p, den=U[i+p-r+1]-U[i], a=den?(u-U[i])/den:0; d[j]={x:(1-a)*d[j-1].x+a*d[j].x,y:(1-a)*d[j-1].y+a*d[j].y}; }
  return d[p]; }
function polySegs(pts,closed,loc){ for(let k=1;k<pts.length;k++) loc.push({t:'L',x0:pts[k-1].x,y0:pts[k-1].y,x1:pts[k].x,y1:pts[k].y}); if(closed&&pts.length>2){ const a=pts[pts.length-1],b=pts[0]; loc.push({t:'L',x0:a.x,y0:a.y,x1:b.x,y1:b.y}); } }
function entSegs(r,dx,C,M,depth,parentLayer){
  if(gn(r,67)===1) return;
  let layer=gv(r,8)||'0'; if(layer==='0'&&parentLayer) layer=parentLayer;
  const T=r.type, ez=gn(r,230,1), Mo=ez<0?mMul(M,mS(-1,1)):M, loc=[]; let useM=M;
  if(T==='LINE') loc.push({t:'L',x0:gn(r,10),y0:gn(r,20),x1:gn(r,11),y1:gn(r,21)});
  else if(T==='CIRCLE'){ loc.push({t:'A',cx:gn(r,10),cy:gn(r,20),r:gn(r,40),a0:0,sw:TAU,full:true}); useM=Mo; }
  else if(T==='ARC'){ const a0=gn(r,50)*Math.PI/180, a1=gn(r,51)*Math.PI/180; let sw=a1-a0; while(sw<=1e-12) sw+=TAU; loc.push({t:'A',cx:gn(r,10),cy:gn(r,20),r:gn(r,40),a0,sw}); useM=Mo; }
  else if(T==='LWPOLYLINE'||T==='POLYLINE'){
    const vs=[], fl=gn(r,70);
    if(T==='LWPOLYLINE'){ for(const [c,v] of r.g){ if(c===10) vs.push({x:+v,y:0,b:0}); else if(c===20&&vs.length) vs[vs.length-1].y=+v; else if(c===42&&vs.length) vs[vs.length-1].b=+v; } useM=Mo; }
    else { if(fl&(16|64)){ C.skipped['3D MESH']=(C.skipped['3D MESH']||0)+1; return; } for(const vr of r.verts||[]){ if(gn(vr,70)&16) continue; vs.push({x:gn(vr,10),y:gn(vr,20),b:gn(vr,42)}); } if(!(fl&8)) useM=Mo; }
    const n=vs.length, closed=fl&1;
    for(let k=0;k<(closed?n:n-1);k++){ const s=bulgeSeg(vs[k],vs[(k+1)%n],vs[k].b); if(s) loc.push(s); }
  }
  else if(T==='ELLIPSE'){ const cx=gn(r,10),cy=gn(r,20),mx=gn(r,11),my=gn(r,21),ra=gn(r,40,1); let t0=gn(r,41),t1=gn(r,42,TAU); if(t1<=t0) t1+=TAU;
    const nx=ez<0?my*ra:-my*ra, ny=ez<0?-mx*ra:mx*ra, n=Math.max(16,Math.ceil((t1-t0)/(TAU/96))), pts=[];
    for(let k=0;k<=n;k++){ const t=t0+(t1-t0)*k/n; pts.push({x:cx+mx*Math.cos(t)+nx*Math.sin(t),y:cy+my*Math.cos(t)+ny*Math.sin(t)}); }
    polySegs(pts,false,loc); }
  else if(T==='SPLINE'){ const deg=gn(r,71,3), knots=[], cp=[], fp=[];
    for(const [c,v] of r.g){ if(c===40) knots.push(+v); else if(c===10) cp.push({x:+v,y:0}); else if(c===20&&cp.length) cp[cp.length-1].y=+v; else if(c===11) fp.push({x:+v,y:0}); else if(c===21&&fp.length) fp[fp.length-1].y=+v; }
    let pts=[];
    if(cp.length>deg&&knots.length===cp.length+deg+1){ const n=Math.max(32,cp.length*12), u0=knots[deg], u1=knots[cp.length]; for(let k=0;k<=n;k++) pts.push(deBoor(deg,cp,knots,u0+(u1-u0)*k/n)); }
    else pts=fp.length?fp:cp;
    const closed=(gn(r,70)&1)&&pts.length>2&&Math.hypot(pts[0].x-pts[pts.length-1].x,pts[0].y-pts[pts.length-1].y)>1e-9;
    polySegs(pts,closed,loc); }
  else if(T==='INSERT'){ if(depth>8) return; const b=dx.blocks[gv(r,2)]; if(!b) return;
    const sx=gn(r,41,1), sy=gn(r,42,1), rot=gn(r,50)*Math.PI/180, ix=gn(r,10), iy=gn(r,20), cols=Math.max(1,gn(r,70,1)), rows=Math.max(1,gn(r,71,1)), cs=gn(r,44), rs=gn(r,45);
    for(let ci=0;ci<cols;ci++) for(let ri=0;ri<rows;ri++){
      const Mi=mMul(Mo,mMul(mT(ix,iy),mMul(mR(rot),mMul(mT(ci*cs,ri*rs),mMul(mS(sx,sy),mT(-b.bx,-b.by))))));
      for(const e of b.ents) entSegs(e,dx,C,Mi,depth+1,layer); }
    return; }
  else { C.skipped[T]=(C.skipped[T]||0)+1; return; }
  for(const s of loc){ s.layer=layer; xfSeg(s,useM,C.segs); }
}
const sp=s=>s.t==='L'?[s.x0,s.y0]:s.sx!==undefined?[s.sx,s.sy]:[s.cx+s.r*Math.cos(s.a0),s.cy+s.r*Math.sin(s.a0)];
const ep=s=>s.t==='L'?[s.x1,s.y1]:s.ex!==undefined?[s.ex,s.ey]:[s.cx+s.r*Math.cos(s.a0+s.sw),s.cy+s.r*Math.sin(s.a0+s.sw)];
const rev=s=>s.t==='L'?{...s,x0:s.x1,y0:s.y1,x1:s.x0,y1:s.y0}:{t:'A',cx:s.cx,cy:s.cy,r:s.r,a0:s.a0+s.sw,sw:-s.sw,layer:s.layer};
const slen=s=>s.t==='L'?Math.hypot(s.x1-s.x0,s.y1-s.y0):Math.abs(s.sw)*s.r;
const midPt=s=>s.t==='L'?[(s.x0+s.x1)/2,(s.y0+s.y1)/2]:[s.cx+s.r*Math.cos(s.a0+s.sw/2),s.cy+s.r*Math.sin(s.a0+s.sw/2)];
const tangent=s=>{ if(s.t==='L'){ const l=slen(s)||1; return [(s.x1-s.x0)/l,(s.y1-s.y0)/l]; } const g=s.sw>0?1:-1; return [-Math.sin(s.a0)*g,Math.cos(s.a0)*g]; };
function segPts(s,pts,tol){ if(s.t==='L'){ pts.push([s.x1,s.y1]); return; }
  const step=2*Math.acos(Math.max(-1,1-tol/Math.max(s.r,1e-9))), n=Math.max(4,Math.min(720,Math.ceil(Math.abs(s.sw)/Math.max(0.01,step))));
  for(let k=1;k<=n;k++){ const a=s.a0+s.sw*k/n; pts.push([s.cx+s.r*Math.cos(a),s.cy+s.r*Math.sin(a)]); } }
function chain(segs,tol){
  const out=[], used=new Array(segs.length).fill(false), cell=tol*2, grid=new Map();
  const key=(x,y)=>Math.round(x/cell)+','+Math.round(y/cell);
  const add=(x,y,i,e)=>{ const k=key(x,y); let L=grid.get(k); if(!L){ L=[]; grid.set(k,L); } L.push({i,e,x,y}); };
  segs.forEach((s,i)=>{ if(s.t==='A'&&Math.abs(s.sw)>=TAU-1e-9){ used[i]=true; out.push({segs:[s],closed:true}); return; } const a=sp(s), b=ep(s); add(a[0],a[1],i,0); add(b[0],b[1],i,1); });
  const find=(x,y)=>{ const cx=Math.round(x/cell), cy=Math.round(y/cell); let best=null, bd=tol;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){ const L=grid.get((cx+dx)+','+(cy+dy)); if(!L) continue; for(const p of L){ if(used[p.i]) continue; const d=Math.hypot(p.x-x,p.y-y); if(d<=bd){ bd=d; best=p; } } }
    return best; };
  for(let i=0;i<segs.length;i++){ if(used[i]) continue; used[i]=true; const list=[segs[i]];
    for(;;){ const e=ep(list[list.length-1]), p=find(e[0],e[1]); if(!p) break; used[p.i]=true; list.push(p.e===0?segs[p.i]:rev(segs[p.i])); }
    for(;;){ const s0=sp(list[0]), p=find(s0[0],s0[1]); if(!p) break; used[p.i]=true; list.unshift(p.e===1?segs[p.i]:rev(segs[p.i])); }
    const a=sp(list[0]), b=ep(list[list.length-1]);
    out.push({segs:list,closed:Math.hypot(a[0]-b[0],a[1]-b[1])<=tol&&list.reduce((t,s)=>t+slen(s),0)>tol*4}); }
  return out;
}
function pip(p,poly){ let ins=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j]; if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])) ins=!ins; } return ins; }
function contourInfo(c,tol){ const pts=[sp(c.segs[0])]; c.segs.forEach(s=>segPts(s,pts,tol)); let A=0,x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=0;i<pts.length;i++){ const p=pts[i]; x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); if(i) A+=pts[i-1][0]*p[1]-p[0]*pts[i-1][1]; }
  c.pts=pts; c.area=A/2; c.bx0=x0; c.by0=y0; c.bx1=x1; c.by1=y1; c.bw=x1-x0; c.bh=y1-y0; c.len=c.segs.reduce((t,s)=>t+slen(s),0); }
const UNIT_MM={in:25.4,ft:304.8,mm:1,cm:10,m:1000};
function dxfSegsAll(dx){ const C={segs:[],skipped:{}}; for(const e of dx.ents) entSegs(e,dx,C,mI,0,null); return C; }
function buildModel(dx,o){ // o: {off:Set, src:'in'|'mm'|..., out:'in'|'mm', margin}
  const C=dxfSegsAll(dx), k=UNIT_MM[o.src]/UNIT_MM[o.out];
  const segs=C.segs.filter(s=>!o.off.has(s.layer));
  if(!segs.length) throw new Error('no cuttable geometry is left on the selected layers');
  const tol=o.out==='mm'?0.025:0.001;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; const pts=[];
  for(const s of segs){ pts.length=0; pts.push(sp(s)); segPts(s,pts,tol/k); for(const p of pts){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); } }
  const M=mMul(mT(o.margin-x0*k,o.margin-y0*k),mS(k,k)), t2=[];
  segs.forEach(s=>xfSeg(s,M,t2));
  const chains=chain(t2.filter(s=>slen(s)>tol*0.05),tol), closed=[], open=[];
  for(const c of chains){ contourInfo(c,tol); (c.closed?closed:open).push(c); }
  closed.sort((a,b)=>Math.abs(b.area)-Math.abs(a.area));
  for(let i=0;i<closed.length;i++){ const c=closed[i], p=midPt(c.segs[0]); let d=0;
    for(let j=0;j<i;j++){ const q=closed[j]; if(p[0]<q.bx0||p[0]>q.bx1||p[1]<q.by0||p[1]>q.by1) continue; if(pip(p,q.pts)) d++; }
    c.depth=d; c.hole=d%2===1; }
  return {closed,open,partW:(x1-x0)*k,partH:(y1-y0)*k,skipped:C.skipped,units:o.out,tol,segCount:segs.length};
}
function orient(c,wantCCW){ if((c.area>0)!==wantCCW){ c.segs=c.segs.slice().reverse().map(rev); c.area=-c.area; c.pts=c.pts.slice().reverse(); } }
function startAtLongest(c){ let bi=-1,bl=0; c.segs.forEach((s,i)=>{ if(s.t==='L'){ const l=slen(s); if(l>bl){ bl=l; bi=i; } } });
  if(bi<0) return; const s=c.segs[bi], m=midPt(s);
  const h1={...s,x1:m[0],y1:m[1]}, h2={...s,x0:m[0],y0:m[1]};
  c.segs=[h2,...c.segs.slice(bi+1),...c.segs.slice(0,bi),h1]; }
function fmtN(v,u){ let s=(+v).toFixed(u==='mm'?3:4).replace(/(\.\d*?)0+$/,'$1'); if(s==='-0.') s='0.'; return s; }
function ncHeader(o,m,extra){ const L=[];
  L.push(`O${String(o.num).padStart(4,'0')}(${o.name})`);
  L.push(`(${o.date})`);
  return L; }
/* ---- laser job building, ordering and output (shared by DXF conversion and NC optimizer) ---- */
function trimEnd(segs,gap){ if(!(gap>0)) return segs; const out=segs.slice(); let rem=gap;
  while(out.length&&rem>1e-9){ const s=out[out.length-1], l=slen(s); if(l<=rem+1e-9){ out.pop(); rem-=l; continue; }
    const f=(l-rem)/l; out[out.length-1]=s.t==='L'?{...s,x1:s.x0+(s.x1-s.x0)*f,y1:s.y0+(s.y1-s.y0)*f}:{...s,sw:s.sw*f,ex:undefined,ey:undefined}; rem=0; }
  return out; }
function endTangent(s){ if(s.t==='L') return tangent(s); const a=s.a0+s.sw, g=s.sw>0?1:-1; return [-Math.sin(a)*g,Math.cos(a)*g]; }
function jobPoly(j){ if(j.poly) return j.poly; const pts=[sp(j.segs[0])]; j.segs.forEach(s=>segPts(s,pts,j.tol||0.01)); let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for(const p of pts){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); } j.poly=pts; j.bb=[x0,y0,x1,y1]; j.area=(x1-x0)*(y1-y0); return pts; }
/* Order: inside each part, every contour is cut before the contour that contains it (holes and text before the perimeter);
   parts are visited nearest first. Greedy nearest-neighbour, then 2-opt improvement that keeps that rule. */
const jEnd=j=>ep(j.segs[j.segs.length-1]);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function seqCost(seq,start){ let c=0, cur=start; for(const j of seq){ c+=dist(cur,j.pierce); cur=jEnd(j); } return c; }
function orderJobs(jobs,start){
  start=start||[0,0]; jobs.forEach(jobPoly);
  const byArea=jobs.slice().sort((a,b)=>b.area-a.area);
  for(const j of jobs){ const p=j.sample; let top=j, par=null;
    for(const k of byArea){ if(k===j||k.area<=j.area) continue; const b=k.bb; if(p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3]) continue;
      if(pip(p,k.poly)){ if(top===j||k.area>top.area) top=k; if(!par||k.area<par.area) par=k; } }
    j.top=top; j.parent=par; }
  const groups=new Map(); for(const j of jobs){ if(!groups.has(j.top)) groups.set(j.top,[]); groups.get(j.top).push(j); }
  let cur=start; const out=[], left=[...groups.keys()];
  while(left.length){ let bi=0,bd=Infinity;
    left.forEach((t,i)=>{ const dd=Math.min(...groups.get(t).map(m=>dist(m.pierce,cur))); if(dd<bd){ bd=dd; bi=i; } });
    const top=left.splice(bi,1)[0], mem=groups.get(top);
    const kids=new Map(mem.map(m=>[m,0])); mem.forEach(m=>{ if(m.parent&&kids.has(m.parent)) kids.set(m.parent,kids.get(m.parent)+1); });
    const todo=new Set(mem), seq=[], s0=cur;
    while(todo.size){ let best=null,bdd=Infinity; for(const m of todo){ if(kids.get(m)>0) continue; const x=dist(m.pierce,cur); if(x<bdd){ bdd=x; best=m; } }
      if(!best) best=todo.values().next().value;
      todo.delete(best); seq.push(best); cur=jEnd(best); if(best.parent&&kids.has(best.parent)) kids.set(best.parent,kids.get(best.parent)-1); }
    const imp=twoOpt(seq,s0); out.push(...imp); cur=jEnd(imp[imp.length-1]); }
  return out; }
function twoOpt(seq,start){
  const n=seq.length; if(n<4||n>600) return seq;
  let s=seq.slice(), best=seqCost(s,start), pass=0, improved=true;
  const valid=(a,i,k)=>{ const pos=new Map(); for(let q=i;q<=k;q++) pos.set(a[q],q); for(let q=i;q<=k;q++){ const p=a[q].parent; if(p&&pos.has(p)&&pos.get(p)>q) return false; } return true; };
  const t0=Date.now();
  while(improved&&pass<8&&Date.now()-t0<1500){ improved=false; pass++;
    for(let i=0;i<n-1;i++){ for(let k=i+1;k<n;k++){
      const prev=i===0?start:jEnd(s[i-1]), nxt=k+1<n?s[k+1]:null;
      const oldC=dist(prev,s[i].pierce)+(nxt?dist(jEnd(s[k]),nxt.pierce):0), newC=dist(prev,s[k].pierce)+(nxt?dist(jEnd(s[i]),nxt.pierce):0);
      if(newC>=oldC-1e-6) continue;
      if(!valid(s,i,k)) continue;
      const c=s.slice(0,i).concat(s.slice(i,k+1).reverse(),s.slice(k+1)), cc=seqCost(c,start);
      if(cc<best-1e-6){ s=c; best=cc; improved=true; } } } }
  return s; }
function rapidLen(jobs,start){ return seqCost(jobs,start||[0,0]); }
/* st: {inc, compact, nums, dXY, dIJ, numStyle:'trim0'|'dot', before:[lines], after:[lines], feed, pre:[], post:[], comments} */
function emitLaser(jobs,st){
  const out=[]; let N=st.startN||10; const put=s=>{ out.push(st.nums?'N'+N+' '+s:s); N+=10; };
  const sep=st.compact?'':' ';
  const F=(v,d)=>{ let s=(+v).toFixed(d); if(/^-0\.?0*$/.test(s)) s=s.slice(1); if(s.includes('.')) s=s.replace(/0+$/,''); if(s.endsWith('.')&&st.numStyle!=='dot') s+='0'; return s; };
  const R=(v,d)=>Math.round(v*10**d)/10**d;
  let cx=0, cy=0, lastF=null;
  for(const l of st.pre) out.push(l);
  const mv=(g,x,y,tail)=>{ const X=R(x,st.dXY), Y=R(y,st.dXY), vx=st.inc?R(X-cx,st.dXY):X, vy=st.inc?R(Y-cy,st.dXY):Y; const s=g+sep+'X'+F(vx,st.dXY)+sep+'Y'+F(vy,st.dXY)+(tail||''); cx=X; cy=Y; return s; };
  jobs.forEach((j,k)=>{
    if(st.comments&&j.label) out.push(`(CONTOUR ${k+1} - ${j.label})`);
    put(mv('G00',j.pierce[0],j.pierce[1]));
    for(const l of st.before) put(l);
    let first=true;
    for(const s of j.segs){ const e=ep(s); let tail='';
      if(s.t==='A'){ const I=R(s.cx-cx,st.dIJ), J=R(s.cy-cy,st.dIJ);
        if(st.compact){ if(I!==0||J===0) tail+='I'+F(I,st.dIJ); if(J!==0) tail+='J'+F(J,st.dIJ); }
        else tail+=' I'+F(I,st.dIJ)+' J'+F(J,st.dIJ); }
      const f=st.feed!=null?(typeof st.feed==='function'?st.feed(j):st.feed):null;
      if(first&&f!=null&&f!==lastF){ tail+=sep+'F'+f; lastF=f; }
      first=false;
      put(mv(s.t==='L'?'G01':(s.sw<0?'G02':'G03'),e[0],e[1],tail)); }
    for(const l of st.after) put(l); });
  for(const l of st.post){ if(typeof l==='object') put(mv('G00',l.x,l.y)); else out.push(st.nums&&!/^[%(O]/.test(l)?'N'+(N+=10,N-10)+' '+l:l); }
  return out.join('\n'); }
/* DXF → laser jobs with per-type leads and end gap */
function dxfLaserJobs(m,o){
  const jobs=[]; let fb=0, ogap=0;
  for(const c of m.closed){ orient(c,c.hole); startAtLongest(c);
    const H=c.hole, Lin=Math.max(0,H?o.leadH:o.leadP), Ain=H?o.angH:o.angP, Lo=Math.max(0,H?o.outH:o.outP), Ao=H?o.oangH:o.oangP, gap=Math.max(0,H?o.gapH:o.gapP);
    const s0=c.segs[0], S=sp(s0), tg=tangent(s0), cap=H?0.45*Math.min(c.bw,c.bh):Infinity;
    let lead=Math.min(Lin,cap), ang=Ain;
    if(lead>0&&ang===0){ if(s0.t!=='L'){ ang=90; fb++; } else lead=Math.min(lead,slen(c.segs[c.segs.length-1])*0.9); }
    const P=lead<=0?S:ang===0?[S[0]-tg[0]*lead,S[1]-tg[1]*lead]:[S[0]-tg[1]*lead,S[1]+tg[0]*lead];
    const segs=[]; if(lead>0) segs.push({t:'L',x0:P[0],y0:P[1],x1:S[0],y1:S[1]});
    const body=trimEnd(c.segs,Math.min(gap,c.len*0.5)); segs.push(...body);
    const lo=Math.min(Lo,cap);
    if(lo>0){ const last=body[body.length-1], E=ep(last);
      if(Ao===0){ if(gap>0) ogap++; else { let rem=lo; for(const s of c.segs){ if(rem<=1e-9) break; const l=slen(s), f=Math.min(1,rem/l); segs.push(s.t==='L'?{...s,x1:s.x0+(s.x1-s.x0)*f,y1:s.y0+(s.y1-s.y0)*f}:{...s,sw:s.sw*f,ex:undefined,ey:undefined}); rem-=l*f; } } }
      else { const t=endTangent(last); segs.push({t:'L',x0:E[0],y0:E[1],x1:E[0]-t[1]*lo,y1:E[1]+t[0]*lo}); } }
    jobs.push({segs,pierce:P,sample:midPt(body[0]||s0),label:H?'HOLE':'PROFILE',tol:m.tol}); }
  if(o.open) for(const c of m.open) jobs.push({segs:c.segs,pierce:sp(c.segs[0]),sample:midPt(c.segs[0]),label:'OPEN',tol:m.tol});
  return {jobs,fb,ogap}; }
function genLaser(m,o){
  const {jobs,fb,ogap}=dxfLaserJobs(m,o);
  const ord=o.opt?orderJobs(jobs,[0,0]):jobs;
  const F=v=>fmtN(v,m.units), U=m.units==='mm'?'MM':'INCH', shop=o.style==='shop';
  const cmt=[`(${o.name})`,`(${o.date})`,`(FROM DXF: ${o.file})`,`(SHEET DIM: ${F(o.sheetW)} ${F(o.sheetH)})`,`(THICKNESS: ${F(o.thick)})`,`(MATERIAL: ${o.mat})`,`(UNITS: ${U})`,
    `(LEADS HOLE: IN ${F(o.leadH)} AT ${o.angH} / OUT ${F(o.outH)} AT ${o.oangH} / GAP ${F(o.gapH)})`,`(LEADS PROFILE: IN ${F(o.leadP)} AT ${o.angP} / OUT ${F(o.outP)} AT ${o.oangP} / GAP ${F(o.gapP)})`,`(CONTOURS: ${ord.length})`];
  const before=[], after=[]; if(o.comp) before.push(o.comp); if(o.on) before.push(o.on); if(o.dwell>0) before.push(shop?`G04X${o.dwell}`:`G04 X${o.dwell}`);
  if(o.off) after.push(o.off); if(o.comp) after.push('G40');
  const st=shop
    ?{inc:true,compact:true,nums:false,dXY:m.units==='mm'?2:4,dIJ:m.units==='mm'?3:4,numStyle:'trim0',before,after,feed:null,comments:o.comments,
      pre:[...(o.comments?cmt:[]),'G92 X0. Y0.',m.units==='mm'?'G21':'G20','G91'],post:['M02']}
    :{inc:false,compact:false,nums:true,dXY:m.units==='mm'?3:4,dIJ:m.units==='mm'?3:4,numStyle:'dot',before,after,feed:o.feed,comments:true,startN:30,
      pre:['%',`O${String(o.num).padStart(4,'0')}(${o.name})`,...cmt.slice(1),`N10 ${m.units==='mm'?'G21':'G20'} G90`,'N20 G92 X0. Y0.'],post:[{x:0,y:0},'M30','%']};
  const text=emitLaser(ord,st);
  const warn=[];
  if(fb) warn.push(`${fb} round contour${fb>1?'s use':' uses'} a 90° lead-in, because a 0° lead-in on an arc would start in the part.`);
  if(ogap) warn.push(`${ogap} contour${ogap>1?'s':''} with an end gap skipped the 0° lead-out, since overlapping would cut through the tab.`);
  if(m.open.length&&!o.open) warn.push(`${m.open.length} open contour${m.open.length>1?'s were':' was'} not cut. Turn on “Cut open contours” to include ${m.open.length>1?'them':'it'}.`);
  const nh=ord.filter(j=>j.label==='HOLE').length, np=ord.filter(j=>j.label==='PROFILE').length, no=ord.filter(j=>j.label==='OPEN').length;
  return {text,summary:`${ord.length} contours (${nh} holes, ${np} profile${np===1?'':'s'}${no?', '+no+' open':''})${o.opt?', optimized order':''}`,warn,rapid:rapidLen(ord)};
}
/* Re-sequence an existing laser NC program in its own format */
function ncStyle(M){
  const L=M.listing, first=M.contours[0]; if(!first) throw new Error('no cut contours were found');
  let ri=-1; for(let i=first.ev-1;i>=0;i--){ if(M.events[i].type==='rapid'){ ri=i; break; } }
  const rapidLi=ri>=0?M.events[ri].li:first.li, cutLi=M.events[first.ev].li, endLi=M.events[first.end].li;
  let nextLi=L.length; for(let i=first.end+1;i<M.events.length;i++){ if(M.events[i].type==='rapid'){ nextLi=M.events[i].li; break; } if(M.events[i].pierce){ nextLi=M.events[i].li; break; } }
  const strip=l=>l.replace(/^N\d+\s*/,'');
  const before=L.slice(rapidLi+1,cutLi).map(strip), after=L.slice(endLi+1,nextLi).map(strip);
  const pre=L.slice(0,ri>=0?rapidLi:cutLi);
  const lastEnd=M.events[M.contours[M.contours.length-1].end].li, rapidAt={};
  M.events.forEach(e=>{ if(e.type==='rapid') rapidAt[e.li]=e; });
  const post=[]; let skipping=true;
  for(let li=lastEnd+1;li<L.length;li++){ const l=strip(L[li]);
    if(skipping&&after.includes(l)) continue; skipping=false;
    if(rapidAt[li]) post.push({x:rapidAt[li].x1,y:rapidAt[li].y1}); else post.push(L[li]); }
  const motion=L.filter(l=>/G0?[0-3](?!\d)/i.test(l)).slice(0,400).join(' ');
  const dec=re=>{ let d=0; for(const m of motion.matchAll(re)) d=Math.max(d,(m[1]||'').length); return Math.max(1,Math.min(4,d)); };
  const rl=L[rapidLi]||'';
  return {inc:/G91(?!\d)/i.test(pre.join(' ')),compact:/G0?0X/i.test(rl.replace(/^N\d+\s*/,''))||!/\s/.test(strip(rl)),nums:/^N\d+/.test(rl),
    dXY:dec(/[XY]-?\d*\.(\d*)/gi),dIJ:dec(/[IJ]-?\d*\.(\d*)/gi),numStyle:/[XY]-?\d+\.(?![0-9])/.test(motion)?'dot':'trim0',
    before,after,pre,post,feed:M.events.some(e=>e.type==='cut'&&/F/i.test(L[e.li]))?(j=>j.feed):null,comments:false};
}
function ncJobs(M){
  return M.contours.map(c=>{ const segs=[]; let feed=null;
    for(let i=c.ev;i<=c.end;i++){ const e=M.events[i]; if(e.type!=='cut') continue; if(feed==null&&e.f!=null) feed=e.f;
      segs.push(e.arc?{t:'A',cx:e.arc.cx,cy:e.arc.cy,r:e.arc.r,a0:e.arc.a0,sw:e.arc.sw,sx:e.x0,sy:e.y0,ex:e.x1,ey:e.y1}:{t:'L',x0:e.x0,y0:e.y0,x1:e.x1,y1:e.y1}); }
    return {segs,pierce:sp(segs[0]),sample:segs.length>1?sp(segs[1]):midPt(segs[0]),feed,tol:M.units==='mm'?0.02:0.001}; }); }
function twoOptAll(seq){ const groups=[]; let cur=[]; for(const j of seq){ cur.push(j); if(j===j.top){ groups.push(cur); cur=[]; } } if(cur.length) groups.push(cur);
  let st=[0,0]; const out=[]; for(const g of groups){ const s=twoOpt(g,st); out.push(...s); st=jEnd(s[s.length-1]); } return out; }
function optimizeNC(M){
  const st=ncStyle(M), jobs=ncJobs(M), before=rapidLen(jobs);
  let ord=orderJobs(jobs,[0,0]), after=rapidLen(ord), kept=false;
  const orig=jobs.slice(); if(jobs.every(j=>!j.parent||orig.indexOf(j)<orig.indexOf(j.parent))){ const imp=twoOptAll(orig); const ic=rapidLen(imp); if(ic<after){ ord=imp; after=ic; } }
  if(after>=before-1e-6){ ord=jobs; after=before; kept=true; }
  const bad=jobs.filter(j=>j.parent&&jobs.indexOf(j)>jobs.indexOf(j.parent)).length;
  return {text:emitLaser(ord,st),before,after,n:ord.length,kept,bad};
}

function parseToolLib(text){ const tools=[], bad=[];
  text.split(/\r?\n/).forEach((raw,li)=>{ const l=raw.replace(/[(),]/g,' ').replace(/(\d)\s*[xX*]\s*(?=[\d.])/g,'$1 ').trim(); if(!l||/^[;#']/.test(l)) return;
    const tk=l.split(/\s+/), m=tk[0].match(/^T?(\d+)$/i); if(!m||!tk[1]){ bad.push(li+1); return; }
    const sh=tk[1].toUpperCase(), nums=tk.slice(2).filter(t=>/^[\d.]+$/.test(t)).map(Number), idx=tk.slice(2).some(t=>/^IND(EX)?|IDX$/i.test(t));
    const id='T'+(+m[1]); let t=null;
    if(/^RO(UND)?$/.test(sh)&&nums[0]>0) t={id,shape:'ROUND',d:nums[0],keyed:0};
    else if(/^SQ(UARE)?$/.test(sh)&&nums[0]>0) t={id,shape:'SQUARE',s:nums[0],L:nums[0],W:nums[0],keyed:idx||nums[1]===undefined?'INDEX':nums[1]};
    else if(/^RE(CT)?$/.test(sh)&&nums[0]>0&&nums[1]>0) t={id,shape:'RECT',L:nums[0],W:nums[1],keyed:idx||nums[2]===undefined?'INDEX':nums[2]};
    if(t) tools.push(t); else bad.push(li+1); });
  return {tools,bad}; }
function rectInfo(segs,tol){ const v=segs.map(s=>[s.x1-s.x0,s.y1-s.y0]), l=v.map(a=>Math.hypot(a[0],a[1]));
  for(let i=0;i<4;i++){ const a=v[i],b=v[(i+1)%4]; if(Math.abs(a[0]*b[0]+a[1]*b[1])>1e-4*l[i]*l[(i+1)%4]) return null; }
  if(Math.abs(l[0]-l[2])>tol||Math.abs(l[1]-l[3])>tol) return null;
  const cx=segs.reduce((t,s)=>t+s.x0,0)/4, cy=segs.reduce((t,s)=>t+s.y0,0)/4;
  return {a:l[0],b:l[1],ang:Math.atan2(v[0][1],v[0][0])*180/Math.PI,cx,cy}; }
function genPunch(m,o){
  const lib=parseToolLib(o.lib), k=m.units==='mm'?25.4:1;
  if(!lib.tools.length) throw new Error('the tool library is empty. Add lines like “T116 ROUND 0.149”');
  const tools=lib.tools.map(t=>({...t,d:t.d*k,s:t.s*k,L:t.L*k,W:t.W*k}));
  const rounds=tools.filter(t=>t.shape==='ROUND').sort((a,b)=>b.d-a.d), rects=tools.filter(t=>t.shape!=='ROUND');
  const tol=o.tol, pitch=Math.max(o.pitch,tol*5), hits=[], warn=[]; let single=0,nib=0,fail=0;
  const nAng=a=>{ let d=((a%180)+180)%180; if(d>179.995) d=0; return d; };
  const angOK=(t,a)=>{ if(t.keyed==='INDEX') return true; const d=nAng(t.keyed-a); return d<0.01||d>179.99; };
  const hit=(t,x,y,c)=>hits.push({t,x,y,c:t.keyed==='INDEX'?nAng(c):(t.shape==='ROUND'?0:t.keyed)});
  for(const c of m.closed){ orient(c,c.hole);
    const scrapW=c.hole?Math.min(c.bw,c.bh):Infinity, s0=c.segs[0];
    if(c.hole&&c.segs.length===1&&s0.t==='A'&&Math.abs(Math.abs(s0.sw)-TAU)<1e-6){ const t=rounds.find(t=>Math.abs(t.d-2*s0.r)<=tol); if(t){ hit(t,s0.cx,s0.cy,0); single++; continue; } }
    if(c.hole&&c.segs.length===4&&c.segs.every(s=>s.t==='L')){ const r=rectInfo(c.segs,tol);
      if(r){ let f=null; for(const t of rects){ if(Math.abs(t.L-r.a)<=tol&&Math.abs(t.W-r.b)<=tol&&angOK(t,r.ang)){ f=[t,r.ang]; break; } if(Math.abs(t.L-r.b)<=tol&&Math.abs(t.W-r.a)<=tol&&angOK(t,r.ang+90)){ f=[t,r.ang+90]; break; } }
        if(f){ hit(f[0],r.cx,r.cy,f[1]); single++; continue; } } }
    let ok=true;
    for(const s of c.segs){ const len=slen(s); if(len<tol) continue;
      if(s.t==='L'){ const ux=(s.x1-s.x0)/len, uy=(s.y1-s.y0)/len, nx=-uy, ny=ux, ang=Math.atan2(uy,ux)*180/Math.PI;
        const rt=rects.filter(t=>t.L<=len+tol&&t.W<=scrapW*0.98&&angOK(t,ang)).sort((a,b)=>b.L-a.L)[0];
        if(rt){ const n=len<=rt.L+tol?1:Math.ceil((len-rt.L)/(rt.L*0.9))+1; for(let j=0;j<n;j++){ const t=n===1?len/2:rt.L/2+(len-rt.L)*j/(n-1); hit(rt,s.x0+ux*t+nx*rt.W/2,s.y0+uy*t+ny*rt.W/2,ang); } continue; }
        const ro=rounds.find(t=>t.d<=scrapW*0.98); if(!ro){ ok=false; continue; } const r=ro.d/2, a=Math.min(r,len/2), b=len-a, n=Math.max(1,Math.ceil((b-a)/pitch));
        for(let j=0;j<=n;j++){ const t=a+(b-a)*j/n; hit(ro,s.x0+ux*t+nx*r,s.y0+uy*t+ny*r,0); } }
      else { const ro=rounds.find(t=>t.d<=scrapW*0.98&&(s.sw<0||t.d/2<s.r*0.98)); if(!ro){ ok=false; continue; }
        const r=ro.d/2, R=s.sw>0?s.r-r:s.r+r, n=Math.max(1,Math.ceil(Math.abs(s.sw)*R/pitch));
        for(let j=0;j<=n;j++){ const a=s.a0+s.sw*j/n; hit(ro,s.cx+R*Math.cos(a),s.cy+R*Math.sin(a),0); } } }
    nib++; if(!ok){ fail++; warn.push(`No tool fits part of the ${c.hole?'hole':'profile'} at X${fmtN(c.bx0,m.units)} Y${fmtN(c.by0,m.units)} (${fmtN(c.bw,m.units)} × ${fmtN(c.bh,m.units)}). Add a smaller round tool.`); } }
  if(m.open.length) warn.push(`${m.open.length} open contour${m.open.length>1?'s were':' was'} skipped. Punching needs closed shapes.`);
  if(lib.bad.length) warn.push(`Tool library lines not understood: ${lib.bad.join(', ')}.`);
  if(!hits.length) throw new Error('no hits could be placed with this tool library');
  const seen=new Set(), uniq=hits.filter(h=>{ const kk=h.t.id+'|'+Math.round(h.x*1e4)+'|'+Math.round(h.y*1e4)+'|'+Math.round(h.c*100); if(seen.has(kk)) return false; seen.add(kk); return true; });
  const F=v=>fmtN(v,m.units), used=tools.filter(t=>uniq.some(h=>h.t===t)), out=[];
  out.push(`O${String(o.num).padStart(4,'0')}(${o.name})`,`(${o.date})`);
  const f4=v=>(+v).toFixed(4);
  for(const t of used){ const ky=t.keyed==='INDEX'?'INDEX':(+t.keyed).toFixed(2);
    out.push(t.shape==='ROUND'?`(UT/${t.id} ROUND   ${f4(t.d)}   KEYED   0.00)`:t.shape==='SQUARE'?`(UT/${t.id} SQUARE   ${f4(t.s)}   KEYED   ${ky})`:`(UT/${t.id} RECT ${f4(t.L)}X${f4(t.W)}   KEYED   ${ky})`); }
  out.push(`(SHEET DIM: ${F(o.sheetW)} ${F(o.sheetH)})`,`(THICKNESS: ${F(o.thick)})`,`(MATERIAL: ${o.mat})`,`(FROM DXF: ${o.file})`,`(UNITS: ${m.units==='mm'?'MM':'INCH'})`);
  let N=5; const L=s=>{ out.push('N'+String(N).padStart(2,'0')+' '+s); N+=5; };
  L(`G06 A${F(o.thick)} B 1`); L('G90');
  let px=0,py=0;
  for(const t of used){ let pool=uniq.filter(h=>h.t===t); L('M500');
    let first=true, lastC=null;
    while(pool.length){ let bi=0,bd=Infinity; if(pool.length>4000){ bi=0; } else pool.forEach((h,i)=>{ const d=Math.hypot(h.x-px,h.y-py); if(d<bd){ bd=d; bi=i; } });
      const h=pool.splice(bi,1)[0]; px=h.x; py=h.y;
      const cw=t.keyed==='INDEX'&&h.c!==lastC?` C${fmtN(h.c,'mm').replace(/^(-?\d+)$/,'$1.')}`:''; lastC=h.c;
      const desc=t.shape==='ROUND'?`RO ${+t.d.toFixed(4)}`:t.shape==='SQUARE'?`SQ ${+t.s.toFixed(4)}`:`RE ${+t.L.toFixed(4)}X${+t.W.toFixed(4)}`;
      L(`X${F(h.x)} Y${F(h.y)}${cw}${first?` ${t.id} (${desc})`:''}`); first=false; } }
  L('G50'); out.push('%');
  return {text:out.join('\n'),summary:`${uniq.length} hits with ${used.length} tools (${single} single-hit features, ${nib} nibbled)`,warn};
}
/* ===== DXF CORE END ===== */

/* ---------- source file + re-process ---------- */
let SRC=null, pending=false;
const tNow=()=>new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function setSrc(type,text,name){ SRC={type,text,name:name||(type==='dxf'?'pasted.dxf':'pasted program')}; clearDirty(); }
function srcLine(){ setTimeout(optState,0); const R=document.getElementById('optRes'); if(R) R.textContent=''; const el=document.getElementById('srcInfo'); if(!SRC){ el.textContent='No file loaded yet'; return; }
  el.innerHTML=`Source <b>${esc(SRC.name)}</b> (${SRC.type==='dxf'?'DXF drawing':'NC program'}) · processed ${tNow()}`; }
function markDirty(){ if(!SRC) return; pending=true; document.querySelectorAll('button.rp').forEach(b=>b.classList.add('dirty')); document.getElementById('pend1').hidden=false; if(SRC.type==='dxf') document.getElementById('pend2').hidden=false; }
function clearDirty(){ pending=false; document.querySelectorAll('button.rp').forEach(b=>b.classList.remove('dirty')); ['pend1','pend2'].forEach(id=>document.getElementById(id).hidden=true); const b=document.getElementById('reproc'); if(b) b.disabled=!SRC; }
function optState(){ const b=document.getElementById('optBtn'); if(!b) return; b.disabled=!(SRC&&(SRC.type==='dxf'||(M&&M.kind==='laser'))); }
function optimizeNow(){
  const R=document.getElementById('optRes');
  if(SRC&&SRC.type==='dxf'){ dv('dOpt').checked=true; reprocess(); R.textContent='DXF re-processed with optimized cut order.'; return; }
  if(!M||M.kind!=='laser'){ R.textContent='Optimizing works on laser programs.'; return; }
  let r; try{ r=optimizeNC(M); }catch(err){ R.textContent='Couldn’t optimize: '+err.message+'.'; return; }
  const U=M.units, base=(SRC?SRC.name:'program').replace(/\.[a-z0-9]+$/i,''), name=safeName(base+'_OPT')+'.nc', u=U==='mm'?'mm':'in';
  const pct=r.before>0?Math.round((r.before-r.after)/r.before*100):0;
  if(!load(r.text,name,'laser',U,true)) return;
  NC={text:r.text,name}; dv('dFile').value=safeName(base+'_OPT'); dv('dRev').value=nextRev(safeName(base+'_OPT')); revLabel(); showOut('Optimized from '+(SRC?SRC.name:'program'));
  $('#src').value=r.text.length<2e6?r.text:'(program is large; text not shown here)';
  const fmt=v=>Math.round(v).toLocaleString();
  R.textContent=r.kept?`This order is already the shortest found (${fmt(r.before)} ${u} of rapids). Program unchanged.`:`Rapid travel ${fmt(r.before)} → ${fmt(r.after)} ${u} (−${pct}%). ${r.n} contours: inner first, perimeter last.`;
  msg('ok',`<span class="pill">Optimized</span> ${esc(name)} · ${r.n} contours · rapids ${fmt(r.before)} → ${fmt(r.after)} ${u}${r.bad?` · fixed ${r.bad} contour${r.bad>1?'s':''} that were cut after the shape around ${r.bad>1?'them':'it'}`:''}`);
}
function reprocess(){ if(!SRC) return;
  const ok=SRC.type==='dxf'?dxfConvert(true):load(SRC.text,SRC.name,undefined,undefined,true);
  if(ok!==false){ clearDirty(); srcLine(); } optState(); document.getElementById('optRes').textContent=''; }

/* ---------- input station ---------- */
function readFile(f){
  if(!f) return;
  if(f.size>40*1024*1024){ msg('err','<span class="pill">Not loaded</span> That file is over 40 MB. Split the program or load a single part.'); return; }
  const rd=new FileReader();
  rd.onload=()=>{ const t=String(rd.result);
    if(/\.dxf$/i.test(f.name)||dxfIsText(t)){ setSrc('dxf',t,f.name); dxfOpen(t,f.name); srcLine(); return; }
    if(/[\x00-\x08\x0E-\x1F]/.test(t.slice(0,4000))){ msg('err',`<span class="pill">Not loaded</span> ${esc(f.name)} looks like a binary file. Export the program as plain text (ASCII/EIA) and try again.`); return; }
    dv('dxfPanel').hidden=true; dv('outPanel').hidden=true; NC=null;
    $('#src').value=t.length<2e6?t:'(program is large; text not shown here)';
    setSrc('nc',t,f.name); load(t,f.name); srcLine(); };
  rd.onerror=()=>msg('err','<span class="pill">Not loaded</span> The browser could not read that file. Try choosing it again.');
  rd.readAsText(f);
}
$('#file').addEventListener('change',e=>{ readFile(e.target.files[0]); e.target.value=''; });
const inbox=$('#inbox');
['dragenter','dragover'].forEach(t=>inbox.addEventListener(t,e=>{ e.preventDefault(); inbox.classList.add('over'); }));
['dragleave','drop'].forEach(t=>inbox.addEventListener(t,e=>{ e.preventDefault(); if(t==='dragleave'&&inbox.contains(e.relatedTarget)) return; inbox.classList.remove('over'); }));
inbox.addEventListener('drop',e=>{ const f=e.dataTransfer&&e.dataTransfer.files[0]; if(f) readFile(f); });
$('#run').onclick=()=>{ const t=$('#src').value; if(dxfIsText(t)){ setSrc('dxf',t,'pasted.dxf'); dxfOpen(t,'pasted.dxf'); srcLine(); return; } if(!t.trim()){ msg('err','<span class="pill">Nothing to run</span> Drop a file or paste program text first.'); return; } if(t.startsWith('(program is large')&&SRC){ reprocess(); return; } setSrc('nc',t,curName||'pasted program'); load(t,curName); srcLine(); };
$('#src').addEventListener('input',()=>{ curName=''; });
function sample(id,name){ dv('dxfPanel').hidden=true; dv('outPanel').hidden=true; NC=null; const t=document.getElementById(id).textContent.trim(); $('#src').value=t; $('#kind').value='auto'; $('#units').value='auto'; setSrc('nc',t,name); load(t,name); srcLine(); }
$('#sPunch').onclick=()=>sample('src-punch','110515 - Tech Pod Top Horizontal LH - 2.nc');
$('#sLaser').onclick=()=>sample('src-laser','Sample laser bracket.nc');
$('#sDxf').onclick=()=>{ const t=document.getElementById('src-dxf').textContent.trim()+'\n'; setSrc('dxf',t,'Sample bracket.dxf'); dxfOpen(t,'Sample bracket.dxf'); srcLine(); };
/* ---------- DXF panel ---------- */
const SKIP_LAYER=/dim|text|note|title|border|frame|bend|etch|mark|annot|defpoints|hidden|center|cl$/i;
const DEF_LIB=`T116 ROUND 0.149
T229 ROUND 0.172
T236 SQUARE 0.3122 INDEX
T104 RECT 0.5 X 0.1252 90
T215 RECT 1.0 X 0.25 INDEX
T201 RECT 1.875 X 0.25 INDEX
T245 RECT 4.0 X 0.25 0`;
let DX=null, NC=null, convT=null;
function showOut(info){ dv('outPanel').hidden=false; dv('outInfo').textContent=info||''; }
const dv=id=>document.getElementById(id);
const num=(id,d=0)=>{ const v=parseFloat(dv(id).value); return isNaN(v)?d:v; };
function dmsg(kind,html){ const el=dv('dMsg'); el.className='dnote '+kind; el.innerHTML=html; }
function smsg(kind,text){ const el=dv('sMsg'); el.className='dnote '+kind; el.textContent=text; }
function dxfUnitsLabel(){ document.querySelectorAll('.du').forEach(e=>e.textContent=dv('dUnits').value==='mm'?'mm':'in'); dv('dFeedU').textContent=dv('dUnits').value==='mm'?'mm/min':'in/min'; }
function dxfKindVis(){ const k=dv('dOut').value; document.querySelectorAll('.laserOnly').forEach(e=>e.hidden=k!=='laser'); document.querySelectorAll('.punchOnly').forEach(e=>e.hidden=k!=='punch'); }
function safeName(s){ return String(s).replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim()||'program'; }
function dxfOpen(text,name){
  let dx, C;
  try{ dx=parseDXF(text); C=dxfSegsAll(dx); }
  catch(err){ msg('err',`<span class="pill">Not loaded</span> Couldn't read ${esc(name||'this DXF')}: ${esc(err.message)}.`); return; }
  if(!C.segs.length){ msg('err',`<span class="pill">Not loaded</span> ${esc(name||'This DXF')} has no lines, arcs, circles, polylines, ellipses or splines to cut.`); return; }
  const lay={}; C.segs.forEach(s=>lay[s.layer]=(lay[s.layer]||0)+1);
  const off=new Set(Object.keys(lay).filter(l=>SKIP_LAYER.test(l))); if(Object.keys(lay).every(l=>off.has(l))) off.clear();
  const iu={1:'in',2:'ft',4:'mm',5:'cm',6:'m'}[dx.insunits]||null;
  DX={dx,name:name||'drawing.dxf',lay,off,skipped:C.skipped,iu};
  const o=dv('dSrc').options[0]; o.textContent=iu?`Auto (file says ${iu})`:'Auto (not set: inch)';
  if(dv('dSrc').value==='auto'){ const want=iu==='mm'||iu==='cm'||iu==='m'?'mm':'in'; if(dv('dUnits').value!==want){ dv('dUnits').value=want; convertFields(want); } }
  const base=DX.name.replace(/\.dxf$/i,'');
  dv('dName').value=base.toUpperCase().replace(/[()]/g,'').slice(0,60);
  dv('dFile').value=safeName(base); dv('dRev').value=nextRev(safeName(base)); revLabel();
  dv('dSW').value=''; dv('dSH').value='';
  renderLayers(); dv('dxfPanel').hidden=false; dxfKindVis(); dxfUnitsLabel();
  dv('dxfInfo').textContent=`${DX.name} · ${C.segs.length} segments · ${Object.keys(lay).length} layer${Object.keys(lay).length>1?'s':''}`;
  dxfConvert(false);
}
function renderLayers(){
  const box=dv('dLayers'); box.innerHTML='<span class="lbl">Layers</span>';
  Object.keys(DX.lay).sort().forEach(l=>{ const lab=document.createElement('label'); lab.className='lay'+(DX.off.has(l)?' off':'');
    lab.innerHTML=`<input type="checkbox" ${DX.off.has(l)?'':'checked'}> <span>${esc(l)}</span> <small>${DX.lay[l]}</small>`;
    lab.querySelector('input').addEventListener('change',e=>{ if(e.target.checked) DX.off.delete(l); else DX.off.add(l); lab.classList.toggle('off',!e.target.checked); markDirty(); });
    box.appendChild(lab); });
  const sk=Object.entries(DX.skipped); if(sk.length){ const s=document.createElement('small'); s.className='skip'; s.textContent='Not cut: '+sk.map(([k,v])=>`${v} ${k}`).join(', '); box.appendChild(s); }
}
function dxfConvert(keep){
  if(!DX) return false;
  const units=dv('dUnits').value, kind=dv('dOut').value, src=dv('dSrc').value==='auto'?(DX.iu||'in'):dv('dSrc').value, margin=Math.max(0,num('dMargin'));
  let m, nc;
  try{ m=buildModel(DX.dx,{off:DX.off,src,out:units,margin}); }
  catch(err){ dmsg('err',`Couldn't convert: ${esc(err.message)}.`); return false; }
  const r=units==='mm'?1:100, sw=num('dSW',0)||Math.ceil((m.partW+2*margin)*r)/r, sh=num('dSH',0)||Math.ceil((m.partH+2*margin)*r)/r;
  dv('dSW').placeholder=fmtN(sw,units); dv('dSH').placeholder=fmtN(sh,units);
  const d=new Date(), o={num:Math.max(1,Math.round(num('dNum',1001))),name:(dv('dName').value||'PART').replace(/[()]/g,'').toUpperCase(),date:`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`,
    file:DX.name.replace(/[()]/g,''),sheetW:sw,sheetH:sh,thick:num('dThick'),mat:(dv('dMat').value||'—').replace(/[()]/g,'').toUpperCase(),
    leadH:num('dLeadH'),angH:+dv('dAngH').value,outH:num('dOutH'),oangH:+dv('dOAngH').value,gapH:num('dGapH'),leadP:num('dLeadP'),angP:+dv('dAngP').value,outP:num('dOutP'),oangP:+dv('dOAngP').value,gapP:num('dGapP'),style:dv('dStyle').value,comp:dv('dComp').value,opt:dv('dOpt').checked,comments:dv('dCmt').checked,feed:num('dFeed',100),on:dv('dOn').value.trim().toUpperCase(),off:dv('dOff').value.trim().toUpperCase(),dwell:num('dDwell'),open:dv('dOpen').checked,
    lib:dv('dTools').value,pitch:num('dPitch',units==='mm'?1.5:0.06),tol:num('dTol',units==='mm'?0.05:0.002)};
  try{ nc=kind==='laser'?genLaser(m,o):genPunch(m,o); }
  catch(err){ dmsg('err',`Couldn't make the ${kind} program: ${esc(err.message)}.`); return false; }
  const fname=verName()+'.nc';
  NC={text:nc.text,name:fname}; showOut('From '+DX.name);
  $('#src').value=nc.text; curName=fname;
  const okLoad=load(nc.text,fname,kind,units,keep);
  if(!okLoad) return false;
  const lines=nc.text.split('\n').length;
  msg('ok',`<span class="pill">DXF → ${kind==='laser'?'Laser':'Punch'}</span> ${esc(DX.name)} converted to ${esc(fname)} · ${lines} lines · ${esc(nc.summary)} · ${units==='mm'?'mm':'inch'}`);
  const fit=sw<m.partW+margin-1e-6||sh<m.partH+margin-1e-6?`<p class="warn">The part (${fmtN(m.partW,units)} × ${fmtN(m.partH,units)} plus the ${fmtN(margin,units)} margin) is larger than the sheet.</p>`:'';
  dmsg('ok',`<p>Program ready: ${esc(nc.summary)}. Part ${fmtN(m.partW,units)} × ${fmtN(m.partH,units)} ${units==='mm'?'mm':'in'} on a ${fmtN(sw,units)} × ${fmtN(sh,units)} sheet.</p>`+fit+nc.warn.map(w=>`<p class="warn">${esc(w)}</p>`).join(''));
  smsg('','');
}
function convertFields(to){
  const f=to==='mm'?25.4:1/25.4;
  ['dLeadH','dLeadP','dOutH','dOutP','dGapH','dGapP','dMargin','dThick','dFeed','dPitch','dTol','dSW','dSH'].forEach(id=>{ const el=dv(id); if(el.value==='') return; const v=parseFloat(el.value); if(isNaN(v)) return;
    const dp=to==='mm'?(id==='dFeed'?0:id==='dTol'?3:2):(id==='dFeed'?0:4); el.value=String(+(v*f).toFixed(dp)); });
}
const reconv=()=>markDirty();
['dNum','dName','dThick','dMat','dMargin','dSW','dSH','dLeadH','dLeadP','dOutH','dOutP','dGapH','dGapP','dFeed','dOn','dOff','dDwell','dPitch','dTol','dTools'].forEach(id=>dv(id).addEventListener('input',reconv));
dv('dOpen').addEventListener('change',markDirty);
['dAngH','dAngP','dOAngH','dOAngP','dStyle','dComp','dOpt','dCmt'].forEach(id=>dv(id).addEventListener('change',markDirty));
function applyPattern(){ const mm=dv('dUnits').value==='mm', k=mm?1:1/25.4, f=v=>String(+(v*k).toFixed(mm?2:4));
  dv('dStyle').value='shop'; dv('dComp').value='G41'; dv('dOn').value='M07'; dv('dOff').value='M08'; dv('dDwell').value='0'; dv('dCmt').checked=false; dv('dOpt').checked=true;
  dv('dLeadH').value='0'; dv('dAngH').value='90'; dv('dOutH').value='0'; dv('dOAngH').value='90'; dv('dGapH').value='0';
  dv('dLeadP').value=f(0.92); dv('dAngP').value='90'; dv('dOutP').value='0'; dv('dOAngP').value='90'; dv('dGapP').value=f(0.58); markDirty(); }
dv('dPattern').addEventListener('click',applyPattern);
dv('dOut').addEventListener('change',()=>{ dxfKindVis(); markDirty(); });
dv('dSrc').addEventListener('change',markDirty);
dv('dUnits').addEventListener('change',e=>{ convertFields(e.target.value); dxfUnitsLabel(); markDirty(); });
dv('dGo').addEventListener('click',reprocess);
dv('reproc').addEventListener('click',reprocess);
dv('optBtn').addEventListener('click',optimizeNow);
dv('dReset').addEventListener('click',()=>{ dv('dTools').value=DEF_LIB; markDirty(); });
dv('dTools').value=DEF_LIB;

/* ---------- save ---------- */
function crc32(b){ let crc=0xFFFFFFFF; for(let i=0;i<b.length;i++){ let c=(crc^b[i])&0xFF; for(let k=0;k<8;k++) c=c&1?(c>>>1)^0xEDB88320:c>>>1; crc=(crc>>>8)^c; } return (crc^0xFFFFFFFF)>>>0; }
function makeZip(name,data){ const nm=new TextEncoder().encode(name), crc=crc32(data), n=data.length, d=new Date();
  const dt=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate(), tm=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1);
  const lh=new DataView(new ArrayBuffer(30)); lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(10,tm,true); lh.setUint16(12,dt,true); lh.setUint32(14,crc,true); lh.setUint32(18,n,true); lh.setUint32(22,n,true); lh.setUint16(26,nm.length,true);
  const ch=new DataView(new ArrayBuffer(46)); ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(12,tm,true); ch.setUint16(14,dt,true); ch.setUint32(16,crc,true); ch.setUint32(20,n,true); ch.setUint32(24,n,true); ch.setUint16(28,nm.length,true);
  const eo=new DataView(new ArrayBuffer(22)); eo.setUint32(0,0x06054b50,true); eo.setUint16(8,1,true); eo.setUint16(10,1,true); eo.setUint32(12,46+nm.length,true); eo.setUint32(16,30+nm.length+n,true);
  return new Blob([lh,nm,data,ch,nm,eo],{type:'application/zip'}); }
let DLp=null;
function getDL(){ if(!DLp) DLp=(async()=>{ try{ return window.claude&&window.claude.use?await window.claude.use('downloads'):null; }catch(e){ return null; } })(); return DLp; }
getDL().then(d=>{ if(!d&&window.self!==window.top){ dv('dSave').disabled=true; dv('dSave').title='Saving is not available in this view'; smsg('','Saving isn’t available in this view. Use Copy NC and paste it into a file on your drive.'); } });
/* versioned file names: NAME_v01.nc, NAME_v02.nc ... (remembered per name in this browser) */
const revKey=b=>'ncsim-rev:'+b.toUpperCase();
function nextRev(b){ try{ const v=parseInt(localStorage.getItem(revKey(b)),10); return isNaN(v)?1:v+1; }catch(e){ return 1; } }
function baseName(){ return safeName(dv('dFile').value||(NC&&NC.name)||'PROGRAM').replace(/\.(nc|txt|zip)$/i,'').replace(/_v\d+$/i,''); }
function verName(){ const r=Math.max(1,Math.round(+dv('dRev').value||1)); return baseName()+'_v'+String(r).padStart(2,'0'); }
function revLabel(){ dv('dFileOut').textContent='→ '+verName()+'.nc'; }
dv('dFile').addEventListener('input',()=>{ dv('dRev').value=nextRev(baseName()); revLabel(); });
dv('dRev').addEventListener('input',revLabel);
function stampRev(text,v){ if(!/\(/.test(text)) return text; const L=text.split('\n'), i=L.findIndex(l=>/^O\d+/.test(l)); const tag=`(FILE: ${v}.nc  SAVED ${new Date().toLocaleString()})`; if(i>=0) L.splice(i+1,0,tag); else L.unshift(tag); return L.join('\n'); }
function bumpRev(){ const b=baseName(), r=Math.max(1,Math.round(+dv('dRev').value||1)); try{ localStorage.setItem(revKey(b),String(r)); }catch(e){} dv('dRev').value=r+1; revLabel(); }
dv('dSave').addEventListener('click',async()=>{
  if(!NC){ smsg('err','Nothing to save yet. Convert a DXF or optimize a program first.'); return; }
  const v=verName(), crlf=stampRev(NC.text,v).replace(/\r?\n/g,'\r\n'), d=await getDL();
  if(!d){
    if(window.self===window.top){ // opened as a local file: a normal browser download keeps the real .nc name
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([crlf],{type:'text/plain'})); a.download=v+'.nc'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
      smsg('ok',`Saved ${v}.nc. Next save will be v${String(+dv('dRev').value+1).padStart(2,'0')}.`); bumpRev(); return; }
    smsg('err','Saving isn’t available in this view. Use Copy NC and paste it into a .nc file.'); return; }
  const fmt=dv('dFmt').value, filename=fmt==='zip'?v+'.zip':v+'.nc.txt', data=fmt==='zip'?makeZip(v+'.nc',new TextEncoder().encode(crlf)):crlf;
  smsg('','Waiting for you to confirm the save…');
  try{ const r=await d.save({filename,data}); bumpRev();
    smsg('ok',r.status==='delivered'?`Sent ${filename} to the destination you chose.`:(fmt==='zip'?`Saved ${filename}. Unzip it on the drive to get ${v}.nc.`:`Saved ${filename}. Remove “.txt” from the name on the drive so the control reads it as ${v}.nc.`)); }
  catch(e){ const c=e&&e.code; smsg('err',c==='declined'?'Save cancelled. The revision number was not used.':c==='rate_limited'?'A save prompt is already open. Finish it, then try again.':c==='rejected_extension'||c==='extension_not_enabled'?'This view doesn’t allow that file type. Pick the other format and save again.':c==='too_large'?'The program is too large to save here. Use Copy NC instead.':'Saving isn’t available in this view. Use Copy NC instead.'); }
});
dv('dCopy').addEventListener('click',()=>{
  if(!NC){ smsg('err','Nothing to save yet. Convert a DXF or optimize a program first.'); return; }
  const fallback=()=>{ const t=$('#src'); t.focus(); t.select(); smsg('','The program is selected in the text box above. Press Ctrl+C to copy it.'); };
  try{ navigator.clipboard.writeText(NC.text).then(()=>smsg('ok','Copied the NC program.'),fallback); }catch(e){ fallback(); }
});

['kind','units'].forEach(id=>$('#'+id).addEventListener('change',markDirty));
$('#kerf').addEventListener('input',markDirty);

/* ---------- transport ---------- */
$('#bPlay').onclick=()=>{ if(!M) return; if(st.i>=M.events.length) setI(0); st.playing=!st.playing; updateStatus(); };
$('#bBack').onclick=()=>{st.playing=false;setI(st.i-(st.frac>0?0:1));};
$('#bFwd').onclick=()=>{st.playing=false;setI(st.i+1);};
$('#bStart').onclick=()=>{st.playing=false;setI(0);};
$('#bEnd').onclick=()=>{st.playing=false;setI(M.events.length);};
$('#scrub').oninput=e=>{st.playing=false;setI(+e.target.value);};
$('#speed').onchange=e=>st.speed=+e.target.value;
const noFollow=()=>{ $('#oFollow').checked=st.follow=false; };
$('#vFit').onclick=()=>{noFollow();vFit();};
$('#vLeft').onclick=()=>{noFollow();vLeft();};
$('#vRight').onclick=()=>{noFollow();vRight();};
$('#zIn').onclick=()=>zoomAt(1.6,W/2,H/2);
$('#zOut').onclick=()=>zoomAt(1/1.6,W/2,H/2);
$('#o1').onchange=e=>{st.o1=e.target.checked;dirty=true;};
$('#o2').onchange=e=>{st.o2=e.target.checked;dirty=true;};
$('#oFollow').onchange=e=>{ st.follow=e.target.checked; if(st.follow){ const want=Math.min(W,H)/(Math.max(S().h,S().w)*0.25); if(view.scale<want) view.scale=want; } dirty=true; };
document.addEventListener('keydown',e=>{ const a=document.activeElement, tag=a&&a.tagName;
  if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(tag)||a&&a.classList&&a.classList.contains('ln')) return;
  if(e.key===' '){e.preventDefault();$('#bPlay').click();} else if(e.key==='ArrowRight'){e.preventDefault();$('#bFwd').click();} else if(e.key==='ArrowLeft'){e.preventDefault();$('#bBack').click();} else if(e.key==='Home'){$('#bStart').click();} else if(e.key==='End'){$('#bEnd').click();} });
let drag=null;
cvs.addEventListener('pointerdown',e=>{ drag={x:e.clientX,y:e.clientY}; cvs.setPointerCapture(e.pointerId); cvs.classList.add('drag'); });
cvs.addEventListener('pointermove',e=>{ const r=cvs.getBoundingClientRect(); const [wx,wy]=toWorld(e.clientX-r.left,e.clientY-r.top); $('#cursor').textContent='X '+wx.toFixed(dec())+'  Y '+wy.toFixed(dec())+' '+(M?uL():'');
  if(drag){ view.cx-=(e.clientX-drag.x)/view.scale; view.cy+=(e.clientY-drag.y)/view.scale; drag={x:e.clientX,y:e.clientY}; if(st.follow) noFollow(); dirty=true; } });
const endDrag=()=>{drag=null;cvs.classList.remove('drag');};
cvs.addEventListener('pointerup',endDrag); cvs.addEventListener('pointercancel',endDrag);
cvs.addEventListener('wheel',e=>{ e.preventDefault(); const r=cvs.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top); },{passive:false});
new ResizeObserver(()=>{ const cx=view.cx,cy=view.cy; resize(); view.cx=cx; view.cy=cy; }).observe(cvs);

let last=performance.now();
function tick(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  if(M&&st.playing){
    const ev=M.events, before=st.i;
    if(M.kind==='punch'){ st.frac+=dt*PUNCH_SPEED[st.speed]; let step=Math.floor(st.frac); st.frac-=step; if(step){ st.i=Math.min(ev.length,st.i+step); } }
    else { let budget=dt; const v=M.diag*LASER_SPEED[st.speed];
      while(budget>0&&st.i<ev.length){ const e=ev[st.i]; const dur=Math.max(0.003,e.len/(e.type==='rapid'?v*3:v)); const rem=(1-st.frac)*dur;
        if(budget>=rem){ budget-=rem; st.i++; st.frac=0; } else { st.frac+=budget/dur; budget=0; } } }
    if(st.i>=ev.length){ st.i=ev.length; st.frac=0; st.playing=false; }
    const keep=st.frac; if(st.i!==before||M.kind==='laser'){ updateStatus(); } st.frac=keep;
    dirty=true;
  }
  if(M&&st.follow){ const h=M.kind==='punch'?punchHead():laserHead(); if(h){ const k=1-Math.pow(0.002,dt); view.cx+=(h.x-view.cx)*k; view.cy+=(h.y-view.cy)*k; dirty=true; } }
  if(dirty){ draw(); dirty=false; }
  requestAnimationFrame(tick);
}
readColors(); resize();
window.NCSim={open(text,name){ dv('dxfPanel').hidden=true; dv('outPanel').hidden=true; NC=null; $('#src').value=text.length<2e6?text:'(program is large; text not shown here)'; $('#kind').value='auto'; $('#units').value='auto'; setSrc('nc',text,name); const ok=load(text,name); srcLine(); return ok; }};
sample('src-punch','110515 - Tech Pod Top Horizontal LH - 2.nc');
requestAnimationFrame(tick);
})();
