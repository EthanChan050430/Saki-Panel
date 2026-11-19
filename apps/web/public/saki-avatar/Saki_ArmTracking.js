(() => {
  "use strict";

  const shoulder={x:364,y:432};
  const rest=Math.atan2(233,-58);
  const minTurn=-26*Math.PI/180, maxTurn=126*Math.PI/180;
  const joints=[[12,14,16],[11,13,15]];
  const sides=["Right","Left"];
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const mix=(a,b,t)=>a+(b-a)*t;
  const difference=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const angle=(origin,p)=>Math.atan2(p.y-origin.y,p.x-origin.x);
  const turn=value=>Math.atan2(Math.sin(value),Math.cos(value));
  const between=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
  const tips=[8,12,16,20,4];
  const contactRadii=[.25,.21,.15,.15];

  function faceContact(points,features,span) {
    if(!features||!(span>0)) return null;
    let match=null;
    for(const tip of tips) {
      for(const [feature,point] of features.entries()) {
        const score=distance(points[tip],point)/(span*contactRadii[feature]);
        if(score<(match?.score??1)) match={tip,feature,score};
      }
    }
    if(!match) return null;
    const edge=clamp((match.score-.52)/.48,0,1);
    return {...match,weight:1-edge*edge*(3-2*edge)};
  }
  window.findSakiFaceContact=faceContact;

  function eyeGesture(points,features,span) {
    if(!features?.[3]||!(span>0)) return null;
    const wrist=points[0],palm=distance(wrist,points[9]);
    if(!palm) return null;
    const extension=id=>{
      const finger=distance(points[id],points[id-3])/palm;
      const reach=distance(wrist,points[id])/Math.max(.001,distance(wrist,points[id-3]));
      return clamp(Math.min((finger-.30)/.15,(reach-1.18)/.12),0,1);
    };
    const spread=Math.min(extension(8),extension(12));
    if(!spread) return null;
    const center=between(points[8],points[12],.5);
    let match=null;
    for(const feature of [2,3]) {
      const eye=features[feature];
      const extent=Math.max(distance(eye,points[8]),distance(eye,points[12]));
      const score=Math.max(extent/(span*.72),Math.hypot((center.x-eye.x)/(span*.65),(center.y-eye.y)/(span*.43)));
      if(score<(match?.score??1)) match={feature,score};
    }
    if(!match) return null;
    const edge=clamp((match.score-.50)/.50,0,1);
    return {center,feature:match.feature,weight:spread*(1-edge*edge*(3-2*edge))};
  }
  window.findSakiEyeGesture=eyeGesture;

  function offsetByEyeLine(delta,source,avatar) {
    const basis=marks=>{
      const heading=angle(marks[2],marks[3]);
      return {x:Math.cos(heading),y:Math.sin(heading)};
    };
    const from=basis(source),to=basis(avatar);
    // Eye landmarks are ordered by the mirrored preview. Positive local Y
    // points down in both the camera image and the painted face.
    const x=delta.x*from.x+delta.y*from.y;
    const y=delta.x*from.y-delta.y*from.x;
    return {x:x*to.x-y*to.y,y:x*to.y+y*to.x};
  }

  function fitElbow(wrist,observed,previous,confidence,nearFace) {
    const span=Math.max(1,distance(shoulder,wrist));
    // An upper arm pointing partly toward the lens has a shorter projection.
    // Keep that available around the face rather than throwing the elbow out.
    const upper=clamp(distance(shoulder,observed),Math.max(mix(205,146,nearFace),span-227),242);
    const lower=clamp(distance(wrist,observed),Math.max(48,Math.abs(span-upper)+.1),230);
    const bearing=angle(shoulder,wrist);
    const bend=Math.acos(clamp((span*span+upper*upper-lower*lower)/(2*span*upper),-1,1));
    const preferred=angle(shoulder,observed);
    const choices=[bearing+bend,bearing-bend].map(value=>{
      const offset=turn(value-rest);
      const limited=clamp(offset,minTurn,maxTurn);
      const continuity=previous===null?0:Math.abs(turn(rest+limited-previous));
      const penalty=Math.abs(turn(value-preferred))+2.8*Math.abs(limited-offset)+
        continuity*mix(.58,.16,confidence);
      return {heading:rest+limited,penalty};
    });
    const heading=(choices[0].penalty<choices[1].penalty?choices[0]:choices[1]).heading;
    return {x:shoulder.x+upper*Math.cos(heading),y:shoulder.y+upper*Math.sin(heading),heading};
  }

  window.createSakiArmTracking=()=>{
    let recentFace=null,recentBody=null;
    const wristHistory=[null,null];
    const elbowHistory=[null,null];

    function reset() {
      recentFace=null;
      recentBody=null;
      wristHistory.fill(null);
      elbowHistory.fill(null);
    }

    function read({skeleton,hands,handedness=[],head,aspect},now=performance.now()) {
      const frame=skeleton?.map(p=>({...p,x:p.x*aspect}));
      const shoulderSpan=frame&&distance(frame[11],frame[12]);
      if(shoulderSpan>.06&&[11,12].every(i=>frame[i].visibility>=.38))
        recentBody={time:now,span:shoulderSpan,points:[frame[12],frame[11]]};

      if(head?.eyes?.every(Number.isFinite)) {
        const [x,y,dx,dy]=head.eyes;
        const span=Math.hypot(dx*aspect,dy);
        if(span>.037) {
          const previous=recentFace&&now-recentFace.time<320?recentFace:null;
          const features=head.features?.map(([fx,fy])=>({x:fx*aspect,y:fy}));
          recentFace={time:now,x:mix(previous?.x??x*aspect,x*aspect,.52),
            y:mix(previous?.y??y,y,.52),span:mix(previous?.span??span,span,.35),features};
        }
      }

      const face=recentFace&&now-recentFace.time<1050?recentFace:null;
      const body=recentBody&&now-recentBody.time<650?recentBody:null;
      if(!hands.length||(!face&&!body)) return {right:null,left:null};
      const avatar=window.sakiFaceAnchor();
      const faceScale=face?clamp(avatar.span/face.span,220,4200):0;
      const bodyScale=body?clamp(272/body.span,220,3900):faceScale;
      const cameraSpan=body?.span??face?.span*1.65;

      const visible=hands.map(points=>points.map(p=>({x:p.x*aspect,y:p.y,z:(p.z??0)*aspect})));
      const pairs=visible.flatMap((points,hand)=>joints.map(([, ,id],side)=>{
        const previous=wristHistory[side];
        const joint=frame?.[id];
        const measured=joint?.visibility>=.34;
        const gap=measured?distance(points[0],joint)/cameraSpan:1;
        const named=handedness[hand]===sides[side];
        const nearest=previous&&now-previous.time<520?distance(previous,points[0])/cameraSpan:1;
        return {hand,side,score:Math.min(gap,named?.39:1.4,nearest+.19)+(named?0:.14)};
      })).sort((a,b)=>a.score-b.score);
      const selected=[null,null];
      const used=new Set();
      for(const {hand,side,score} of pairs) {
        if(score>1||selected[side]||used.has(hand)) continue;
        selected[side]=visible[hand];
        used.add(hand);
        wristHistory[side]={...visible[hand][0],time:now};
      }

      const values=selected.map((points,side)=>{
        if(!points) return null;
        const sign=side===0?1:-1;
        const cameraWrist=points[0];
        const sourceShoulder=body?.points[side];
        // Around the face, translate measured wrist position in units of eye
        // width. Around the torso, keep the hand registered to its shoulder.
        const localEyeX=side===0?1000-avatar.x:avatar.x;
        const faceWeight=face?(sourceShoulder?
          clamp((sourceShoulder.y-cameraWrist.y+face.span*.14)/(face.span*.59),0,1):1):0;
        const torsoPoint=point=>({
          x:shoulder.x+sign*(point.x-sourceShoulder.x)*bodyScale,
          y:shoulder.y+(point.y-sourceShoulder.y)*bodyScale,
        });
        const map=point=>{
          if(!face) return torsoPoint(point);
          const projected={
            x:localEyeX+sign*(point.x-face.x)*faceScale,
            y:avatar.y+(point.y-face.y)*faceScale,
          };
          return sourceShoulder?between(torsoPoint(point),projected,faceWeight):projected;
        };
        const handScale=Math.min(mix(bodyScale,faceScale||bodyScale,faceWeight),
          154/Math.max(.01,...points.map(point=>distance(point,cameraWrist))));
        const offsets=points.flatMap(point=>[(point.x-cameraWrist.x)*handScale*sign,
          (point.y-cameraWrist.y)*handScale]);
        const projected=map(cameraWrist);
        const faceFreshness=face?clamp((660-(now-face.time))/360,0,1):0;
        const contact=faceFreshness&&avatar.features?
          faceContact(points,face.features,face.span):null;
        const touchingNoseOrMouth=contact?.feature<2&&contact.weight>.5;
        const eye=faceFreshness&&avatar.features&&!touchingNoseOrMouth?
          eyeGesture(points,face.features,face.span):null;
        if(eye) {
          const mark=avatar.features[eye.feature];
          const delta=difference(eye.center,face.features[eye.feature]);
          const relative=offsetByEyeLine(delta,face.features,avatar.features);
          const x=mark.x+relative.x*faceScale;
          const y=mark.y+relative.y*faceScale;
          const influence=eye.weight*faceFreshness;
          projected.x=mix(projected.x,(side===0?1000-x:x)-sign*(eye.center.x-cameraWrist.x)*handScale,influence);
          projected.y=mix(projected.y,y-(eye.center.y-cameraWrist.y)*handScale,influence);
        } else if(contact) {
          const {tip,feature,weight}=contact;
          const delta=difference(points[tip],face.features[feature]);
          const mark=avatar.features[feature];
          // Place the measured fingertip relative to the same feature on the
          // drawing. The shoulder-based wrist position can otherwise lag below it.
          const x=side===0?1000-mark.x:mark.x;
          const influence=weight*faceFreshness;
          projected.x=mix(projected.x,x+sign*delta.x*faceScale-offsets[2*tip],influence);
          projected.y=mix(projected.y,mark.y+delta.y*faceScale-offsets[2*tip+1],influence);
        }
        let wrist={x:clamp(projected.x,31,886),y:clamp(projected.y,27,916)};
        const reach=distance(shoulder,wrist);
        if(reach>445) {
          const delta=difference(wrist,shoulder);
          wrist={x:shoulder.x+delta.x*445/reach,y:shoulder.y+delta.y*445/reach};
        }
        const joint=frame?.[joints[side][1]];
        const palm=between(cameraWrist,points[9],.72);
        const faceDistance=face?distance(palm,{x:face.x,y:face.y+face.span*.34})/face.span:Infinity;
        const nearFace=Math.max(eye?.weight??contact?.weight??0,clamp((2-faceDistance)/.85,0,1))*faceFreshness;
        const confidence=clamp(((joint?.visibility??0)-.42)/.44,0,1);
        const fallback={
          x:Math.min(shoulder.x-142,wrist.x-112),y:shoulder.y+37+(wrist.y-shoulder.y)*.26,
        };
        const lowered={
          x:clamp(wrist.x-38,shoulder.x-154,shoulder.x-18),
          y:Math.max(shoulder.y+134,wrist.y+152),
        };
        const estimate=between(fallback,lowered,nearFace);
        const measured=confidence?(sourceShoulder?between(map(joint),torsoPoint(joint),nearFace):map(joint)):estimate;
        const observed=between(estimate,measured,confidence);
        const previous=elbowHistory[side];
        const elbow=fitElbow(wrist,observed,previous&&now-previous.time<360?previous.heading:null,confidence,nearFace);
        elbowHistory[side]={time:now,heading:elbow.heading};
        const width=clamp(distance(points[5],points[17])*handScale*.28,9.4,17.2);
        const depth=points.map(point=>clamp((point.z-cameraWrist.z)*handScale,-170,170));
        return [elbow.x,elbow.y,wrist.x,wrist.y,width,...offsets,...depth]
          .map(value=>Math.round(value*10)/10);
      });
      // The camera preview is mirrored. Keep the avatar on the same screen
      // side as the hand the user sees in that preview.
      return {right:values[1],left:values[0]};
    }
    return {read,reset};
  };
})();
