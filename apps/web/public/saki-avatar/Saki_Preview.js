(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const model=JSON.parse($("model").textContent);
  const poses=new Map(model.drawings.map(pose=>[pose.id,pose]));
  const neutral=poses.get("neutral");
  const sprites=new Map();
  const image=$("pose-image");
  const canvas=$("stage");
  const frameEl=$("frame");
  const stageSize=canvas.width;
  let rasterScale=1;
  const ctx=canvas.getContext("2d");
  const legsStage=$("legs-stage");
  const legContext=legsStage.getContext("2d");
  const view=new URLSearchParams(location.search).get("view");
  const callMode=Boolean(document.documentElement.dataset.call);
  if(callMode) canvas.dataset.logicalWidth=stageSize;
  let fullBody=view==="full"||(view===null&&document.documentElement.dataset.live!=="overlay");
  let legRig=null,legDemoAt=null,lastLegFrame="";
  const legRest=[0,0,0,1,1];
  const legMotion=["Left","Right"].map(side=>({
    side,pose:legRest.slice(),target:null,seen:-Infinity,
    ids:["Lift","Knee","Foot"].map(joint=>"ParamLeg"+joint+side),
  }));
  const clipCanvas=document.createElement("canvas");
  const clip=clipCanvas.getContext("2d");
  const controls=new Map();
  const artButtons=new Map();
  let art=poses.get("right-up"), mode="motion";
  let playback=null, blinkAt=-Infinity, previousTime=0;
  let front=null, body=null, lastFrame="", staticBodyPainted=false, nextDraw=0;
  let staticBodyLight="";
  let callPose=null;
  let wave=null, neutralForWave=null;
  const waveStarts=new Map();
  const handSides=["left","right"];
  const tracking=Object.fromEntries(handSides.map(side=>[side,{
    values:null,target:null,lastSeen:-Infinity,amount:0,
  }]));
  let callHands=null,callHandsAt=-Infinity;
  let callTail=null,callPout=0,callSkirtHold=0;
  const tailBuffer=callMode?document.createElement("canvas"):null;
  if(tailBuffer) {
    tailBuffer.width=stageSize;
    tailBuffer.height=540;
  }
  const target={x:0,y:0,z:0}, current={...target};
  const frameAssets=new Map();
  const lattice=model.transition;
  let poseBlend;
  const angledExpressions=model.angledExpressions &&
    window.createSakiAngledExpressions?.(model.angledExpressions,lattice);
  const upperCanvas=document.createElement("canvas");
  upperCanvas.width=lattice.width;
  upperCanvas.height=lattice.cut;
  const upper=upperCanvas.getContext("2d");
  const trackedFace={values:[0,0,0,1,1,0,0,0],target:null,amount:0,lastSeen:-Infinity};
  const centerAngle=lattice.steps/2;
  const frontFeatures=model.angledExpressions?.[centerAngle+"_"+centerAngle];
  const frontMouth=frontFeatures?.slice(4,10);
  const cycle=["neutral","left","left-up","up","right-up","right","right-down","down","left-down"];
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const mix=(a,b,t)=>a+(b-a)*t;
  const callGaze=value=>Math.sign(value)*Math.max(0,Math.abs(value)-.09)/.91;
  const poseSettings=[
    ["ParamAngleX","转头",-30,30,.1],
    ["ParamAngleY","抬头 / 低头",-30,30,.1],
    ["ParamAngleZ","歪头",-15,15,.1],
  ];
  const expressionSettings=[
    ["ParamEyeBallX","视线",-1,1,.01],
    ["ParamMouthOpenY","张嘴",0,1,.01],
    ["ParamHairBack","双马尾摆动",-1,1,.01],
  ];

  function slider(field,[id,label,min,max,step],action) {
    const line=document.createElement("label");
    line.className="parameter";
    const caption=document.createElement("span");
    caption.textContent=label;
    const input=document.createElement("input");
    Object.assign(input,{id,type:"range",min,max,step,value:0});
    const output=document.createElement("output");
    output.htmlFor=id;
    output.textContent="0";
    input.addEventListener("input",action);
    line.append(caption,output,input);
    $(field).append(line);
    controls.set(id,{input,output});
  }
  const read=id=>Number(controls.get(id).input.value);
  function display(id,value) {
    const control=controls.get(id);
    const formatted=String(Math.round(value*10)/10);
    if(control.input.value!==formatted) control.input.value=formatted;
    if(control.output.textContent!==formatted) control.output.textContent=formatted;
  }
  for(const spec of poseSettings) slider("angles",spec,()=> {
    const x=read("ParamAngleX"), y=read("ParamAngleY"), z=read("ParamAngleZ");
    stop();
    moveTo(x,y,x===0&&y===0?z:0);
  });
  for(const spec of expressionSettings) slider("expressions",spec,()=>{
    const {input,output}=controls.get(spec[0]);
    output.textContent=input.value;
  });

  function showFraming() {
    const full=fullBody&&mode==="motion"&&(callMode||Boolean(legRig));
    $("frame").dataset.framing=full?"full":"half";
    $("view-full").setAttribute("aria-pressed",String(fullBody));
    $("view-half").setAttribute("aria-pressed",String(!fullBody));
    $("leg-controls").hidden=!full;
    legsStage.hidden=!full||!legRig;
  }
  for(const framing of ["full","half"]) {
    $("view-"+framing).addEventListener("click",()=>{
      fullBody=framing==="full";
      showFraming();
    });
  }
  function setLegDemo(active) {
    legDemoAt=active?performance.now():null;
    $("legs-demo").setAttribute("aria-pressed",String(active));
  }
  $("legs-demo").addEventListener("click",()=>setLegDemo(legDemoAt===null));
  for(const leg of legMotion) {
    const parent="legs-"+leg.side.toLowerCase();
    const axes=[["抬膝",-38,38],["屈膝",-62,62],["脚踝",-33,33]];
    for(const [i,[label,min,max]] of axes.entries()) {
      const id=leg.ids[i];
      slider(parent,[id,label,min,max,1],()=>{
        display(id,read(id));
        setLegDemo(false);
      });
    }
  }

  function paintLegs(now,elapsed) {
    if(!legRig||legsStage.hidden) return;
    const blend=1-Math.exp(-elapsed/58);
    const poses=legMotion.map((leg,i)=>{
      const sign=i===0?1:-1;
      let pose;
      if(leg.target&&now-leg.seen<260) pose=leg.target;
      else if(legDemoAt!==null) {
        const phase=((now-legDemoAt)/1250+(i===0?0:.5))%1;
        const step=phase<.46?Math.sin(Math.PI*phase/.46)**2:0;
        pose=[sign*10*step,-sign*33*step,sign*12*step,1-.21*step,1-.085*step];
      } else {
        const [lift,knee,foot]=leg.ids.map(read);
        pose=[sign*lift*.63,sign*knee,sign*foot,1-Math.abs(lift)*.0105,1];
      }
      for(let j=0;j<pose.length;j++) {
        const delta=pose[j]-leg.pose[j];
        leg.pose[j]+=Math.abs(delta)<.001?delta:delta*blend;
      }
      return leg.pose.map((value,i)=>{
        const precision=i<3?8:400;
        return Math.round(value*precision)/precision;
      });
    });
    const lighting=callMode?window.sakiCallCanvasLightKey?.()||"":"";
    const key=lighting+":"+poses.map(pose=>pose.join(",")).join(":");
    if(key===lastLegFrame) return;
    lastLegFrame=key;
    legRig(legContext,poses);
    if(lighting) window.paintSakiCallCanvasLight(legContext,legsStage.width,legsStage.height,lighting);
  }

  function paintPose(item) {
    staticBodyPainted=false;
    callPose=null;
    image.src=item.src;
    image.alt="Saki · "+item.label;
    const [scale,x,y]=mode==="motion"?item.fit:[1,0,0];
    image.style.transform="translate("+x*100+"%, "+y*100+"%) scale("+scale+")";
    image.hidden=false;
    canvas.hidden=true;
    lastFrame="";
  }
  function portraitName(x,y,z) {
    const turn=x<-.7?"左转":x>.7?"右转":"";
    const pitch=y<-.7?"低头":y>.7?"抬头":"";
    if(turn&&pitch) return turn+pitch;
    if(turn) return turn+"头";
    if(pitch) return pitch;
    return z<-.6?"左歪头":z>.6?"右歪头":"正面";
  }
  function controlsFor(x,y,z) {
    const isTiltEditable=Math.abs(x)<.05&&Math.abs(y)<.05;
    const tilt=controls.get("ParamAngleZ").input;
    tilt.disabled=!isTiltEditable;
    tilt.title=isTiltEditable?"连续歪头":"组合角度的倾斜来自姿势原画";
    const roll=isTiltEditable?z:5*Math.max(0,x/30)*Math.abs(y/30);
    display("ParamAngleX",x);
    display("ParamAngleY",y);
    display("ParamAngleZ",roll);
    const label=portraitName(x,y,z);
    if($("pose-name").textContent!==label) $("pose-name").textContent=label;
    const frontView=isTiltEditable&&Math.abs(z)<.05&&front;
    const expressionsAvailable=frontView||angledExpressions;
    $("expressions").disabled=!expressionsAvailable;
    $("blink").disabled=!expressionsAvailable;
    controls.get("ParamHairBack").input.disabled=!frontView;
  }
  function moveTo(x,y,z) {
    Object.assign(target,{x,y,z});
    controlsFor(x,y,z);
    if(body && Math.max(Math.abs(x),Math.abs(y),Math.abs(z))>.025) preload(target);
  }
  function stop() {
    if(!playback) return;
    playback=null;
    $("idle").setAttribute("aria-pressed","false");
    controlsFor(target.x,target.y,target.z);
  }
  function segment(index,now) {
    const [x,y]=poses.get(cycle[index]).angles;
    const from={...current};
    if(body) {
      for(let step=1;step<=8;step++) {
        const t=step/8;
        preload({x:from.x+(x-from.x)*t,y:from.y+(y-from.y)*t,z:from.z*(1-t)});
      }
    }
    return {index,start:now,duration:490+Math.hypot(x-from.x,y-from.y)*18,from,to:{x,y,z:0}};
  }
  $("idle").addEventListener("click",()=>{
    if(playback){stop();return;}
    $("idle").setAttribute("aria-pressed","true");
    playback=segment(1,performance.now());
  });
  $("reset").addEventListener("click",()=>{
    stop();
    stopWave();
    blinkAt=-Infinity;
    for(const [id] of expressionSettings) display(id,0);
    for(const leg of legMotion) for(const id of leg.ids) display(id,0);
    setLegDemo(false);
    moveTo(0,0,0);
  });
  $("blink").addEventListener("click",()=>{
    blinkAt=performance.now();
  });
  const waveButtons={left:$("wave-left"),right:$("wave"),both:$("wave-both")};
  const occupied=side=>waveStarts.has(side)||tracking[side].amount>.04;
  for(const [side,button] of Object.entries(waveButtons)) {
    button.addEventListener("click",()=>{
      if(!wave) return;
      const now=performance.now();
      const selected=side==="both"?["right","left"]:[side];
      selected.forEach((hand,i)=>{
        if(!occupied(hand)) waveStarts.set(hand,now+i*120);
      });
      updateWaveButtons();
    });
  }
  document.addEventListener("keydown",event=>{
    if(mode!=="motion"||event.repeat||event.altKey||event.ctrlKey||event.metaKey||
       event.target?.matches?.("textarea,input[type=text],[contenteditable]")) return;
    const hand={KeyJ:"left",KeyK:"both",KeyL:"right"}[event.code];
    if(hand&&!waveButtons[hand].disabled) {
      event.preventDefault();
      waveButtons[hand].click();
    }
  });
  document.addEventListener("saki-tracking",({detail})=>{
    const now=performance.now();
    if(callMode&&Object.hasOwn(detail,"hands")) {
      callHands=detail.hands;
      callHandsAt=now;
      callTail=Array.isArray(detail.tailTouch)?detail.tailTouch:null;
      callPout=clamp(Number(detail.pout)||0,0,1);
      callSkirtHold=clamp(Number(detail.skirtHold)||0,0,1);
    }
    if(Array.isArray(detail.legs)) {
      for(const [index,leg] of legMotion.entries()) {
        leg.target=detail.legs[index]??null;
        leg.seen=leg.target?now:-Infinity;
      }
    }
    for(const side of handSides) {
      if(detail[side]) {
        tracking[side].target=detail[side];
        tracking[side].lastSeen=now;
      }
    }
    if(detail.face) {
      trackedFace.target=detail.face;
      trackedFace.lastSeen=now;
      if(playback) stop();
    } else if(detail.face===null) {
      trackedFace.lastSeen=-Infinity;
    }
  });

  function faceMotion(now,elapsedTime) {
    const face=trackedFace;
    const visible=now-face.lastSeen<450;
    face.amount=mix(face.amount,Number(visible),1-Math.exp(-elapsedTime/(visible?80:147)));
    if(visible) {
      for(let index=0;index<face.values.length;index++) {
        const eye=index===3||index===4;
        const response=eye?(face.target[index]<face.values[index]?14:27):index===7?43:55;
        face.values[index]=mix(face.values[index],face.target[index],1-Math.exp(-elapsedTime/response));
      }
    } else if(face.amount<.01) {
      face.amount=0;
      face.values=[0,0,0,1,1,0,0,0];
    }
    return face.amount;
  }
  function updateWaveButtons() {
    for(const side of handSides) {
      const button=waveButtons[side];
      const disabled=!wave||occupied(side);
      const busy=waveStarts.has(side);
      if(button.disabled!==disabled) button.disabled=disabled;
      if(busy&&!button.hasAttribute("aria-busy")) button.setAttribute("aria-busy","true");
      if(!busy) button.removeAttribute("aria-busy");
    }
    const both=waveButtons.both;
    const disabled=!wave||(occupied("left")&&occupied("right"));
    if(both.disabled!==disabled) both.disabled=disabled;
    if(waveStarts.size===2&&!both.hasAttribute("aria-busy")) both.setAttribute("aria-busy","true");
    if(waveStarts.size!==2) both.removeAttribute("aria-busy");
  }
  function stopWave() {
    waveStarts.clear();
    updateWaveButtons();
  }
  function armMotion(now,elapsedTime) {
    if(!wave) return [];
    const arms=[];
    const speakingHands=now-callHandsAt<180?callHands:null;
    for(const side of handSides) {
      const started=waveStarts.get(side);
      if(started!==undefined && now-started>=wave.duration) waveStarts.delete(side);
      const hand=tracking[side];
      const visible=now-hand.lastSeen<220;
      if(visible) {
        const weight=1-Math.exp(-elapsedTime/39);
        if(hand.values?.length!==hand.target.length) hand.values=hand.target.slice();
        else for(let i=0;i<hand.values.length;i++) {
          hand.values[i]+=(hand.target[i]-hand.values[i])*weight;
        }
      }
      const fade=1-Math.exp(-elapsedTime/(visible?67:93));
      hand.amount+=((visible?1:0)-hand.amount)*fade;
      const spoken=speakingHands?.[side];
      if(waveStarts.has(side)) arms.push({side,time:Math.max(0,now-started)});
      else if(Array.isArray(spoken)&&spoken.length===6&&spoken.every(Number.isFinite)) {
        arms.push({side,spoken,amount:spoken[0],skirtHold:callSkirtHold});
      }
      else if(hand.amount>.012) arms.push({side,values:hand.values,sample:hand.target,amount:hand.amount});
      else if(!visible) hand.values=null;
    }
    updateWaveButtons();
    return arms;
  }
  function paintTouchedTail(tail) {
    if(!tail||Math.abs(tail[1])<.015) return;
    const [side,sway]=tail;
    const top=264, bottom=804, width=stageSize;
    const buffer=tailBuffer.getContext("2d");
    buffer.clearRect(0,0,width,tailBuffer.height);
    buffer.drawImage(canvas,0,top*rasterScale,canvas.width,(bottom-top)*rasterScale,0,0,width,bottom-top);
    // Keep the hair root, shoulder and arm fixed while the hanging lock swings.
    for(let y=top;y<bottom;y+=4) {
      const edge=Math.round(374-Math.max(0,y-392)*.37);
      const x=side>0?width-edge:0;
      const mid=Math.round(edge*(side>0?.47:.53));
      const shift=-side*23*sway*Math.sin(Math.PI*(y-top)/(bottom-top))**1.6;
      ctx.clearRect(x,y,edge,4);
      ctx.drawImage(tailBuffer,x,y-top,mid,4,x,y,mid+shift,4);
      ctx.drawImage(tailBuffer,x+mid,y-top,edge-mid,4,x+mid+shift,y,edge-mid-shift,4);
    }
  }
  function paintArms(arms,tail) {
    // Remove the original sleeves before either moving arm is drawn.
    for(const arm of arms) wave.prepare(ctx,arm);
    paintTouchedTail(tail);
    const face=arms.some(arm=>arm.values)?window.sakiFaceAnchor():null;
    let limits;
    if(arms.some(arm=>arm.spoken)) {
      const box=$("frame").getBoundingClientRect();
      const inset=20,ratio=stageSize/Math.max(1,box.width);
      limits={
        right:Math.max(22,(inset-box.left)*ratio),
        left:Math.max(22,(box.right-innerWidth+inset)*ratio),
      };
    }
    for(const arm of arms) {
      if(arm.spoken) wave.paintConversation(ctx,arm.spoken,arm.side,limits[arm.side],arm.skirtHold);
      else if(arm.values) wave.paintTracked(ctx,arm.values,arm.amount,arm.side,arm.sample,face);
      else wave.paint(ctx,arm.time,arm.side);
    }
  }
  function showArt(item) {
    art=item;
    paintPose(item);
    $("download-art").href=item.src;
    for(const [id,button] of artButtons) button.setAttribute("aria-pressed",String(id===item.id));
  }
  function setMode(next) {
    stop();
    stopWave();
    blinkAt=-Infinity;
    mode=next;
    showFraming();
    const motion=next==="motion";
    $("show-motion").setAttribute("aria-pressed",String(motion));
    $("show-art").setAttribute("aria-pressed",String(!motion));
    $("motion-panel").hidden=!motion;
    $("art-panel").hidden=motion;
    if(motion) {
      paintPose(neutral);
      controlsFor(target.x,target.y,target.z);
    } else showArt(art);
  }
  for(const item of model.drawings) {
    const button=document.createElement("button");
    Object.assign(button,{type:"button",textContent:item.label});
    button.addEventListener("click",()=>showArt(item));
    $("pose-buttons").append(button);
    artButtons.set(item.id,button);
  }
  $("show-motion").addEventListener("click",()=>setMode("motion"));
  $("show-art").addEventListener("click",()=>setMode("art"));
  $("apply-pose").addEventListener("click",()=>{
    const [x,y,z]=art.angles;
    setMode("motion");
    moveTo(x,y,x===0&&y===0?z:0);
  });
  image.addEventListener("error",()=>{
    $("message").textContent="姿势原画无法载入。";
    $("message").hidden=false;
  });
  image.addEventListener("load",()=>$("message").hidden=true);
  if(callMode) {
    image.hidden=true;
    showFraming();
  } else paintPose(neutral);
  controlsFor(0,0,0);

  function load(src) {
    const asset=new Image();
    return new Promise((resolve,reject)=>{
      asset.onload=()=>resolve(asset);
      asset.onerror=()=>reject(new Error("预览素材无法载入"));
      asset.src=src;
    });
  }
  const toStage=value=>(value*model.scale+model.padding)*stageSize/model.canvas;
  function draw(context,id) {
    const part=sprites.get(id);
    context.drawImage(part.asset,...part.at);
  }
  function eyes(side,open,gaze,gazeY) {
    if(open<=.81&&frontFeatures&&window.drawSakiPaintedBlink) {
      const index=side==="R"?0:1;
      ctx.save();
      const scale=stageSize/lattice.width;
      ctx.scale(scale,scale);
      const painted=window.drawSakiPaintedBlink(ctx,index,open,frontFeatures.slice(10+index*4,14+index*4),true);
      ctx.restore();
      if(painted) return;
    }
    const aperture=sprites.get("Sclera_"+side);
    if(open>.005){
      const [x,y]=aperture.at;
      clipCanvas.width=aperture.asset.width;
      clipCanvas.height=aperture.asset.height;
      const source=sprites.get("Iris_"+side);
      const [ix,iy]=source.at;
      const {width,height}=source.asset;
      const moving=Math.abs(gaze)+Math.abs(gazeY)>.027;
      if(!moving||!window.drawSakiIris?.(clip,ix-x+width*.5+gaze*6.1,
          iy-y+height*(callMode ? .56 : .51)+gazeY*3.45,width*.98,height*1.03)) {
        clip.save();
        clip.translate(-x,-y);
        for(const name of ["Iris_","Pupil_","EyeGlint_"]) draw(clip,name+side);
        clip.restore();
      }
      clip.globalCompositeOperation="destination-in";
      clip.drawImage(aperture.asset,0,0);
      clip.globalCompositeOperation="source-over";
      const cy=toStage(side==="R"?282:280);
      ctx.save();
      ctx.globalAlpha=clamp(open*4,0,1);
      ctx.translate(0,cy);
      ctx.scale(1,open);
      ctx.translate(0,-cy);
      draw(ctx,aperture.id);
      ctx.drawImage(clipCanvas,x,y);
      draw(ctx,"LashUpper_"+side);
      draw(ctx,"LashLower_"+side);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha=clamp(1-open*4,0,1);
    draw(ctx,"LashClosed_"+side);
    ctx.restore();
  }
  function mouth(openness) {
    const open=openness>.02&&frontMouth&&window.drawSakiMouth;
    const opacity=open?clamp(openness*8,0,1):0;
    ctx.save();
    if(opacity<1) {
      ctx.globalAlpha=1-opacity;
      draw(ctx,"MouthClosed");
    }
    if(open) {
      ctx.globalAlpha=opacity;
      const scale=stageSize/lattice.width;
      ctx.scale(scale,scale);
      window.drawSakiMouth(ctx,frontMouth,openness);
    }
    ctx.restore();
  }
  function tails(sway) {
    for(const id of model.front.tails) {
      const [x,y]=sprites.get(id).pivot.map(toStage);
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(sway*Math.PI/100);
      ctx.translate(-x,-y);
      draw(ctx,id);
      ctx.restore();
    }
  }
  function cachedFrame(name) {
    if(frameAssets.has(name)){
      const item=frameAssets.get(name);
      frameAssets.delete(name);
      frameAssets.set(name,item);
      return item;
    }
    const entry={image:null};
    frameAssets.set(name,entry);
    load(lattice.folder+name+".webp?v=clear-turn-1").then(asset=>{
      entry.image=asset;
      if(!callMode) angledExpressions?.texture(name);
    }).catch(()=>{
      $("message").textContent="过渡帧无法载入。请将 transition-frames 文件夹与预览页放在一起。";
      $("message").hidden=false;
    });
    const limit=callMode&&document.documentElement.dataset.callQuality!=="full"?24:68;
    while(frameAssets.size>limit) frameAssets.delete(frameAssets.keys().next().value);
    return entry;
  }
  function track(position) {
    const value=clamp(position,0,lattice.steps);
    const i=Math.floor(value), t=value-i;
    return t<.001?[[i,1]]:[[i,1-t],[i+1,t]];
  }
  function stencil(angles) {
    const {x,y,z}=angles;
    const pitch=(30-y)*lattice.steps/60, yaw=(x+30)*lattice.steps/60;
    const zWeight=Math.abs(z)<.035?0:clamp(1-Math.hypot(x,y)/3,0,1);
    const slots=[];
    const side=lattice.steps+1;
    if(zWeight<1){
      for(const [a,ax] of track(yaw))
        for(const [b,bx] of track(pitch))
          slots.push({name:a+"_"+b,weight:ax*bx*(1-zWeight),index:b*side+a,dx:yaw-a,dy:pitch-b});
    }
    if(zWeight>0) {
      const roll=(z+15)*lattice.steps/30;
      for(const [a,w] of track(roll))
        slots.push({name:"t"+a,weight:w*zWeight,index:side*side+a,dx:roll-a,dy:0});
    }
    return slots.filter(({weight})=>weight>.002);
  }
  function preload(angles) {
    for(const {name} of stencil(angles)) cachedFrame(name);
  }
  // Nose tips measured on the nine source paintings, from looking up to down.
  const noseGrid=[
    [[294,184],[385,159],[453,175]],
    [[313,214],[385,213],[461,203]],
    [[307,235],[385,246],[461,233]],
  ];
  function nosePoint(name) {
    if(name.startsWith("t")) {
      const tilt=(Number(name.slice(1))-12)/12;
      return [385+tilt*13,213+Math.abs(tilt)*2];
    }
    const [yaw,pitch]=name.split("_").map(value=>Number(value)/12);
    const col=Math.min(1,Math.floor(yaw)),row=Math.min(1,Math.floor(pitch));
    return noseGrid[row][col].map((_,i)=>mix(
      mix(noseGrid[row][col][i],noseGrid[row][col+1][i],yaw-col),
      mix(noseGrid[row+1][col][i],noseGrid[row+1][col+1][i],yaw-col),pitch-row));
  }
  window.sakiFaceAnchor=()=>{
    const roll=callPose?.roll??(trackedFace.amount?trackedFace.values[2]*trackedFace.amount:0);
    const angles=trackedFace.amount?{...current,z:0}:current;
    let total=0,x=0,y=0,span=0;
    const features=Array.from({length:4},()=>[0,0]);
    for(const {name,weight} of callPose?.slots??stencil(angles)) {
      const marks=model.angledExpressions?.[name];
      if(!marks) continue;
      total+=weight;
      x+=(marks[10]+marks[14])*.5*weight;
      y+=((marks[11]+marks[15])*.5+1.5)*weight;
      span+=(Math.hypot(marks[10]-marks[14],marks[11]-marks[15])+marks[13]+marks[17])*weight;
      [nosePoint(name),[(marks[4]+marks[6])*.5,(marks[5]+marks[7])*.5],
        [marks[10],marks[11]],[marks[14],marks[15]]].forEach(([fx,fy],index)=>{
        features[index][0]+=fx*weight;
        features[index][1]+=fy*weight;
      });
    }
    if(!total) return {x:500,y:241,span:161};
    const angle=roll*Math.PI/180;
    const scale=1000/lattice.width;
    const pivot=lattice.width*.5;
    const project=([fx,fy])=>{
      const dx=fx/total-pivot,dy=fy/total-267;
      return {x:(pivot+dx*Math.cos(angle)-dy*Math.sin(angle))*scale,
        y:(267+dx*Math.sin(angle)+dy*Math.cos(angle))*scale};
    };
    return {
      ...project([x,y]),
      span:span/total*scale,
      features:features.map(project),
    };
  };
  function showTransition(now,arms,expression,{roll,hasFace,tail,coarseMesh,lighting,angleKey,frameKey}) {
    if(!body) return false;
    const slots=stencil(hasFace?{...current,z:0}:current).map(pose=>({
      ...pose,base:cachedFrame(pose.name).image,
    }));
    let pose={slots,angleKey,roll,yaw:current.x,pitch:current.y};
    if(slots.some(slot=>!slot.base)) {
      // Keep the painted pose while a new angle loads, but keep animating its face.
      if(!callPose) return false;
      pose=callPose;
    }
    const {yaw,pitch}=pose;
    expression={...expression,yaw,pitch};
    const useExpressions=angledExpressions&&
      (Math.min(...expression.eyes)<.91||Math.abs(expression.gaze)+Math.abs(expression.gazeY)>.027||expression.mouth>.02||expression.pout>.02);
    const active=pose.slots.map(slot=>({
      ...slot,face:useExpressions?angledExpressions.texture(slot.name):null,
    }));
    if(!callMode&&active.some(item=>item.face?.pending)) return false;
    if(!poseBlend&&window.sakiTransitionMotion) poseBlend=window.createSakiPoseBlend?.(window.sakiTransitionMotion,lattice);
    const key=pose.angleKey+":"+frameKey+":"+Number(Boolean(poseBlend))+":"+active.map(item=>Number(Boolean(item.face?.image))).join("");
    if(key===lastFrame) return true;
    if(callMode) callPose=pose;
    const total=active.reduce((sum,item)=>sum+item.weight,0);
    const size=stageSize, seam=Math.round(lattice.cut*size/lattice.width);
    const staticBody=callMode&&!arms.length&&!tail&&!playback;
    const keepBody=staticBody&&staticBodyPainted&&staticBodyLight===lighting;
    ctx.save();
    ctx.clearRect(0,0,size,keepBody?seam:size);
    if(playback) {
      // Move the complete drawing together for a subtle breathing beat.
      const breath=1+.003*Math.sin(now/650);
      ctx.translate(size*.5,size*.83);
      ctx.scale(breath,breath);
      ctx.translate(-size*.5,-size*.83);
    }
    if(!keepBody) ctx.drawImage(body,0,lattice.cut,lattice.width,lattice.width-lattice.cut,0,seam,size,size-seam);
    staticBodyPainted=staticBody;
    staticBodyLight=lighting;
    const rotating=poseBlend&&Math.abs(pose.roll)>=(coarseMesh ? .38 : .08);
    const top=rotating?upper:ctx;
    if(rotating) {
      top.globalAlpha=1;
      top.clearRect(0,0,lattice.width,lattice.cut);
    }
    top.globalCompositeOperation="lighter";
    for(const pose of active){
      const {base,weight,name,face}=pose;
      top.globalAlpha=weight/total;
      const asset=face?.image?angledExpressions.render(base,face.image,name,expression):base;
      top.drawImage(poseBlend?poseBlend.warp(asset,pose,coarseMesh):asset,0,0,
        rotating?lattice.width:size,rotating?lattice.cut:seam);
    }
    top.globalAlpha=1;
    top.globalCompositeOperation="source-over";
    if(useExpressions) {
      top.save();
      if(!rotating) top.scale(size/lattice.width,seam/lattice.cut);
      angledExpressions.drawFeatures(top,active,expression);
      top.restore();
    }
    if(rotating) ctx.drawImage(poseBlend.roll(upperCanvas,pose.roll,coarseMesh),0,0,size,seam);
    paintArms(arms,tail);
    if(lighting) window.paintSakiCallCanvasLight(ctx,size,keepBody?seam:size,lighting);
    ctx.restore();
    canvas.hidden=false;
    image.hidden=true;
    lastFrame=key;
    return true;
  }
  function advancePlayback(now) {
    if(!playback)return;
    const playing=playback;
    if(playing.pauseUntil) {
      if(now<playing.pauseUntil)return;
      playback=segment((playing.index+1)%cycle.length,now);
      return;
    }
    const t=clamp((now-playing.start)/playing.duration,0,1);
    const s=(1-Math.cos(Math.PI*t))*.5;
    for(const axis of ["x","y","z"]){
      const value=playing.from[axis]*(1-s)+playing.to[axis]*s;
      current[axis]=target[axis]=value;
    }
    controlsFor(target.x,target.y,target.z);
    if(t===1){
      playing.pauseUntil=now+(playing.index===0?430:100);
      if(playing.index===0) blinkAt=now+80;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if(callMode&&document.hidden) return;
    const quality=callMode?document.documentElement.dataset.callQuality:null;
    if(callMode) {
      if(now+1<nextDraw) return;
      const interval=1000/(quality==="lite"?20:quality==="balanced"?24:30);
      nextDraw=Math.max(now+interval*.5,nextDraw+interval);
    }
    const elapsedTime=Math.min(callMode?80:45,now-(previousTime||now));
    previousTime=now;
    if(mode==="motion") {
      const hadFace=trackedFace.amount>0;
      const confidence=faceMotion(now,elapsedTime);
      const [yaw,pitch,roll,eyeRight,eyeLeft,lookX,lookY,jaw]=trackedFace.values;
      const trackedRoll=roll*confidence;
      if(playback&&!confidence) advancePlayback(now);
      else {
        const amount=1-Math.exp(-elapsedTime/54);
        const next={x:mix(target.x,yaw,confidence),y:mix(target.y,pitch,confidence),z:target.z*(1-confidence)};
        for(const axis of ["x","y","z"]){
          const delta=next[axis]-current[axis];
          current[axis]+=Math.abs(delta)<.024?delta:delta*amount;
        }
      }
      if(confidence) {
        const label=portraitName(current.x,current.y,trackedRoll);
        if($("pose-name").textContent!==label) $("pose-name").textContent=label;
      } else if(hadFace) {
        controlsFor(target.x,target.y,target.z);
      }
      if(callMode&&frameEl.hasAttribute("data-live-covered")) return;
      if(callMode) {
        const scale=quality==="lite" ? .64 : quality==="balanced" ? .8 : 1;
        if(scale!==rasterScale) {
          const nextSize=Math.round(stageSize*scale);
          let previous;
          if(!canvas.hidden) {
            previous=document.createElement("canvas");
            previous.width=previous.height=nextSize;
            previous.getContext("2d").drawImage(canvas,0,0,nextSize,nextSize);
          }
          rasterScale=scale;
          canvas.width=canvas.height=nextSize;
          if(previous) ctx.drawImage(previous,0,0);
          ctx.setTransform(scale,0,0,scale,0,0);
          staticBodyPainted=false;
          lastFrame="";
        }
      }
      paintLegs(now,elapsedTime);
      const arms=armMotion(now,elapsedTime);
      const tail=now-callHandsAt<180?callTail:null;
      const pout=now-callHandsAt<180?callPout:0;
      const waveKey=(arms.length?":arms"+Math.floor(now/15):"")+
        (tail?":tail"+tail[0]+","+Math.round(tail[1]*80):"");
      const centered=Math.max(Math.abs(current.x),Math.abs(current.y),Math.abs(confidence?trackedRoll:current.z))<.08;
      const elapsed=now-blinkAt;
      const open=elapsed>=0&&elapsed<260?1-Math.sin(Math.PI*elapsed/260)**1.18:1;
      const blinking=[Math.min(open,mix(1,eyeRight,confidence)),Math.min(open,mix(1,eyeLeft,confidence))];
      const rawGaze=mix(read("ParamEyeBallX"),lookX,confidence),rawGazeY=lookY*confidence;
      const gaze=callMode?callGaze(rawGaze):rawGaze,gazeY=callMode?callGaze(rawGazeY):rawGazeY;
      const openness=mix(read("ParamMouthOpenY"),jaw,confidence);
      const expression={eyes:blinking,gaze,gazeY,mouth:openness,pout,yaw:current.x,pitch:current.y,callMode};
      const lighting=callMode?window.sakiCallCanvasLightKey?.()||"":"";
      const emotionPrecision=quality==="lite"?30:quality==="balanced"?50:100;
      const emotionKey=[...blinking,gaze,gazeY,openness].map(v=>Math.round(v*emotionPrecision)).join(",");
      if(callPose||!centered||pout>.02){
        const anglePrecision=quality==="lite"?2:quality==="balanced"?4:quality==="full"?8:20;
        const angleKey=[current.x,current.y,confidence?trackedRoll:current.z].map(v=>Math.round(v*anglePrecision)).join(",");
        const frameKey=quality+":"+lighting+":"+emotionKey+","+Math.round(pout*emotionPrecision)+(playback?":"+Math.floor(now/40):"")+waveKey;
        if(showTransition(now,arms,expression,{
          roll:trackedRoll,hasFace:confidence>0,tail,coarseMesh:callMode&&quality!=="full",lighting,angleKey,frameKey,
        })) return;
        if(!callMode) return;
      }
      if(front) {
        const sway=read("ParamHairBack");
        const rest=emotionKey===emotionPrecision+","+emotionPrecision+",0,0,0"&&sway===0;
        const key=lighting+":"+emotionKey+","+Math.round(sway*100)+waveKey;
        if(key!==lastFrame) {
          if(rest&&!arms.length&&!tail&&!lighting&&!callMode) paintPose(neutral);
          else {
            staticBodyPainted=false;
            ctx.clearRect(0,0,stageSize,stageSize);
            if(arms.length && rest && neutralForWave) {
              ctx.drawImage(neutralForWave,0,0,stageSize,stageSize);
            } else {
              tails(sway);
              ctx.drawImage(front.body,0,0);
              eyes("R",blinking[0],gaze,gazeY);
              eyes("L",blinking[1],gaze,gazeY);
              mouth(openness);
              ctx.drawImage(front.overlay,0,0);
            }
            paintArms(arms,tail);
            if(lighting) window.paintSakiCallCanvasLight(ctx,stageSize,stageSize,lighting);
            canvas.hidden=false;
            image.hidden=true;
          }
          lastFrame=key;
        }
      }
    }
  }
  const loadWave=()=>Promise.all([window.createSakiWave(),callMode?null:load(neutral.src)]).then(([gesture,portrait])=>{
    wave=gesture;
    neutralForWave=portrait;
    stopWave();
  }).catch(()=>{
    for(const button of Object.values(waveButtons)) button.title="挥手素材无法载入";
  });
  if(!callMode) void loadWave();
  window.createSakiLegRig().then(rig=>{
    legRig=rig;
    legRig(legContext,legMotion.map(leg=>leg.pose));
    showFraming();
  }).catch(error=>{
    $("view-full").disabled=true;
    $("message").textContent=error.message;
    $("message").hidden=false;
    showFraming();
  });
  load(lattice.folder+"body.webp").then(sheet=>{
    body=sheet;
    const center=lattice.steps/2;
    if(!callMode) {
      for(const step of [center-1,center,center+1]) {
        cachedFrame(step+"_"+center);
        cachedFrame(center+"_"+step);
        cachedFrame("t"+step);
      }
    }
  }).catch(()=>{
    $("message").textContent="动作素材无法载入。";
    $("message").hidden=false;
  });
  if(callMode) requestAnimationFrame(frame);
  Promise.all([
    load(model.front.body),load(model.front.overlay),
    Promise.all(model.front.parts.map(async part=>({...part,asset:await load(part.src)}))),
  ]).then(([body,overlay,parts])=>{
    front={body,overlay};
    for(const part of parts) sprites.set(part.id,part);
    controlsFor(target.x,target.y,target.z);
    if(callMode) setTimeout(loadWave,1600);
    else requestAnimationFrame(frame);
  }).catch(()=>{
    $("message").textContent="正面表情素材无法载入。";
    $("message").hidden=false;
  });
})();
