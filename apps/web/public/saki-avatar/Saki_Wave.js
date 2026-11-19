(() => {
  "use strict";

  const radians = degrees => degrees * Math.PI / 180;
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  const mixPoint = (a, b, t) => ({x: mix(a.x, b.x, t), y: mix(a.y, b.y, t)});
  const offset = (point, angle, amount) => ({
    x: point.x + Math.cos(angle) * amount,
    y: point.y + Math.sin(angle) * amount,
  });
  const direction = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const angleDelta = value => Math.atan2(Math.sin(value), Math.cos(value));
  const wristProjection = turn => 1 - .47 * Math.sin(Math.PI * turn);
  const shoulder = {x:364,y:432};
  const restCuff = {x:335,y:597};
  const restElbow = {x:306,y:665};
  const restUpper = direction(shoulder,restElbow);
  const restAngle = direction(restElbow,{x:211,y:835});
  const openHand = {width:126,height:173,wristX:57.7,wristY:145.9,wristHalfWidth:15.4};
  const wristSkin = "#f9dcd2";
  const duration = 2840;

  function aroundShoulder(point,turn) {
    const dx=point.x-shoulder.x,dy=point.y-shoulder.y;
    const cos=Math.cos(turn),sin=Math.sin(turn);
    return {x:shoulder.x+dx*cos-dy*sin,y:shoulder.y+dx*sin+dy*cos};
  }

  function cuffLengthScale(upperLength) {
    return clamp((upperLength-26)/168);
  }

  function pose(time, side) {
    const lift = ease(time / 760) * ease((duration - time) / 890);
    const raise = ease(time / 655) * ease((duration - time) / 940);
    const turn = ease((time - 180) / 545) * ease((duration - 95 - time) / 620);
    const swayTime = (time - 700) / 1180;
    const left = side === "left";
    const sway = swayTime > 0 && swayTime < 1
      ? Math.sin(swayTime * 4 * Math.PI + (left ? .45 : 0)) * Math.sin(swayTime * Math.PI) : 0;
    const upperTurn = radians((left ? 16 : 20) * raise + 1.25 * sway);
    const elbow = aroundShoulder(restElbow,upperTurn);
    const angle = mix(restAngle, radians(left ? 244 : 246), lift) + radians(8) * sway;
    const projectedLength = Math.hypot(95, 170) * (1 - .43 * Math.sin(Math.PI * lift) ** 2);
    const wrist = offset(elbow, angle, projectedLength);
    const handAngle = angle + Math.PI / 2 + radians(17) * sway;
    return {elbow,wrist,angle,handAngle,turn,lift,upperTurn};
  }

  function armEdges({elbow,wrist,angle,handAngle,turn,width,cuff,upper,palmJoin}, side) {
    const perp = radians(90 * side);
    const foreDistance = Math.hypot(wrist.x-elbow.x,wrist.y-elbow.y);
    const sleeveEntry = offset(offset(cuff,upper,-28),upper+perp,26);
    const sleeveExit = offset(cuff,upper+perp,27);
    const wristWidth = width ?? mix(16.5, openHand.wristHalfWidth, turn) * wristProjection(turn);
    const handAxis = handAngle - Math.PI / 2;
    const upperEdge=[sleeveEntry,sleeveExit,offset(elbow,upper+perp,27)];
    const lowerEdge=[
      offset(elbow,angle+perp,27),
      offset(offset(elbow,angle,Math.min(24,foreDistance*.26)),angle+perp,26),
      offset(mixPoint(elbow, wrist, .49), angle + perp, mix(24, 22, turn)),
      offset(mixPoint(elbow, wrist, palmJoin ? .64 : .81), angle + perp, wristWidth + 3.5),
    ];
    if(palmJoin) {
      const lead=Math.min(23,foreDistance*.25);
      lowerEdge.push(offset(offset(wrist,angle,-lead),angle+perp,wristWidth));
    } else {
      lowerEdge.push(offset(wrist,handAxis+perp,wristWidth),
        offset(offset(wrist,handAxis,width?5:7),handAxis+perp,wristWidth*.92));
    }
    return {upperEdge,lowerEdge};
  }

  function trace(path, points, first) {
    if (first) path.moveTo(points[0].x, points[0].y);
    else path.lineTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const mid = mixPoint(point, points[index + 1], .5);
      path.quadraticCurveTo(point.x, point.y, mid.x, mid.y);
    }
    const end = points.at(-1);
    path.lineTo(end.x, end.y);
  }

  function wristEdge(points,side,angle,join) {
    const from=points.at(-1);
    // When the hand doubles back in projection, connect the two near edges
    // rather than crossing the sides of the wrist over one another.
    const folded=Math.cos(angle-join.axis)<-.25;
    const to=(side===1)!==folded?join.positive:join.negative;
    const tangent=join.axis+(folded?Math.PI:0);
    const span=Math.hypot(to.x-from.x,to.y-from.y);
    const a=offset(from,angle,Math.min(12,span*.42));
    const b=offset(to,tangent,-Math.min(8,span*.30));
    return {from,to,a,b};
  }

  function wristCurve(path,{from,to,a,b},reverse=false) {
    const [first,last,end]=reverse?[b,a,from]:[a,b,to];
    path.bezierCurveTo(first.x,first.y,last.x,last.y,end.x,end.y);
  }

  function paintArm(ctx, {elbow,wrist,angle,upperTurn,palmJoin,sleeveScale=1,...hand}) {
    const upper=restUpper+upperTurn;
    const fullCuff=aroundShoulder(restCuff,upperTurn);
    const along=(fullCuff.x-shoulder.x)*Math.cos(upper)+(fullCuff.y-shoulder.y)*Math.sin(upper);
    const cuff=offset(fullCuff,upper,along*(sleeveScale-1));
    const joints={elbow,wrist,angle,palmJoin,cuff,upper,...hand};
    const outer = armEdges(joints, 1);
    const inner = armEdges(joints, -1);
    const outerWrist=palmJoin?wristEdge(outer.lowerEdge,1,angle,palmJoin):null;
    const innerWrist=palmJoin?wristEdge(inner.lowerEdge,-1,angle,palmJoin):null;
    const wristFold=palmJoin?ease((-.06-Math.cos(angle-palmJoin.axis))/.32):0;
    const capDepth=mix(1.6,-Math.min((joints.width??15)*.75,13),wristFold);
    const silhouette = new Path2D();
    const elbowRadius=27;
    // Paint the two segments as a union. Their skin fills the same loop-free
    // silhouette even when the forearm crosses back over the upper arm.
    const top=upper+Math.PI*.5;
    trace(silhouette,outer.upperEdge,true);
    silhouette.arc(elbow.x,elbow.y,elbowRadius,top,top-Math.PI,true);
    trace(silhouette,inner.upperEdge.slice(0,-1).reverse(),false);
    silhouette.closePath();
    const forearm=new Path2D();
    trace(forearm,outer.lowerEdge,true);
    if(palmJoin) {
      wristCurve(forearm,outerWrist);
      // On a doubled-back wrist the joint's rounded end is visible
      // beyond the palm; elsewhere this short cap sits under the artwork.
      const wristCap={from:outerWrist.to,to:innerWrist.to,
        a:offset(outerWrist.to,palmJoin.axis,capDepth),
        b:offset(innerWrist.to,palmJoin.axis,capDepth)};
      wristCurve(forearm,wristCap);
      wristCurve(forearm,innerWrist,true);
    }
    trace(forearm,inner.lowerEdge.slice().reverse(),false);
    forearm.arc(elbow.x,elbow.y,elbowRadius,angle-Math.PI*.5,angle+Math.PI*.5,true);
    forearm.closePath();
    silhouette.addPath(forearm);

    const center = mixPoint(elbow, wrist, .38);
    const left = offset(center, angle + Math.PI / 2, 31);
    const right = offset(center, angle - Math.PI / 2, 32);
    const shade = ctx.createLinearGradient(left.x, left.y, right.x, right.y);
    shade.addColorStop(0, "#eebeb2");
    shade.addColorStop(.22, "#f7d6ca");
    shade.addColorStop(.62, "#fbe2d8");
    shade.addColorStop(1, "#f9dcd1");
    ctx.strokeStyle="rgba(129,77,71,.68)";
    ctx.lineJoin="round";
    ctx.lineWidth=2.05;
    // Stroke first so the fill covers the internal edges at the joint.
    ctx.stroke(silhouette);
    ctx.fillStyle = shade;
    ctx.fill(silhouette);

    ctx.save();
    ctx.clip(silhouette);
    const flush = ctx.createRadialGradient(elbow.x, elbow.y, 2, elbow.x, elbow.y, 47);
    flush.addColorStop(0, "rgba(231,153,142,.24)");
    flush.addColorStop(1, "rgba(231,153,142,0)");
    ctx.fillStyle = flush;
    ctx.fillRect(elbow.x - 47, elbow.y - 47, 94, 94);
    const seam = ctx.createRadialGradient(cuff.x,cuff.y,2,cuff.x,cuff.y,32);
    seam.addColorStop(0,"rgba(210,142,125,.41)");
    seam.addColorStop(1,"rgba(210,142,125,0)");
    ctx.fillStyle = seam;
    ctx.fillRect(cuff.x-32,cuff.y-32,64,64);
    const base=offset(wrist,angle,-42);
    const joint=offset(wrist,angle,-3);
    const wristShade=ctx.createLinearGradient(base.x,base.y,joint.x,joint.y);
    wristShade.addColorStop(0,"rgba(249,220,210,0)");
    wristShade.addColorStop(1,wristSkin);
    ctx.fillStyle=wristShade;
    ctx.fillRect(wrist.x-75,wrist.y-75,150,150);
    ctx.restore();

    return {silhouette,forearm};
  }

  function paintSleeve(ctx,{sleeve,raisedSleeve,lining},turn,behindArm=false,scale=1) {
    const degrees=turn*180/Math.PI;
    const raised=degrees>=39;
    if(behindArm&&!raised) return;
    const start=raised?40:-26;
    const frame=Math.max(0,Math.min(43,Math.round((degrees-start)/2)));
    const residual=turn-radians(start+2*frame);
    const [left,top,width,height]=behindArm?[155,252,171,366]:
      raised?[146,224,310,400]:[180,370,296,254];
    ctx.save();
    ctx.translate(shoulder.x,shoulder.y);
    const upper=restUpper+turn;
    ctx.rotate(upper);
    ctx.scale(scale,1);
    ctx.rotate(residual-upper);
    ctx.drawImage(behindArm?lining:raised?raisedSleeve:sleeve,(frame%8)*width,Math.floor(frame/8)*height,width,height,
      left-shoulder.x,top-shoulder.y,width,height);
    ctx.restore();
  }

  function paintHand(ctx, joints, sprites) {
    const open = ease((joints.turn - .47) / .08);
    const narrow = wristProjection(joints.turn);
    ctx.save();
    ctx.translate(joints.wrist.x, joints.wrist.y);
    ctx.rotate(joints.handAngle);
    ctx.scale(narrow, 1 - .17 * Math.sin(joints.lift * Math.PI) ** 2);
    const opacity = ctx.globalAlpha;
    if (open < 1) {
      ctx.save();
      ctx.globalAlpha = opacity * (1 - open);
      ctx.rotate(-restAngle - Math.PI / 2);
      ctx.drawImage(sprites.relaxed, -110, -17);
      ctx.restore();
    }
    if (open > 0) {
      ctx.globalAlpha = opacity * open;
      ctx.drawImage(sprites.open, -openHand.wristX, -openHand.wristY, openHand.width, openHand.height);
    }
    ctx.restore();
  }

  function rotatedMinX(x,y,width,height,angle,sx,sy,inner=0) {
    const c=Math.cos(angle),s=Math.sin(angle),ic=Math.cos(inner),is=Math.sin(inner);
    const horizontal=c*sx*ic-s*sy*is;
    const vertical=-c*sx*is-s*sy*ic;
    return horizontal*x+vertical*y+Math.min(0,horizontal*width)+Math.min(0,vertical*height);
  }

  function handMinX(joints,relaxed) {
    const {wrist,handAngle,turn,lift}=joints;
    const open=ease((turn-.47)/.08),sx=wristProjection(turn);
    const sy=1-.17*Math.sin(lift*Math.PI)**2;
    const palm=open>0?rotatedMinX(-openHand.wristX,-openHand.wristY,openHand.width,openHand.height,handAngle,sx,sy):Infinity;
    const fingers=open<1?rotatedMinX(-110,-17,relaxed.width,relaxed.height,handAngle,sx,sy,-restAngle-Math.PI/2):Infinity;
    return wrist.x+Math.min(palm,fingers);
  }

  function fitConversation(sample,minX,relaxed) {
    const [lift,upper,bend,reach,wristRotation,turn]=sample;
    const outerElbow=aroundShoulder(restElbow,radians(upper));
    const outerWrist=offset(outerElbow,restAngle+radians(bend),Math.hypot(95,170)*reach);
    const innerElbow={x:Math.max(shoulder.x-17,minX+38),y:outerElbow.y};
    const innerWrist={x:Math.max(shoulder.x+5,minX+165),y:outerElbow.y+mix(104,-124,ease((bend-39)/63))};
    const at=amount=>{
      const elbow=mixPoint(outerElbow,innerElbow,amount);
      const wrist=mixPoint(outerWrist,innerWrist,amount);
      const angle=direction(elbow,wrist);
      const upperTurn=angleDelta(direction(shoulder,elbow)-restUpper);
      return {elbow,wrist,angle,handAngle:angle+Math.PI/2+radians(wristRotation),turn,lift,upperTurn};
    };
    const clear=joints=>handMinX(joints,relaxed)>=minX&&joints.elbow.x>=minX+36;
    const outer=at(0);
    if(clear(outer)) return outer;
    let low=0,high=1;
    for(let i=0;i<9;i++) {
      const middle=(low+high)/2;
      if(clear(at(middle))) high=middle;
      else low=middle;
    }
    return at(high);
  }

  function loadImage(name,extension="webp") {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });
    image.src = "gesture-art/" + name + "." + extension + "?v=arm-lift-3";
    return loaded;
  }

  window.createSakiWave = async () => {
    const callMode=Boolean(document.documentElement.dataset.call);
    async function layers(prefix) {
      const [mask,underlay,sleeve,raisedSleeve,relaxed]=await Promise.all([
        loadImage(prefix+"shoulder_mask"),loadImage(prefix+"shoulder_underlay"),
        loadImage(prefix+"sleeve_redrawn_atlas"),loadImage(prefix+"sleeve_lift_atlas"),
        loadImage(prefix+"hand_relaxed"),
      ]);
      return {mask,underlay,sleeve,raisedSleeve,relaxed};
    }
    const [right,left,open,lining,handArt,skirtHand]=await Promise.all([
      layers(""),layers("left_"),loadImage("hand_open_redrawn"),loadImage("sleeve_lift_lining"),
      callMode?null:Promise.all(Object.entries({
        palm:"hand_capture_palm",back:"hand_capture_dorsal",peace:"hand_capture_peace",
        backPeace:"hand_capture_dorsal_peace",thumb:"hand_capture_thumb",fist:"hand_capture_palm_fist",
        backFist:"hand_capture_dorsal_fist",joints:"hand_joint_atlas",point:"hand_pose_point",
        hook:"hand_pose_hook",ok:"hand_pose_ok",claw:"hand_pose_claw",pinch:"hand_pose_pinch",
      }).map(async ([key,name])=>[key,await loadImage(name)])).then(Object.fromEntries),
      callMode?loadImage("hand_dorsal_redrawn","png").catch(()=>null):null,
    ]);
    const handRig=handArt&&window.createSakiHandRig(handArt,wristSkin);
    const tracked={right:{},left:{}};
    const sides={right,left};
    function updateGesture(memory,sample) {
      if(memory.sample===sample) return memory.kind;
      memory.sample=sample;
      const points=Array.from({length:21},(_,i)=>({
        x:sample[5+2*i],y:sample[6+2*i],z:sample[47+i]??0,
      }));
      const candidate=handRig.gesture(points,memory.kind);
      const required=candidate==="fist"?3:["peace","thumb",null].includes(candidate)?1:2;
      memory.samples=candidate===memory.candidate?Math.min(required,memory.samples+1):1;
      memory.candidate=candidate;
      // Release immediately when the camera no longer confirms the fixed pose.
      memory.kind=memory.samples>=required?candidate:null;
      return memory.kind;
    }
    function paintSide(ctx, side, visibility, painter) {
      ctx.save();
      if(side==="left") {
        ctx.translate(Number(ctx.canvas.dataset.logicalWidth)||ctx.canvas.width,0);
        ctx.scale(-1,1);
      }
      ctx.globalAlpha=visibility;
      ctx.globalCompositeOperation="source-over";
      painter({...sides[side],open,lining});
      ctx.restore();
    }
    return {
      duration,
      prepare(ctx,{side,time,amount,spoken}) {
        const opacity=time===undefined?ease(amount/(spoken ? .22 : .12)):ease(pose(time,side).lift/.025);
        paintSide(ctx,side,opacity,({mask,underlay})=>{
          ctx.globalCompositeOperation="destination-out";
          ctx.drawImage(mask,88,384);
          ctx.globalCompositeOperation="lighter";
          ctx.drawImage(underlay,88,384);
        });
      },
      paint(ctx,time,side) {
        const joints=pose(time,side);
        paintSide(ctx,side,ease(joints.lift/.025),sprites=>{
          paintSleeve(ctx,sprites,joints.upperTurn,true);
          paintArm(ctx,joints);
          paintSleeve(ctx,sprites,joints.upperTurn);
          paintHand(ctx,joints,sprites);
        });
      },
      paintConversation(ctx,sample,side,minX,skirtHold) {
        const joints=fitConversation(sample,minX,sides[side].relaxed);
        const {lift,upperTurn,elbow}=joints;
        const sleeveScale=cuffLengthScale(Math.hypot(elbow.x-shoulder.x,elbow.y-shoulder.y));
        paintSide(ctx,side,ease(lift/.22),sprites=>{
          paintSleeve(ctx,sprites,upperTurn,true,sleeveScale);
          paintArm(ctx,{...joints,sleeveScale});
          paintSleeve(ctx,sprites,upperTurn,false,sleeveScale);
          const cover=skirtHand?ease((skirtHold-.34)/.44):0;
          const opacity=ctx.globalAlpha;
          if(cover<1) {
            ctx.globalAlpha=opacity*(1-cover);
            paintHand(ctx,joints,sprites);
          }
          if(cover>0) {
            ctx.globalAlpha=opacity*cover;
            ctx.translate(joints.wrist.x,joints.wrist.y);
            ctx.rotate(joints.handAngle);
            // Align the wrist of the painted dorsal hand with the forearm cap.
            ctx.scale(-.105,.091);
            ctx.drawImage(skirtHand,-504,-1206);
          }
        });
      },
      paintTracked(ctx,values,visibility,side,sample=values,face=null) {
        if(!handRig) return;
        const [ex,ey,wx,wy,trackedWidth]=values;
        const targetElbow={x:ex,y:ey};
        const upperTurn=angleDelta(direction(shoulder,targetElbow)-restUpper)*visibility;
        const upperLength=mix(Math.hypot(58,233),Math.hypot(ex-shoulder.x,ey-shoulder.y),visibility);
        const elbow=offset(shoulder,restUpper+upperTurn,upperLength);
        const targetAngle=Math.atan2(wy-ey,wx-ex);
        const turn=targetAngle-restAngle;
        const angle=restAngle+angleDelta(turn)*visibility;
        const length=mix(Math.hypot(95,170),Math.hypot(wx-ex,wy-ey),visibility);
        const wrist=offset(elbow,angle,length);
        const rotation=angle-targetAngle;
        const cos=Math.cos(rotation),sin=Math.sin(rotation);
        const points=[];
        for(let i=0;i<21;i++) {
          const x=values[5+2*i],y=values[6+2*i];
          points.push({x:wrist.x+x*cos-y*sin,y:wrist.y+x*sin+y*cos,z:values[47+i]??0});
        }
        if(visibility<.2) tracked[side]={};
        const memory=tracked[side];
        const gesture=updateGesture(memory,sample);
        const marks=side==="left"?face?.features?.map(({x,y})=>({x:ctx.canvas.width-x,y})):face?.features;
        const contact=window.findSakiFaceContact?.(points,marks,face?.span);
        const touchingNoseOrMouth=contact?.feature<2&&contact.weight>.5;
        const eye=!touchingNoseOrMouth&&(gesture==="peace"||!gesture)?
          window.findSakiEyeGesture?.(points,marks,face?.span):null;
        // For a visible fingertip touching the face, the articulated art can
        // follow its exact position. A closed fist keeps its own silhouette.
        const kind=!eye&&contact?.weight>.44&&gesture!=="fist"?null:gesture;
        const dorsal=handRig.dorsal(points,memory.dorsal);
        memory.dorsal=dorsal;
        const targetDirection=direction(wrist,handRig.aim(points,kind));
        // The painted gestures have distinct axes. Ease wrist rotation through
        // a pose change without slowing the tracked position of the hand.
        const now=performance.now();
        const previous=memory.direction??targetDirection;
        const weight=1-Math.exp(-Math.min(100,now-(memory.time??now))/34);
        const handDirection=previous+angleDelta(targetDirection-previous)*weight;
        memory.direction=handDirection;
        memory.time=now;
        const delta=angleDelta(handDirection-angle);
        const axis=angle+delta*visibility;
        const jointAngle=angle+Math.max(-1.49,Math.min(1.49,delta*.81))*visibility+Math.PI/2;
        const width=mix(16.5,trackedWidth,visibility);
        const articulated=ease((visibility-.18)/.50);
        let hand=handRig.layout(wrist,points,width,axis,kind,dorsal,Boolean(eye));
        let desired,painted,influence;
        if(eye) {
          desired=eye.center;
          influence=eye.weight;
          if(kind==="peace") painted=handRig.peaceCenter(wrist,hand);
          else {
            const index=handRig.fingertip(wrist,points,dorsal,hand,8,memory);
            const middle=handRig.fingertip(wrist,points,dorsal,hand,12,memory);
            if(index&&middle) painted=mixPoint(index,middle,.5);
          }
        } else if(contact&&!kind) {
          desired=points[contact.tip];
          painted=handRig.fingertip(wrist,points,dorsal,hand,contact.tip,memory);
          influence=contact.weight;
        }
        if(painted) {
          const dx=desired.x-painted.x,dy=desired.y-painted.y;
          const amount=influence*visibility*Math.min(1,60/Math.max(1,Math.hypot(dx,dy)));
          wrist.x+=dx*amount;
          wrist.y+=dy*amount;
          for(const point of points) {
            point.x+=dx*amount;
            point.y+=dy*amount;
          }
          hand=handRig.layout(wrist,points,width,axis,kind,dorsal,Boolean(eye));
        }
        const palmJoin=articulated>.55?hand.join:null;
        const sleeveScale=cuffLengthScale(upperLength);
        const forearmAngle=direction(elbow,wrist);
        const foldOverSleeve=(contact||eye)&&wrist.y<elbow.y&&
          Math.abs(angleDelta(forearmAngle-restUpper-upperTurn))>radians(97);
        paintSide(ctx,side,ease(visibility/.12),sprites=>{
          paintSleeve(ctx,sprites,upperTurn,true,sleeveScale);
          const arm=paintArm(ctx,{elbow,wrist,width,angle:forearmAngle,handAngle:jointAngle,
            turn:visibility*.7,upperTurn,palmJoin,sleeveScale});
          ctx.save();
          if(foldOverSleeve) {
            // A forearm folding in front of the face also passes in front of
            // its sleeve. Keep that overlap visible without drawing a seam on it.
            const visibleSleeve=new Path2D();
            visibleSleeve.rect(0,0,ctx.canvas.width,ctx.canvas.height);
            visibleSleeve.addPath(arm.forearm);
            ctx.clip(visibleSleeve,"evenodd");
          }
          paintSleeve(ctx,sprites,upperTurn,false,sleeveScale);
          ctx.restore();
          const alpha=ctx.globalAlpha;
          if(articulated<1) {
            ctx.globalAlpha=alpha*(1-articulated);
            paintHand(ctx,{wrist,handAngle:jointAngle,turn:0,lift:0},sprites);
          }
          if(articulated>0) {
            ctx.globalAlpha=alpha*articulated;
            handRig.paint(ctx,wrist,points,width,kind,dorsal,hand,palmJoin?arm.silhouette:null,memory);
          }
        });
      },
    };
  };
})();
