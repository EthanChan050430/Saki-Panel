(() => {
  "use strict";
  if(!document.documentElement.dataset.call||window.parent===window) return;
  const frame=document.getElementById("frame");
  const legs=document.getElementById("legs-stage");
  const stage=document.getElementById("stage");
  const portrait=document.getElementById("pose-image");
  const roomLights={
    light:{angle:[0,0,100,39],colors:["#fff3e7","#fffcf9","#e5edff"]},
    dark:{angle:[0,12,100,39],colors:["#d3dff9","#f6eaf0","#fcebd7"]},
  };
  // Light is composited once over the whole character, including walk and reaction frames.
  const lightFilters=Object.entries(roomLights).map(([theme,{angle,colors}])=>{
    const [x1,y1,x2,y2]=angle.map(value=>value+"%");
    const gradient=colors.map((color,index)=>
      '<stop offset="'+[.08,.5,.88][index]+'" stop-color="'+color+'"/>').join("");
    const map='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 165" preserveAspectRatio="none">'+
      '<defs><linearGradient id="key" x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'">'+gradient+
      '</linearGradient></defs><rect width="100" height="165" fill="url(#key)"/></svg>';
    return '<filter id="call-light-'+theme+'" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">'+
      '<feImage href="data:image/svg+xml,'+encodeURIComponent(map)+'" preserveAspectRatio="none" result="room"/>'+
      '<feComposite in="SourceGraphic" in2="room" operator="arithmetic" k1="1"/></filter>';
  }).join("");
  document.body.insertAdjacentHTML("beforeend",
    '<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>'+lightFilters+'</defs></svg>');
  const lightWash={
    light:["rgba(255,220,179,.12)","rgba(252,235,219,.025)","rgba(99,113,156,.16)"],
    dark:["rgba(40,48,100,.20)","rgba(54,35,59,.13)","rgba(160,100,65,.16)"],
  };
  function canvasLightKey() {
    return document.documentElement.dataset.callQuality!=="full"?frame.dataset.lighting:"";
  }
  function paintCanvasLight(ctx,width,height,theme=canvasLightKey()) {
    if(!theme) return;
    const stops=lightWash[theme];
    const light=ctx.createLinearGradient(0,0,width,width*.49);
    for(const [index,stop] of [.08,.5,.88].entries()) light.addColorStop(stop,stops[index]);
    ctx.save();
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation="source-atop";
    ctx.fillStyle=light;
    ctx.fillRect(0,0,width,height);
    ctx.restore();
  }
  window.sakiCallCanvasLightKey=canvasLightKey;
  window.paintSakiCallCanvasLight=paintCanvasLight;
  let lightBuffer;
  window.drawSakiCallAtlas=(target,image,sx,sy,sw,sh)=>{
    const {width,height}=target.canvas;
    const theme=canvasLightKey();
    if(theme&&target.globalAlpha<1) {
      // Grade just the video plate so the live pixels aren't tinted twice in a blend.
      lightBuffer??=document.createElement("canvas");
      if(lightBuffer.width!==width||lightBuffer.height!==height) {
        lightBuffer.width=width;
        lightBuffer.height=height;
      }
      const scratch=lightBuffer.getContext("2d");
      scratch.clearRect(0,0,width,height);
      scratch.drawImage(image,sx,sy,sw,sh,0,0,width,height);
      paintCanvasLight(scratch,width,height,theme);
      target.drawImage(lightBuffer,0,0);
    } else {
      target.drawImage(image,sx,sy,sw,sh,0,0,width,height);
      if(theme) paintCanvasLight(target,width,height,theme);
    }
  };
  const reactions=window.createSakiCallReactions?.(frame,stage,portrait,durations=>
    window.parent.postMessage({type:"saki-call-reactions-ready",durations},location.origin));
  const walkCanvas=document.createElement("canvas");
  walkCanvas.width=legs.width;
  walkCanvas.height=legs.height;
  walkCanvas.id="call-walk";
  walkCanvas.hidden=true;
  walkCanvas.setAttribute("aria-hidden","true");
  frame.append(walkCanvas);
  const brush=walkCanvas.getContext("2d");
  if(brush) brush.imageSmoothingQuality="high";
  const entry=document.createElement("canvas");
  entry.width=walkCanvas.width;
  entry.height=walkCanvas.height;
  const entryBrush=entry.getContext("2d");
  const between=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const smooth=t=>{t=between(t,0,1);return t*t*(3-2*t);};
  const clips=new Map();
  let walking=null;
  let shownY=0,shownRoll=0;
  let walkLoading=null;
  const walkArtVersion="hd-2";
  const announceReady=()=>window.parent.postMessage({type:"saki-call-ready"},location.origin);
  const announceWalk=()=>{
    if(!clips.size) return;
    const profiles=Object.fromEntries([...clips].map(([side,clip])=>[side,clip.root]));
    window.parent.postMessage({type:"saki-call-walk-ready",profiles},location.origin);
  };
  async function loadWalk(compactAssets) {
    let root=compactAssets?"walk-art-lite/":"walk-art/";
    let response=await fetch(`${root}manifest.json?v=${walkArtVersion}`);
    if(!response.ok&&compactAssets) {
      root="walk-art/";
      response=await fetch(`${root}manifest.json?v=${walkArtVersion}`);
    }
    if(!response.ok) return;
    const {width,height,columns,rows,clips:manifest}=await response.json();
    if(![width,height,columns,rows].every(Number.isSafeInteger)||width<1||width*columns>4096||
      height<1||height*rows>4096||columns<1||rows<1) return;
    const capacity=columns*rows;
    await Promise.all(["left","right"].map(async side=>{
      const source=manifest?.[side]?.root;
      if(!Array.isArray(source)||source.length<12||source.length>160) return;
      const [first,last]=manifest[side].range??[0,source.length-1];
      if(![first,last].every(Number.isSafeInteger)||first<0||last>=source.length||
        last-first<11||source[first]!==0||source[last]!==1) return;
      const firstSheet=Math.floor(first/capacity);
      const lastSheet=Math.floor(last/capacity);
      const sheets=[];
      for(let index=firstSheet;index<=lastSheet;index++) {
        sheets.push(await new Promise((resolve,reject)=>{
          const img=new Image();
          img.fetchPriority="low";
          img.decoding="async";
          img.onload=()=>img.naturalWidth===width*columns&&img.naturalHeight===height*rows?resolve(img):reject(new Error("Unexpected walk atlas dimensions"));
          img.onerror=reject;
          img.src=`${root}${side}-${index+1}.webp?v=${walkArtVersion}`;
        }));
      }
      clips.set(side,{root:source.slice(first,last+1),sheets,columns,capacity,width,height,first,firstSheet});
      announceWalk();
    }));
  }

  function drawLive(target) {
    const {width,height}=target.canvas;
    const upperHeight=height*1000/1650;
    if(!legs.hidden) target.drawImage(legs,0,0,width,height);
    if(!stage.hidden) target.drawImage(stage,0,0,width,upperHeight);
    else if(portrait.complete&&portrait.naturalWidth) target.drawImage(portrait,0,0,width,upperHeight);
  }

  function renderWalk(walk,pose) {
    const clip=clips.get(walk?.direction);
    const progress=between(walk?.progress,0,1);
    if(!clip||progress===1||frame.dataset.framing!=="full") {
      walking=null;
      if(!walkCanvas.hidden) walkCanvas.hidden=true;
      if(frame.dataset.walking) delete frame.dataset.walking;
      return [pose.y,pose.lean,false];
    }
    if(!walking||walking.direction!==walk.direction||progress<walking.progress) {
      walking={direction:walk.direction,y:shownY,roll:shownRoll,index:-1,progress};
      entryBrush.clearRect(0,0,entry.width,entry.height);
      drawLive(entryBrush);
    }
    walking.progress=progress;
    const startMix=1-smooth(progress/.05);
    const finishMix=1-smooth((1-progress)/.06);
    const clipMix=1-Math.max(startMix,finishMix);
    const index=clip.first+Math.round(progress*(clip.root.length-1));
    const theme=canvasLightKey();
    if(walking.index!==index||clipMix<1||walking.theme!==theme) {
      const local=index%clip.capacity;
      const {width,height}=walkCanvas;
      brush.clearRect(0,0,width,height);
      if(startMix>0) {
        brush.globalAlpha=startMix;
        brush.drawImage(entry,0,0);
      } else if(finishMix>0) {
        brush.globalAlpha=1;
        entryBrush.clearRect(0,0,entry.width,entry.height);
        drawLive(entryBrush);
        brush.globalAlpha=finishMix;
        brush.drawImage(entry,0,0);
      }
      if(clipMix>0) {
        brush.globalCompositeOperation="lighter";
        brush.globalAlpha=clipMix;
        window.drawSakiCallAtlas(brush,clip.sheets[Math.floor(index/clip.capacity)-clip.firstSheet],
          (local%clip.columns)*clip.width,Math.floor(local/clip.columns)*clip.height,clip.width,clip.height);
        brush.globalCompositeOperation="source-over";
      }
      brush.globalAlpha=1;
      walking.index=index;
      walking.theme=theme;
    }
    if(walkCanvas.hidden) walkCanvas.hidden=false;
    if(frame.dataset.walking!==walk.direction) frame.dataset.walking=walk.direction;
    setTransformValue("--walk-opacity",String(clipMix));
    return [walking.y*startMix+pose.y*finishMix,walking.roll*startMix+pose.lean*finishMix,clipMix===1];
  }
  const transformValues=new Map();
  function setTransformValue(name,value) {
    if(transformValues.get(name)===value) return;
    transformValues.set(name,value);
    frame.style.setProperty(name,value);
  }
  let liveSince=null;
  const isLiveReady=()=>!stage.hidden;
  window.addEventListener("message",event=>{
    if(event.source!==window.parent||event.origin!==location.origin) return;
    if(event.data?.type==="saki-call-status"&&isLiveReady()) {
      announceReady();
      announceWalk();
      reactions?.announce();
    }
    if(event.data?.type!=="saki-call-motion") return;
    const {pose}=event.data;
    if(!Array.isArray(pose?.face)||pose.face.length!==8) return;
    const compact=event.data.compact===true, compactAssets=event.data.compactAssets===true;
    frame.toggleAttribute("data-compact",compact);
    const quality=event.data.quality==="lite"?"lite":event.data.quality==="balanced"?"balanced":"full";
    if(document.documentElement.dataset.callQuality!==quality) document.documentElement.dataset.callQuality=quality;
    const sinceVisible=liveSince===null?-Infinity:performance.now()-liveSince;
    if(brush&&!walkLoading&&sinceVisible>3500&&(!compact||pose.walk)) {
      if(compactAssets) {
        walkCanvas.width=entry.width=640;
        walkCanvas.height=entry.height=1056;
        brush.imageSmoothingQuality="medium";
      }
      walkLoading=loadWalk(compactAssets).catch(()=>null);
    }
    if(sinceVisible>2700||event.data.thinking===true) reactions?.prepare(compactAssets,event.data.thinking===true);
    const lighting=event.data.theme==="light"?"light":"dark";
    if(frame.dataset.lighting!==lighting) frame.dataset.lighting=lighting;
    const [y,roll,walkCoversLive]=renderWalk(pose.walk,pose);
    const reactionCoversLive=reactions?.render(pose.reaction,Boolean(pose.walk));
    frame.toggleAttribute("data-live-covered",walkCoversLive||Boolean(reactionCoversLive));
    document.dispatchEvent(new CustomEvent("saki-tracking",{detail:pose}));
    shownY=between(y,-10,10);
    shownRoll=between(roll,-5,5);
    const quantize=quality==="full"?8:2;
    setTransformValue("--actor-x",Math.round(between(pose.x,-.3,.3)*innerWidth*quantize)/quantize+"px");
    setTransformValue("--actor-y",Math.round(shownY*quantize)/quantize+"px");
    setTransformValue("--actor-roll",Math.round(shownRoll*10)/10+"deg");
    setTransformValue("--actor-scale",String(Math.round(between(pose.scale,.75,1.14)*1000)/1000));
  });
  const ready=new MutationObserver(readyIfVisible);
  function readyIfVisible() {
    if(!isLiveReady()) return;
    liveSince=performance.now();
    ready.disconnect();
    announceReady();
  }
  if(isLiveReady()) readyIfVisible();
  else ready.observe(stage,{attributes:true,attributeFilter:["hidden"]});
})();
