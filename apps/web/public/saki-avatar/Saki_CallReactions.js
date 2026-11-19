(() => {
  "use strict";
  const touchNames=["head","skirt"];
  const thinkingNames=["think-chin","think-tilt","think-nod"];
  const blendTime=135;
  const ease=value=>{
    const t=Math.max(0,Math.min(1,value));
    return t*t*(3-2*t);
  };

  window.createSakiCallReactions=(frame,stage,portrait,notify)=>{
    const canvas=document.createElement("canvas");
    canvas.id="call-reaction";
    canvas.width=stage.width;
    canvas.height=stage.height;
    canvas.hidden=true;
    canvas.setAttribute("aria-hidden","true");
    frame.append(canvas);
    const ctx=canvas.getContext("2d");
    ctx.imageSmoothingQuality="high";
    const snapshot=document.createElement("canvas");
    snapshot.width=canvas.width;
    snapshot.height=canvas.height;
    const saved=snapshot.getContext("2d");
    const clips=new Map();
    let playing=null,interruptedAt=null,loading=null;
    let thinkingActive=false,loadingThoughts=false,nextThought=0;

    function drawLive(target) {
      if(!stage.hidden) target.drawImage(stage,0,0,canvas.width,canvas.height);
      else if(portrait.complete&&portrait.naturalWidth) target.drawImage(portrait,0,0,canvas.width,canvas.height);
    }
    function remember() {
      saved.clearRect(0,0,snapshot.width,snapshot.height);
      if(canvas.hidden) drawLive(saved);
      else saved.drawImage(canvas,0,0);
    }
    function hide() {
      playing=null;
      interruptedAt=null;
      if(!canvas.hidden) canvas.hidden=true;
      if(frame.dataset.reaction) delete frame.dataset.reaction;
    }
    function announce() {
      if(clips.size) notify(Object.fromEntries([...clips].map(([name,clip])=>[name,clip.duration])));
    }
    function loadSheet(url,width,height) {
      return new Promise((resolve,reject)=>{
        const image=new Image();
        image.fetchPriority="low";
        image.decoding="async";
        image.onload=()=>image.naturalWidth===width&&image.naturalHeight===height?
          resolve(image):reject(new Error("Unexpected reaction atlas dimensions"));
        image.onerror=reject;
        image.src=url;
      });
    }
    async function load(compactAssets) {
      let root=compactAssets?"reaction-art-lite/":"reaction-art/";
      let response=await fetch(root+"manifest.json?v=4");
      if(!response.ok&&compactAssets) {
        root="reaction-art/";
        response=await fetch(root+"manifest.json?v=4");
      }
      if(!response.ok) return;
      const {width,height,columns,rows,version,clips:manifest}=await response.json();
      if(![width,height,columns,rows].every(value=>Number.isSafeInteger(value)&&value>0)||
        width*columns>4096||height*rows>4096||!/^[\w-]{1,24}$/.test(version)) return;
      const capacity=columns*rows;
      const loadClip=async name=>{
        const {duration,count}=manifest?.[name]??{};
        if(!Number.isFinite(duration)||duration<700||duration>3200||
          !Number.isSafeInteger(count)||count<10||count>80) return;
        const sheets=[];
        for(let sheet=1;sheet<=Math.ceil(count/capacity);sheet++) {
          sheets.push(await loadSheet(`${root}${name}-${sheet}.webp?v=${version}`,width*columns,height*rows));
        }
        clips.set(name,{duration,count,sheets,width,height,columns,capacity});
        announce();
      };
      for(const name of touchNames) await loadClip(name).catch(()=>{});
      return loadClip;
    }

    function prepare(compactAssets, thinking) {
      if(!loading) {
        if(compactAssets) {
          canvas.width=canvas.height=snapshot.width=snapshot.height=640;
          ctx.imageSmoothingQuality="medium";
        }
        loading=load(compactAssets).catch(()=>null);
      }
      thinkingActive=thinking;
      if(!thinking||loadingThoughts||nextThought>=thinkingNames.length) return;
      loadingThoughts=true;
      void loading.then(async (loadClip)=>{
        if(!loadClip) nextThought=thinkingNames.length;
        while(thinkingActive&&nextThought<thinkingNames.length) {
          await loadClip(thinkingNames[nextThought++]).catch(()=>{});
        }
      }).finally(()=>{ loadingThoughts=false; });
    }

    function render(reaction,walking) {
      if(walking||!ctx||frame.dataset.framing!=="full") return hide();
      const clip=clips.get(reaction?.name);
      const progress=reaction?.progress;
      const now=performance.now();
      const width=canvas.width,height=canvas.height;
      if(!clip||!Number.isFinite(progress)||progress<0||progress>=1) {
        if(canvas.hidden) return;
        if(playing&&playing.progress*playing.duration>playing.duration-blendTime) return hide();
        if(interruptedAt===null) {
          remember();
          interruptedAt=now;
          playing=null;
        }
        const live=ease((now-interruptedAt)/105);
        if(live>=1) return hide();
        ctx.clearRect(0,0,width,height);
        ctx.globalAlpha=1-live;
        ctx.drawImage(snapshot,0,0);
        ctx.globalCompositeOperation="lighter";
        ctx.globalAlpha=live;
        drawLive(ctx);
      } else {
        const continuing=playing?.name===reaction.name&&progress>=playing.progress;
        if(!continuing) remember();
        interruptedAt=null;
        const elapsed=progress*clip.duration;
        const enter=1-ease(elapsed/blendTime);
        const exit=1-ease((clip.duration-elapsed)/blendTime);
        const index=Math.round(progress*(clip.count-1));
        const opaque=enter===0&&exit===0;
        const theme=window.sakiCallCanvasLightKey?.();
        if(continuing&&opaque&&playing.opaque&&playing.index===index&&playing.theme===theme) {
          playing.progress=progress;
          return true;
        }
        playing={name:reaction.name,progress,duration:clip.duration,index,opaque,theme};
        const cell=index%clip.capacity;
        ctx.clearRect(0,0,width,height);
        if(enter>0) {
          ctx.globalAlpha=enter;
          ctx.drawImage(snapshot,0,0);
        } else if(exit>0) {
          ctx.globalAlpha=exit;
          drawLive(ctx);
        }
        ctx.globalAlpha=1-Math.max(enter,exit);
        ctx.globalCompositeOperation="lighter";
        window.drawSakiCallAtlas(ctx,clip.sheets[Math.floor(index/clip.capacity)],
          (cell%clip.columns)*clip.width,Math.floor(cell/clip.columns)*clip.height,
          clip.width,clip.height);
        if(canvas.hidden) canvas.hidden=false;
        if(frame.dataset.reaction!==reaction.name) frame.dataset.reaction=reaction.name;
      }
      ctx.globalAlpha=1;
      ctx.globalCompositeOperation="source-over";
      return Boolean(playing?.opaque);
    }
    return {announce,prepare,render};
  };
})();
