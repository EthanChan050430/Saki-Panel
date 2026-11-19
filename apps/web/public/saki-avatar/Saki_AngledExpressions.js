(() => {
  "use strict";

  const iris=new Image();
  iris.src="expression-art/iris_redrawn.webp?v=1";
  const blinkArt=new Image();
  blinkArt.src="expression-art/eye_blink_painted.webp?v=1";
  const frontBlinkSkin=new Image();
  frontBlinkSkin.src="expression-art/eye_blink_skin_front.webp?v=1";
  const blinkSizes=[[[409,162],[406,162]],[[394,80],[397,79]]];
  function drawIris(ctx,x,y,width,height,angle=0) {
    if(!iris.complete||!iris.naturalWidth) return false;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    ctx.drawImage(iris,-width*.5,-height*.5,width,height);
    ctx.restore();
    return true;
  }
  window.drawSakiIris=drawIris;

  function drawMouth(ctx, marks, openness, yaw=0, pitch=0) {
    const [lx,ly,rx,ry,bx,by]=marks;
    const centerX=(lx+rx)/2;
    const centerY=(ly+ry)/2;
    const angle=Math.atan2(ry-ly,rx-lx);
    const half=Math.hypot(rx-lx,ry-ly)*(.5+.045*openness);
    const smile=Math.max(1,(by-centerY)*Math.cos(angle)-(bx-centerX)*Math.sin(angle));
    const turn=yaw/30;
    const skew=-half*.15*turn*openness;
    const top=.14*half*openness;
    const bottom=.7*smile+half*1.39*openness*(1+Math.min(0,pitch/30)*.19);
    ctx.save();
    ctx.translate(centerX,centerY);
    ctx.rotate(angle);

    // The reference smile is peach inside, with a shallow shadow under the upper lip.
    const contour=new Path2D();
    contour.moveTo(-half,0);
    contour.bezierCurveTo(-half*.73,-top*.8,half*.67,-top*1.28,half,0);
    contour.bezierCurveTo(half*1.08,bottom*.43,skew+half*.62,bottom,skew,bottom);
    contour.bezierCurveTo(skew-half*.61,bottom,-half*1.04,bottom*.47,-half,0);
    contour.closePath();
    const colors=ctx.createLinearGradient(0,-top-1,0,bottom);
    colors.addColorStop(0,"#ce8b81");
    colors.addColorStop(.31,"#e9aa9d");
    colors.addColorStop(.67,"#f2beaf");
    colors.addColorStop(1,"#f0b9aa");
    ctx.fillStyle=colors;
    ctx.fill(contour);

    ctx.save();
    ctx.clip(contour);
    const shadowX=half*(-.8-.16*turn);
    const corner=ctx.createRadialGradient(shadowX,0,.15,shadowX,0,half*.65);
    corner.addColorStop(0,"rgba(126,56,52,.70)");
    corner.addColorStop(.50,"rgba(160,77,68,.34)");
    corner.addColorStop(1,"rgba(161,79,69,0)");
    ctx.fillStyle=corner;
    ctx.fillRect(-half-1,-top-2,2*half+2,bottom+top+3);
    ctx.restore();

    ctx.strokeStyle="rgba(157,96,84,.56)";
    ctx.lineWidth=half*.054;
    ctx.stroke(contour);
    ctx.beginPath();
    ctx.moveTo(-half,0);
    ctx.bezierCurveTo(-half*.73,-top*.8,half*.67,-top*1.28,half,0);
    ctx.strokeStyle="rgba(119,65,60,.71)";
    ctx.lineWidth=half*.062;
    ctx.lineCap="round";
    ctx.stroke();
    ctx.restore();
  }

  function drawPout(ctx,[lx,ly,rx,ry,bx,by]) {
    const half=Math.hypot(rx-lx,ry-ly)*.33;
    ctx.save();
    ctx.translate((lx+rx+bx*2)/4,(ly+ry+by*2)/4);
    ctx.rotate(Math.atan2(ry-ly,rx-lx));
    ctx.beginPath();
    ctx.moveTo(-half,1);
    ctx.quadraticCurveTo(-half*.17,-half*.46,half,1);
    ctx.lineWidth=Math.max(.7,half*.14);
    ctx.lineCap="round";
    ctx.strokeStyle="rgba(130,76,68,.78)";
    ctx.stroke();
    ctx.restore();
  }

  window.drawSakiMouth=drawMouth;

  function drawPaintedBlink(ctx,side,openness,[x,y,angle,half],front=false) {
    if(!blinkArt.naturalWidth||openness>.81) return false;
    if(front&&frontBlinkSkin.naturalWidth) {
      const scale=.768;
      ctx.drawImage(frontBlinkSkin,96*side,0,96,91,(side?503:406)*scale,187*scale,96*scale,91*scale);
    }
    const shape=openness<.18?1:0;
    const [width,height]=blinkSizes[shape][side];
    const w=half*(shape?2.03:2.42);
    const h=w*height/width*(shape?.69:.46+openness*.72);
    const bottom=half*(shape?.37:.43+openness*.28);
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    ctx.drawImage(blinkArt,side*432,shape*176,width,height,-w*.5,bottom-h,w,h);
    ctx.restore();
    return true;
  }
  window.drawSakiPaintedBlink=drawPaintedBlink;

  function drawClosedLid(ctx, x, y, angle, half, outer) {
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    ctx.beginPath();
    const arc=Math.min(7,half*.36);
    ctx.moveTo(-half,0);
    ctx.quadraticCurveTo(0,arc,half,0);
    ctx.quadraticCurveTo(0,arc-2.8,-half,0);
    ctx.closePath();
    ctx.fillStyle="#57363a";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(outer*(half-1.3),.4);
    ctx.quadraticCurveTo(outer*(half+1),-.3,outer*(half+2.3),-1.7);
    ctx.strokeStyle="#68424a";
    ctx.lineWidth=.85;
    ctx.lineCap="round";
    ctx.stroke();
    ctx.restore();
  }

  window.createSakiAngledExpressions=(manifest,lattice)=>{
    const buffer=document.createElement("canvas");
    buffer.width=lattice.width;
    buffer.height=lattice.cut;
    const paint=buffer.getContext("2d");
    const eyeBuffer=document.createElement("canvas");
    const eyePaint=eyeBuffer.getContext("2d");
    const cache=new Map();

    function texture(name) {
      if(!manifest[name]) return {pending:false,image:null};
      if(cache.has(name)) {
        const entry=cache.get(name);
        cache.delete(name);
        cache.set(name,entry);
        return entry;
      }
      const entry={pending:true,image:null};
      const image=new Image();
      image.onload=()=>{
        entry.image=image;
        entry.pending=false;
      };
      image.onerror=()=>{entry.pending=false;};
      image.src="expression-art/"+name+".webp?v=live-face-2";
      cache.set(name,entry);
      if(cache.size>48) cache.delete(cache.keys().next().value);
      return entry;
    }

    function render(base,asset,name,expression) {
      if(!asset) return base;
      const {eyes,gaze,gazeY,mouth,pout=0,callMode}=expression;
      const marks=manifest[name];
      const [x,y,w,h]=marks;
      const tile=(index,opacity=1)=>{
        paint.globalAlpha=opacity;
        paint.drawImage(asset,index*w,0,w,h,x,y,w,h);
        paint.globalAlpha=1;
      };
      paint.clearRect(0,0,buffer.width,buffer.height);
      paint.drawImage(base,0,0);
      if(marks.length>=28) {
        const split=x+(marks[18]+marks[23])*.5;
        for(let side=0;side<2;side++) {
          const openness=eyes[side];
          if(openness<.91) {
            paint.save();
            paint.beginPath();
            paint.rect(side?split:x,y,side?x+w-split:split-x,h);
            paint.clip();
            if(blinkArt.naturalWidth&&openness<=.81) {
              tile(5);
              drawPaintedBlink(paint,side,openness,marks.slice(10+side*4,14+side*4));
            } else {
              tile(Math.max(0,Math.round((1-openness)*6)-1));
            }
            paint.restore();
          } else if((Math.abs(gaze)+Math.abs(gazeY))>.027&&iris.naturalWidth) {
            eyeBuffer.width=w;
            eyeBuffer.height=h;
            eyePaint.drawImage(asset,(6+side)*w,0,w,h,0,0,w,h);
            eyePaint.globalCompositeOperation="source-atop";
            const [cx,cy,iw,ih,angle]=marks.slice(18+side*5,23+side*5);
            const shiftX=gaze*Math.min(6.2,iw*.19);
            const shiftY=gazeY*Math.min(3.0,ih*.09)+(callMode?ih*.11:0);
            drawIris(eyePaint,cx+shiftX,cy+shiftY,iw,ih*(callMode?1.06:1),angle);
            if(callMode) paint.globalAlpha=Math.min(1,(Math.abs(gaze)+Math.abs(gazeY))/.42);
            paint.drawImage(eyeBuffer,x,y);
            paint.globalAlpha=1;
          }
        }
      } else if(Math.min(...eyes)<.91) {
        tile(Math.max(0,Math.round((1-Math.min(...eyes))*6)-1));
      }
      const cover=mouth>.02?Math.min(1,mouth*8):pout;
      if(cover>.02) tile(8,cover);
      return buffer;
    }

    function drawFeatures(ctx,active,expression) {
      const closed=expression.eyes.map(open=>!blinkArt.naturalWidth&&open<=1/12);
      const pout=expression.pout||0;
      if(!closed.some(Boolean)&&expression.mouth<=.02&&pout<=.02) return;
      const landmarks=Array(14).fill(0);
      let sum=0;
      for(const {name,weight,face} of active) {
        if(!face?.image) continue;
        sum+=weight;
        const pose=manifest[name];
        for(let i=0;i<landmarks.length;i++) landmarks[i]+=pose[i+4]*weight;
      }
      if(!sum) return;
      for(let i=0;i<landmarks.length;i++) landmarks[i]/=sum;
      if(closed[0]) drawClosedLid(ctx,...landmarks.slice(6,10),-1);
      if(closed[1]) drawClosedLid(ctx,...landmarks.slice(10,14),1);
      if(expression.mouth>.02) {
        ctx.globalAlpha=Math.min(1,expression.mouth*8);
        drawMouth(ctx,landmarks,expression.mouth,expression.yaw,expression.pitch);
        ctx.globalAlpha=1;
      } else if(pout>.02) {
        ctx.globalAlpha=pout;
        drawPout(ctx,landmarks);
        ctx.globalAlpha=1;
      }
    }

    return {texture,render,drawFeatures};
  };
})();
