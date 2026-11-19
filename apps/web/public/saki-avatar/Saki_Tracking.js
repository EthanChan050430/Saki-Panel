(() => {
  "use strict";
  if(!window.publishSakiTracking) return;
  const video=document.getElementById("tracking-camera");
  const preview=document.getElementById("camera-preview");
  const boxes=document.getElementById("tracking-boxes");
  const feedback=boxes.getContext("2d");
  const calibrate=document.getElementById("face-calibrate");
  const faceStatus=document.getElementById("face-tracking-status");
  const legStatus=document.getElementById("leg-tracking-status");
  const toggle=document.getElementById("tracking-toggle");
  const status=document.getElementById("tracking-status");
  const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  const arms=window.createSakiArmTracking();
  const retryableCameraErrors=new Set(["AbortError","NotReadableError","OverconstrainedError"]);
  const cameraErrors={
    AbortError:"摄像头启动超时。请重新插拔摄像头，再开启手势跟踪。",
    NotReadableError:"无法读取摄像头。请关闭可能正在使用摄像头的软件后重试。",
    NotAllowedError:"摄像头权限未开启。请在浏览器允许此网页使用摄像头。",
    NotFoundError:"没有检测到摄像头。请连接摄像头后重试。",
    OverconstrainedError:"摄像头不支持当前的采集模式。",
    SecurityError:"当前浏览器限制了摄像头访问。请在 Edge 或 Chrome 打开直播控制页。",
  };
  let media=null,worker=null,timer=null,staged=false,processing=false,lastVideoTime=-1;
  let faceAvailable=false,faceNeutral=null,faceSamples=[],faceSampleUntil=0;
  const eyeState=Array.from({length:2},()=>({open:1,closed:false,holdUntil:0}));
  const palmRing=[0,1,5,9,13,17];
  const fingerBases=[1,5,9,13,17];
  const restingHands={right:null,left:null,legs:[null,null]};

  function setFaceStatus(label) {
    if(faceStatus.textContent!==label) faceStatus.textContent=label;
  }

  function resetCalibration() {
    faceNeutral=null;
    faceSamples=[];
    faceSampleUntil=0;
    for(const state of eyeState) Object.assign(state,{open:1,closed:false,holdUntil:0});
    setFaceStatus("请看向镜头，保持正面。");
  }

  function eyeCovered(eye,hands,aspect) {
    if(!eye?.span) return false;
    const x=eye.x*aspect,y=eye.y;
    for(const hand of hands) {
      const points=hand.map(p=>({x:p.x*aspect,y:p.y}));
      let inside=false;
      for(const [i,id] of palmRing.entries()) {
        const a=points[id],b=points[palmRing[(i+1)%palmRing.length]];
        if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;
      }
      if(inside) return true;
      // Individual fingers can cover an eye when the palm is elsewhere.
      const thickness=Math.hypot(points[5].x-points[17].x,points[5].y-points[17].y)*.135;
      for(const base of fingerBases) for(let j=0;j<3;j++) {
        const a=points[base+j],b=points[base+j+1];
        const dx=b.x-a.x,dy=b.y-a.y;
        const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.000001,dx*dx+dy*dy),0,1);
        if(Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<thickness) return true;
      }
    }
    return false;
  }

  function eyeOpening(head,hands,aspect,index,now) {
    const state=eyeState[index],lid=head.lids?.[index];
    if(eyeCovered(lid,hands,aspect)) return state.open;
    const score=head.values[3+index]-Math.min(.24,faceNeutral.values[3+index]);
    const calibrated=faceNeutral.apertures[index];
    const ratio=calibrated&&lid?lid.aperture/calibrated:1;
    const blend=1-clamp((score-.09)/.53,0,1);
    const geometry=clamp((ratio-.24)/.56,0,1);
    const hasLid=Boolean(lid&&calibrated);
    const nearFront=Math.abs(head.values[0]-faceNeutral.values[0])<27&&
      Math.abs(head.values[1]-faceNeutral.values[1])<27;
    let open=hasLid ? .74*blend+.26*geometry : blend;
    if(score>=.61||(hasLid&&ratio<.37&&(score>.18||(nearFront&&ratio<.23)))) open=0;
    if(open<.17&&!state.closed) state.holdUntil=now+65;
    state.closed=open<.24;
    state.open=now<state.holdUntil?0:open>.95?1:open;
    return state.open;
  }

  function faceValues(head,hands=[],aspect=1) {
    if(!head) {
      if(faceAvailable) setFaceStatus("让脸进入摄像头画面。");
      return null;
    }
    const values=head.values;
    if(!values.every(Number.isFinite)) return null;
    const now=performance.now();
    if(!faceNeutral) {
      setFaceStatus("正在校准正面，请看向镜头。");
      if(!faceSampleUntil) faceSampleUntil=now+440;
      const sample=values.slice();
      const apertures=eyeState.map((_,i)=>{
        const lid=head.lids?.[i];
        if(values[3+i]>=.35||eyeCovered(lid,hands,aspect)) {
          sample[3+i]=null;
          return null;
        }
        return lid?.aperture;
      });
      faceSamples.push({values:sample,apertures});
      if(now<faceSampleUntil||faceSamples.length<4) return null;
      const median=entries=>{
        const order=entries.filter(Number.isFinite).sort((a,b)=>a-b);
        return order[Math.floor(order.length/2)];
      };
      faceNeutral={values:values.map((_,i)=>median(faceSamples.map(sample=>sample.values[i]))??0),
        apertures:eyeState.map((_,i)=>median(faceSamples.map(sample=>sample.apertures[i])))};
      faceSamples=[];
    }
    setFaceStatus("已跟踪头部、眼睛和嘴巴");
    const delta=i=>values[i]-faceNeutral.values[i];
    const trim=(value,threshold)=>Math.sign(value)*Math.max(0,Math.abs(value)-threshold);
    return [
      clamp(trim(delta(0),1.1)*1.19,-30,30),
      clamp(trim(delta(1),1.0)*1.19,-30,30),
      clamp(trim(delta(2),1.2),-15,15),
      // Use the same screen sides as the mirrored camera preview.
      eyeOpening(head,hands,aspect,1,now),eyeOpening(head,hands,aspect,0,now),
      clamp(trim(delta(5),.045)*2.25,-1,1),
      clamp(trim(delta(6),.060)*1.9,-1,1),
      clamp((values[7]-Math.min(.12,faceNeutral.values[7]+.024))*2.7,0,1),
    ].map(value=>Math.round(value*1000)/1000);
  }

  function drawBounds(head,hands) {
    feedback.clearRect(0,0,boxes.width,boxes.height);
    if(!preview.clientWidth) return;
    const px=boxes.width/preview.clientWidth;
    feedback.font=`${11*px}px system-ui, sans-serif`;
    feedback.lineWidth=1.35*px;
    const paint=(bounds,color,label,pad)=>{
      const x=clamp(1-bounds[2]-pad,0,1)*boxes.width;
      const y=clamp(bounds[1]-pad,0,1)*boxes.height;
      const w=clamp(1-bounds[0]+pad,0,1)*boxes.width-x;
      const h=clamp(bounds[3]+pad,0,1)*boxes.height-y;
      feedback.strokeStyle=color;
      feedback.strokeRect(x,y,w,h);
      const tagY=y<15*px?y:y-15*px;
      feedback.fillStyle=color;
      feedback.fillRect(x,tagY,feedback.measureText(label).width+8*px,15*px);
      feedback.fillStyle="#211d26";
      feedback.fillText(label,x+4*px,tagY+11.5*px);
    };
    if(head) paint(head.bounds,"#9cf5da","脸部",.025);
    for(const hand of hands) {
      const xs=hand.map(point=>point.x),ys=hand.map(point=>point.y);
      paint([Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],"#ffd09b","手部",.023);
    }
  }

  function stop(message="让肩膀、手肘和双手进入画面。") {
    clearTimeout(timer);
    worker?.terminate();
    worker=null;
    media?.getTracks().forEach(track=>track.stop());
    media=null;
    video.srcObject=null;
    preview.hidden=true;
    calibrate.hidden=true;
    faceStatus.hidden=true;
    legStatus.hidden=true;
    faceAvailable=false;
    resetCalibration();
    feedback.clearRect(0,0,boxes.width,boxes.height);
    processing=false;
    staged=false;
    lastVideoTime=-1;
    arms.reset();
    toggle.disabled=false;
    toggle.textContent="开启手势跟踪";
    status.textContent=message;
    window.publishSakiTracking({...restingHands,face:null});
  }

  async function capture() {
    if(!worker || !staged) return;
    if(!processing && video.readyState>=2 && video.currentTime!==lastVideoTime) {
      processing=true;
      lastVideoTime=video.currentTime;
      const runningWorker=worker;
      try {
        const width=Math.min(512,video.videoWidth);
        const image=await createImageBitmap(video,{
          resizeWidth:width,resizeHeight:Math.round(video.videoHeight*width/video.videoWidth),
        });
        if(worker!==runningWorker) {
          image.close();
          return;
        }
        worker.postMessage({image,timestamp:performance.now()},[image]);
      } catch {
        stop("无法读取摄像头画面。");
        return;
      }
    }
    timer=setTimeout(capture,16);
  }

  async function openCamera() {
    const settings={width:{ideal:640,max:640},height:{ideal:480,max:480},frameRate:{ideal:30}};
    try {
      return await navigator.mediaDevices.getUserMedia({audio:false,video:settings});
    } catch(error) {
      if(!retryableCameraErrors.has(error.name)) throw error;
      console.warn("Saki camera retry",error.name,error.message);
      status.textContent="正在尝试摄像头的默认模式…";
      return navigator.mediaDevices.getUserMedia({audio:false,video:true});
    }
  }

  async function start() {
    if(!navigator.mediaDevices?.getUserMedia) {
      status.textContent="当前页面无法调用摄像头。请在 Edge 或 Chrome 打开本机直播控制页。";
      return;
    }
    toggle.disabled=true;
    status.textContent="正在启动摄像头…";
    try {
      media=await openCamera();
      for(const track of media.getVideoTracks()) track.addEventListener("ended",()=>stop("摄像头连接已断开。"),{once:true});
      video.srcObject=media;
      await video.play();
      boxes.width=video.videoWidth;
      boxes.height=video.videoHeight;
      preview.style.setProperty("--camera-aspect",boxes.width/boxes.height);
      preview.hidden=false;
    } catch(error) {
      console.warn("Saki camera start",error.name,error.message);
      stop(cameraErrors[error.name]||"摄像头无法启动。");
      return;
    }
    try {
      status.textContent="加载本机动作跟踪…";
      worker=new Worker("Saki_TrackingWorker.js?v=full-body-2");
      worker.onerror=()=>stop("手势跟踪启动失败。你仍可使用手动挥手。");
      worker.onmessage=({data})=>{
        if(data.type==="ready") {
          staged=true;
          faceAvailable=data.faceAvailable;
          calibrate.hidden=!faceAvailable;
          faceStatus.hidden=false;
          setFaceStatus(faceAvailable?"让脸进入摄像头画面。":"人脸跟踪未能加载，仍可跟踪双手。");
          toggle.disabled=false;
          toggle.textContent="关闭手势跟踪";
          status.textContent="正在寻找双手…";
          capture();
        } else if(data.type==="landmarks") {
          const hands=arms.read(data);
          const legs=window.readSakiLegs(data);
          drawBounds(data.head,data.hands);
          window.publishSakiTracking({...hands,legs,face:faceValues(data.head,data.hands,data.aspect)});
          const seen=Number(Boolean(hands?.right))+Number(Boolean(hands?.left));
          const label=seen===2?"已跟踪双手":seen===1?"已跟踪一只手":"让肩膀、手肘和双手进入画面。";
          if(status.textContent!==label) status.textContent=label;
          const legCount=legs.filter(Boolean).length;
          legStatus.hidden=document.getElementById("frame").dataset.framing!=="full";
          const legLabel=legCount===2?"已跟踪双腿":legCount===1?"已跟踪一条腿":"腿部跟踪需要拍到髋、膝和脚踝。";
          if(legStatus.textContent!==legLabel) legStatus.textContent=legLabel;
          processing=false;
        } else if(data.type==="face-error") {
          faceAvailable=false;
          calibrate.hidden=true;
          setFaceStatus("人脸跟踪已停止，仍可跟踪双手。");
        } else if(data.type==="error") {
          console.error("Saki hand tracking",data.message);
          stop("手势跟踪启动失败。你仍可使用手动挥手。");
        }
      };
    } catch(error) {
      console.error("Saki hand tracking",error);
      stop("手势跟踪启动失败。你仍可使用手动挥手。");
    }
  }
  calibrate.addEventListener("click",resetCalibration);
  toggle.addEventListener("click",()=>media?stop():start());
  window.addEventListener("pagehide",()=>{if(media) stop();});
})();
