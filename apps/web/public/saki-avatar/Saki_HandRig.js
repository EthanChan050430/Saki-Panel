(() => {
  "use strict";

  const digitStarts=[1,5,9,13,17];
  const roots=[[699,985],[631,665],[497,644],[363,663],[242,729]];
  const digitWidths=[10.8,8.8,8.5,8.2,7.2];
  const phalanges=[[.32,.31,.28],[.40,.30,.23],[.44,.32,.25],[.40,.29,.23],[.32,.23,.20]];
  const tile=192;
  // Each painted frame records its pivot, root width and tip offset within the atlas tile.
  const [backFrames,edgeFrames,palmFrames,shortFrames]=[
    [[24.7,177.2,36.4,0,168.8,168.8],[28.1,176.4,39.6,59.1,166.8,189],
      [33,173.5,51.4,121.3,139.8,254.5],[34.8,174,52,48.4,91.5,228.5],
      [32,176.3,42.4,45.7,166.9,177.3],[36.8,172.8,57.3,122.7,132.3,240]],
    [[23.4,178.2,31.9,2.1,171,171],[23.9,177.8,33.6,55.1,170.5,187],
      [29.7,174.6,46.8,131.4,150.9,263.8],[30.5,174.8,46.3,79.1,59.6,270.4],
      [31.3,175.5,41.8,72.1,167.6,190.1],[36.9,172.6,53.4,131.1,139,245.4]],
    [[43.7,172.3,56.6,-2.9,165.5,165.6],[35.1,172,57.5,5.2,165.3,165.4],
      [40.6,171.9,58,-.8,165.9,165.9],[42.6,172.2,56.8,-6,165.5,165.6],
      [40.1,172.8,54.1,-3.7,166.1,166.2]],
    [[61.9,167.3,74.5,51.2,86.8,184.5],[72.3,158.2,104.2,-1.9,142.8,153.5],
      [63,157,110.5,30.3,17.4,259.7]],
  ].map((frames,row)=>frames.map(([x,y,width,tipX,tipY,length],column)=>
    ({x,y,width,tipX,tipY,length,sx:column*tile,sy:row*tile})));
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const add=(p,q)=>({x:p.x+q.x,y:p.y+q.y});
  const subtract=(p,q)=>({x:p.x-q.x,y:p.y-q.y});
  const scale=(p,s)=>({x:p.x*s,y:p.y*s});
  const dot=(p,q)=>p.x*q.x+p.y*q.y;
  const unit=(v,fallback)=> {
    const length=Math.hypot(v.x,v.y);
    return length>.05?scale(v,1/length):fallback;
  };
  const normal=p=>({x:-p.y,y:p.x});
  const angleOf=p=>Math.atan2(p.y,p.x);
  const direction=angle=>({x:Math.cos(angle),y:Math.sin(angle)});
  const angleDelta=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const projection=(a,b,from,to)=>(
    (b.x-a.x)*(to.x-from.x)+(b.y-a.y)*(to.y-from.y)+(b.z-a.z)*(to.z-from.z)
  )/Math.max(1,distance(from,to));

  window.createSakiHandRig=(images,wristSkin)=>{
    const {palm,back,peace,backPeace,thumb,fist,backFist,joints}=images;
    const layer=document.createElement("canvas");
    layer.width=layer.height=384;
    const surface=layer.getContext("2d");
    const joinMask=document.createElement("canvas");
    const joinBlend=document.createElement("canvas");
    joinMask.width=joinMask.height=joinBlend.width=joinBlend.height=112;
    const maskPaint=joinMask.getContext("2d");
    const blendPaint=joinBlend.getContext("2d");
    const art={
      palm:{image:palm,x:245,y:620,edges:[-69,72]},
      back:{image:back,x:251,y:592.5,edges:[-61,63]},
      peace:{image:peace,x:126,y:554,length:543,wrist:61,edges:[-64,63],tips:[[32,9],[241,4]]},
      backPeace:{image:backPeace,x:124.5,y:534,length:522,wrist:62,edges:[-63.5,68.5],tips:[[65,5],[224,23]]},
      thumb:{image:thumb,x:117,y:507.5,length:486,wrist:58,edges:[-63,60]},
      fist:{image:fist,x:157.5,y:369,length:252,wrist:73.5,edges:[-74.5,72.5]},
      backFist:{image:backFist,x:164.5,y:417,length:338,wrist:78,edges:[-83.5,88.5]},
      point:{image:images.point,x:133.4,y:532.1,length:287.3,wrist:71.8,edges:[-69.6,74]},
      hook:{image:images.hook,x:153.7,y:420.5,length:252.3,wrist:66.7,edges:[-69.6,63.8]},
      ok:{image:images.ok,x:221.8,y:535,length:281.5,wrist:71.8,edges:[-65.2,78.3]},
      claw:{image:images.claw,x:224.8,y:510.4,length:274.1,wrist:83.4,edges:[-82.6,84.1]},
      pinch:{image:images.pinch,x:162.4,y:435,length:263.5,wrist:69.6,edges:[-72.5,66.7]},
    };
    const backRoots=[[683,941],[636,610],[510,587],[401,588],[310,677]];

    function facingDepth(points) {
      const a=subtract(points[5],points[0]),b=subtract(points[17],points[0]);
      const az=points[5].z-points[0].z,bz=points[17].z-points[0].z;
      const cross=a.x*b.y-a.y*b.x;
      return cross/Math.max(1,Math.hypot(a.y*bz-az*b.y,az*b.x-a.x*bz,cross));
    }

    function dorsal(points,previous) {
      const facing=facingDepth(points);
      // Thumb-side normalized coordinates make a palm negative for either hand.
      // Retain the last surface through the edge-on part of a wrist turn.
      if(facing>.19) return true;
      if(facing<-.19) return false;
      return previous??facing>0;
    }

    function gesture(points,previous) {
      const wrist=points[0],palmLength=distance(wrist,points[9]);
      const shapes=digitStarts.map(base=>{
        const [a,b,c,d]=points.slice(base,base+4);
        const proximal=distance(a,b);
        const length=proximal+distance(b,c)+distance(c,d);
        const straight=distance(a,d)/Math.max(1,length);
        const reach=distance(wrist,d)/Math.max(1,distance(wrist,a));
        const closed=length>palmLength*.34&&proximal>palmLength*.10&&
          straight<.72&&reach<1.24&&projection(a,d,wrist,a)<length*.15&&
          projection(b,d,a,b)<-length*.085;
        return {straight,reach,closed,knuckle:projection(a,b,wrist,points[9]),
          depth:(a.z-d.z)/Math.max(1,length)};
      });
      const [big,index,middle,ring,little]=shapes;
      const open=(finger,held)=>finger.straight>(held ? .80 : .85)&&finger.reach>(held ? 1.23 : 1.34);
      const curled=(finger,held)=>finger.straight<(held ? .88 : .79)&&finger.reach<(held ? 1.49 : 1.35);
      const peaceHeld=previous==="peace",thumbHeld=previous==="thumb";
      if(open(index,peaceHeld)&&open(middle,peaceHeld)&&curled(ring,peaceHeld)&&curled(little,peaceHeld))
        return "peace";
      if(big.straight>(thumbHeld?.80:.89)&&big.reach>2.35&&
          [index,middle,ring,little].every(finger=>curled(finger,thumbHeld))) return "thumb";
      const digits=[index,middle,ring,little];
      const openThumb=big.straight>.88&&big.reach>2.2&&distance(points[4],points[5])>palmLength*.65;
      // A hooked finger can look short without joining the other knuckles.
      // Use the fist art only when each fingertip folds back into the hand.
      if(palmLength>1&&!openThumb&&digits.every(finger=>finger.closed)) {
        const knuckles=digits.map(finger=>finger.knuckle).sort((a,b)=>a-b);
        if(knuckles[3]-(knuckles[1]+knuckles[2])*.5<palmLength*.19) return "fist";
      }
      // Use whole-hand art for a clearly visible matching palm gesture.
      // Atypical angles and mixed gestures continue to use independent fingers.
      if(facingDepth(points)<-.64&&palmLength>1) {
        const other=[middle,ring,little];
        const resting=other.every(finger=>finger.closed);
        const touch=distance(points[4],points[8])/palmLength;
        if(touch<.23&&index.reach>1.19&&big.straight<.92) {
          if(other.every(finger=>open(finger,false))) return "ok";
          if(resting) return "pinch";
        }
        if(resting&&!openThumb) {
          if(index.straight>.92&&index.reach>1.53) return "point";
          if(index.straight>.47&&index.straight<.80&&index.knuckle>palmLength*.26&&
             index.reach>1.23) return "hook";
        }
        if(digits.every(finger=>finger.depth>.30&&finger.reach>1.13&&finger.straight<.87))
          return "claw";
      }
      return null;
    }

    function aim(points,kind) {
      if(kind==="thumb") return points[4];
      if(kind==="peace") return scale(add(points[8],points[12]),.5);
      return points[9];
    }

    function layout(wrist,points,width,axis,kind,backFacing,eyePair=false) {
      const sprite=kind?(kind==="peace"&&backFacing?art.backPeace:
        kind==="fist"&&backFacing?art.backFist:art[kind]):backFacing?art.back:art.palm;
      const forward=direction(axis);
      const transverse=normal(forward);
      const horizontal=kind==="thumb"?subtract(points[9],points[4]):subtract(points[5],points[17]);
      const span=dot(transverse,horizontal);
      const ratio=clamp(width/15,.76,1.17);
      const length=Math.max(32,dot(subtract(points[9],wrist),forward));
      const sign=Math.abs(span)>width*.66?Math.sign(span):(backFacing?-1:1);
      let sx=kind?clamp(width/sprite.wrist,.15,.29)*sign:
        2*clamp(Math.abs(span)/(backFacing?326:389),.049*ratio,.132*ratio)*sign;
      if(eyePair&&sprite.tips) {
        const [a,b]=sprite.tips;
        const spacing=Math.abs(dot(transverse,subtract(points[8],points[12])));
        const widthScale=Math.abs(sx);
        sx=sign*clamp(spacing/(b[0]-a[0]),widthScale*.78,widthScale*1.22);
      }
      const sy=kind?clamp(dot(subtract(aim(points,kind),wrist),forward)/sprite.length,
        kind==="fist"?.10:.14,.31):2*clamp(length/(backFacing?588:592),.065,.138);
      // The neck of each painted hand supplies the same cross-section to the
      // arm contour and to the crop of the palm. Discard the old sleeve-like
      // wrist stub on the hand so it cannot protrude at a sideways bend.
      const crop=Math.round(sprite.y-12);
      const center=add(wrist,scale(forward,(sprite.y-crop)*sy));
      const edges=sprite.edges.map(x=>x*sx).sort((a,b)=>a-b);
      const join={axis,negative:add(center,scale(transverse,edges[0])),
        positive:add(center,scale(transverse,edges[1]))};
      return {sprite,forward,transverse,sx,sy,crop,join,ratio,length};
    }

    function peaceCenter(wrist,{sprite,forward,transverse,sx,sy}) {
      const [a,b]=sprite.tips;
      return add(wrist,add(scale(forward,(sprite.y-(a[1]+b[1])*.5)*sy),
        scale(transverse,((a[0]+b[0])*.5-sprite.x)*sx)));
    }

    function paintArt(ctx,wrist,{sprite,forward,transverse,sx,sy,crop}) {
      const {image,x,y}=sprite;
      ctx.save();
      ctx.translate(wrist.x,wrist.y);
      ctx.transform(sx*transverse.x,sx*transverse.y,-sy*forward.x,-sy*forward.y,0,0);
      ctx.drawImage(image,0,0,image.width,crop,-x,-y,image.width,crop);
      ctx.restore();
    }

    function jointChain(start,observed,axis,lengths) {
      const result=[start];
      let heading=angleOf(axis);
      for(let i=0;i<3;i++) {
        const vector=subtract(observed[i+1],observed[i]);
        const projected=Math.hypot(vector.x,vector.y);
        const full=distance(observed[i+1],observed[i]);
        const limit=i===0?1.28:1.52;
        const nominal=lengths[i];
        const confidence=clamp((projected-1.1)/Math.max(4,nominal*.36),0,1);
        heading+=clamp(angleDelta(angleOf(vector)-heading),-limit,limit)*confidence;
        // A finger aimed toward the camera gets shorter on screen. An
        // uncertain 2D point never gets to lengthen or fold the whole digit.
        const proportion=clamp(projected/Math.max(1,full),0,1);
        const length=Math.min(full,nominal*1.24)*proportion;
        result.push(add(result[i],scale(direction(heading),length)));
      }
      return result;
    }

    function placeFinger({index,bone,outward,overPalm,depthRatio},width,view,memory) {
      const [root,pip,dip,tip]=bone;
      const axis=unit(subtract(pip,root),outward);
      const across=normal(axis);
      const chord=subtract(tip,root);
      const length=bone.slice(1).reduce((total,joint,i)=>total+
        Math.hypot(joint.x-bone[i].x,joint.y-bone[i].y),0);
      if(length<width*.18) return;
      const forward=dot(chord,axis),lateral=dot(chord,across);
      const thumb=index===0;
      const base=thumb?4:0;
      const drawFrames=view==="back"?backFrames:edgeFrames;
      const neutral=view==="palm"?palmFrames[index]:drawFrames[base];
      const frames=thumb?[neutral,drawFrames[5]]:[neutral,drawFrames[1],drawFrames[2],drawFrames[3]];
      const short=shortFrames[thumb?1:0];
      if(view==="palm"&&depthRatio>.23) frames.push(short);
      const tucked=view==="palm"&&!thumb&&overPalm&&forward<length*.28&&depthRatio>.14;

      // Compare the projected joint chain against the painted poses. A small
      // preference for the current frame avoids flickering at the pose boundary.
      const previous=memory.fingers[index];
      const score=frame=>{
        const stretch=forward/length-frame.tipY/frame.length;
        const bend=Math.abs(lateral/length)-Math.abs(frame.tipX/frame.length);
        const near=frame===short?Math.max(0,depthRatio-.23)*.30:0;
        return stretch*stretch+bend*bend-near-(frame===previous ? .027 : 0);
      };
      const frame=tucked?shortFrames[2]:frames.reduce((best,next)=>score(next)<score(best)?next:best);
      memory.fingers[index]=frame;

      const bendSide=Math.abs(lateral)>2?lateral:dot(subtract(dip,pip),across);
      const flip=frame===neutral?1:(Math.sign(bendSide*frame.tipX)||1);
      const sx=flip*width/frame.width;
      const scaleY=length/frame.length;
      const sy=tucked?Math.abs(sx)*clamp(length/width*.23,.74,1.32):
        clamp(forward/Math.max(1,frame.tipY),scaleY*.56,scaleY*1.23);
      const shearLimit=.38*sy;
      const shear=tucked?0:clamp((lateral-frame.tipX*sx)/frame.tipY,-shearLimit,shearLimit);
      const basePoint=add(root,scale(axis,-width*(overPalm&&!tucked ? .10 : .36)));
      return {axis,across,frame,basePoint,sx,sy,shear};
    }

    function paintFinger(placement) {
      if(!placement) return;
      const {axis,across,frame,basePoint,sx,sy,shear}=placement;
      surface.save();
      surface.translate(basePoint.x,basePoint.y);
      surface.transform(across.x*sx,across.y*sx,
        -axis.x*sy-across.x*shear,-axis.y*sy-across.y*shear,0,0);
      surface.drawImage(joints,frame.sx,frame.sy,tile,tile,-frame.x,-frame.y,tile,tile);
      surface.restore();
    }

    function fingerView(points,backFacing,memory) {
      const facing=Math.abs(facingDepth(points));
      const edge=facing<(memory.view==="edge"?.52:.38);
      const view=edge?"edge":backFacing?"back":"palm";
      memory.view=view;
      memory.fingers??=[];
      return view;
    }

    function palmFinger(wrist,points,backFacing,hand,index) {
      const {forward,transverse,length,sx,sy,sprite}=hand;
      const [x,y]=(backFacing?backRoots:roots)[index];
      const anchor=add(wrist,add(scale(transverse,(x*.5-sprite.x)*sx),scale(forward,(sprite.y-y*.5)*sy)));
      const base=digitStarts[index];
      const measured=points.slice(base,base+4);
      const outward=unit(subtract(anchor,wrist),forward);
      const bone=jointChain(anchor,measured,outward,phalanges[index].map(part=>part*clamp(length,41,83)));
      const curl=dot(subtract(bone[3],bone[0]),forward);
      const depth=(points[base+1].z+points[base+2].z+points[base+3].z)/3;
      const depthRatio=(measured[0].z-depth)/Math.max(1,distance(measured[0],measured[1])+
        distance(measured[1],measured[2])+distance(measured[2],measured[3]));
      return {index,bone,outward,depthRatio,depth:Math.round(depth/4),
        overPalm:!backFacing&&curl<length*(index===0?.14:.24)&&depth<12};
    }

    function fingertip(wrist,points,backFacing,hand,tip,memory) {
      const index=tip/4-1;
      const view=fingerView(points,backFacing,memory);
      const placement=placeFinger(palmFinger(wrist,points,backFacing,hand,index),
        digitWidths[index]*hand.ratio*1.43,view,memory);
      if(!placement) return null;
      const {axis,across,frame,basePoint,sx,sy,shear}=placement;
      return add(basePoint,add(scale(axis,frame.tipY*sy),
        scale(across,frame.tipX*sx+frame.tipY*shear)));
    }

    function paintPalm(wrist,points,backFacing,hand,memory) {
      const view=fingerView(points,backFacing,memory);
      const fingers=digitStarts.map((_,index)=>palmFinger(wrist,points,backFacing,hand,index))
        .sort((a,b)=>b.depth-a.depth);
      const draw=item=>paintFinger(placeFinger(item,digitWidths[item.index]*hand.ratio*1.43,view,memory));
      for(const item of fingers) if(!item.overPalm) draw(item);
      paintArt(surface,wrist,hand);
      for(const item of fingers) if(item.overPalm) draw(item);
    }

    function blendWrist(ctx,wrist,width,forearm,handLeft,handTop) {
      const half=joinMask.width*.5;
      const x=wrist.x-half,y=wrist.y-half;
      maskPaint.setTransform(1,0,0,1,0,0);
      maskPaint.clearRect(0,0,joinMask.width,joinMask.height);
      maskPaint.save();
      maskPaint.translate(-x,-y);
      maskPaint.fill(forearm);
      maskPaint.drawImage(layer,handLeft,handTop);
      maskPaint.restore();

      blendPaint.clearRect(0,0,joinBlend.width,joinBlend.height);
      const radius=Math.max(34,width*2.7);
      const shade=blendPaint.createRadialGradient(half,half,width*.75,half,half,radius);
      shade.addColorStop(0,wristSkin);
      shade.addColorStop(.40,wristSkin);
      shade.addColorStop(1,"rgba(249,220,210,0)");
      blendPaint.fillStyle=shade;
      blendPaint.fillRect(0,0,joinBlend.width,joinBlend.height);
      // Restrict the soft blend to the interior of the combined silhouette.
      // Shrinking the mask leaves the ink on the actual outside edge intact.
      blendPaint.globalCompositeOperation="destination-in";
      const inset=1.6;
      for(const [dx,dy] of [[inset,0],[-inset,0],[0,inset],[0,-inset]]) {
        blendPaint.drawImage(joinMask,dx,dy);
      }
      blendPaint.globalCompositeOperation="source-over";
      ctx.drawImage(joinBlend,x,y);
    }

    function paint(ctx,wrist,points,width,kind,backFacing,hand,forearm,memory={}) {
      const left=wrist.x-layer.width*.5,top=wrist.y-layer.height*.5;
      surface.setTransform(1,0,0,1,0,0);
      surface.clearRect(0,0,layer.width,layer.height);
      surface.translate(-left,-top);
      if(kind) paintArt(surface,wrist,hand);
      else paintPalm(wrist,points,backFacing,hand,memory);
      ctx.drawImage(layer,left,top);
      if(forearm) blendWrist(ctx,wrist,width,forearm,left,top);
    }
    return {dorsal,gesture,aim,layout,paint,fingertip,peaceCenter};
  };
})();
