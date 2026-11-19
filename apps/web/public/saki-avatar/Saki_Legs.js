(() => {
  "use strict";
  const radians=Math.PI/180;
  const unit=1.22;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};
  const heading=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
  const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const world=(x,y)=>({x:500+(x-585)*unit,y:969+(y-796)*unit});
  const neutral=[0,0,0,1,1];
  const legParts=[
    {name:"left",x:479,hip:[535,752],knee:[550,923],ankle:[560,1194]},
    {name:"right",x:597,hip:[642,752],knee:[636,923],ankle:[647,1193]},
  ];

  function bone(origin,start,axis,angle,projection) {
    const cos=Math.cos(angle),sin=Math.sin(angle);
    const alongX=Math.cos(axis),alongY=Math.sin(axis);
    return point=>{
      const x=point.x-origin.x,y=point.y-origin.y;
      const shortening=(x*alongX+y*alongY)*(projection-1);
      const dx=x+shortening*alongX,dy=y+shortening*alongY;
      return {x:start.x+dx*cos-dy*sin,y:start.y+dx*sin+dy*cos};
    };
  }

  function mesh(part) {
    const {image,x}=part;
    const [hip,knee,ankle]=[part.hip,part.knee,part.ankle].map(([cx,cy])=>world(cx,cy));
    const thighAxis=heading(hip,knee),shinAxis=heading(knee,ankle);
    const rows=[];
    for(let y=0;y<image.height;y+=27) rows.push(y);
    rows.push(image.height);
    const source=rows.map(y=>[world(x,y+746),world(x+image.width,y+746)]);

    function triangle(ctx,vertices,width,top,height,opposite) {
      const [p,q,r]=vertices;
      // Source vertices are a right triangle with its origin in one corner.
      const sign=opposite?-1:1;
      const a=(q.x-p.x)/width*sign,b=(q.y-p.y)/width*sign;
      const c=(r.x-p.x)/height*sign,d=(r.y-p.y)/height*sign;
      const originX=opposite?width:0,originY=opposite?top+height:top;
      const lengths=[Math.hypot(q.x-r.x,q.y-r.y),Math.hypot(p.x-r.x,p.y-r.y),Math.hypot(p.x-q.x,p.y-q.y)];
      const perimeter=lengths[0]+lengths[1]+lengths[2];
      const center={
        x:(p.x*lengths[0]+q.x*lengths[1]+r.x*lengths[2])/perimeter,
        y:(p.y*lengths[0]+q.y*lengths[1]+r.y*lengths[2])/perimeter,
      };
      const inradius=Math.abs((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x))/perimeter;
      // Overlap all three antialiased clip edges so the dark sock remains solid
      // when adjoining pieces move by fractional pixels.
      const padding=1+1.2/Math.max(inradius,.20);
      ctx.save();
      ctx.beginPath();
      for(const [i,point] of vertices.entries()) {
        const px=center.x+(point.x-center.x)*padding;
        const py=center.y+(point.y-center.y)*padding;
        if(i===0) ctx.moveTo(px,py);
        else ctx.lineTo(px,py);
      }
      ctx.clip();
      ctx.transform(a,b,c,d,p.x-a*originX-c*originY,p.y-b*originX-d*originY);
      ctx.drawImage(image,0,0);
      ctx.restore();
    }

    return (ctx,values)=>{
      const [lift,flex,foot,upper,lower]=values;
      if(values.every((value,i)=>Math.abs(value-neutral[i])<.001)) {
        const from=source[0][0];
        ctx.drawImage(image,from.x,from.y,image.width*unit,image.height*unit);
        return;
      }
      const thighTurn=lift*radians,shinTurn=(lift+flex)*radians;
      const thigh=bone(hip,hip,thighAxis,thighTurn,upper);
      const shin=bone(knee,thigh(knee),shinAxis,shinTurn,lower);
      const shoe=bone(ankle,shin(ankle),shinAxis,shinTurn+foot*radians,1);
      const moved=source.map(row=>row.map(point=>{
        const belowKnee=smooth((point.y-knee.y+45)/90);
        const belowAnkle=smooth((point.y-ankle.y+23)/46);
        return mix(mix(thigh(point),shin(point),belowKnee),shoe(point),belowAnkle);
      }));
      for(let i=0;i<rows.length-1;i++) {
        const top=rows[i],height=rows[i+1]-top;
        const [a,b]=moved[i],[c,d]=moved[i+1];
        triangle(ctx,[a,b,c],image.width,top,height,false);
        triangle(ctx,[d,c,b],image.width,top,height,true);
      }
    };
  }

  window.createSakiLegRig=async()=>{
    const legs=await Promise.all(legParts.map(part=>new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(mesh({...part,image}));
      image.onerror=()=>reject(new Error("腿脚素材无法载入"));
      image.src="gesture-art/leg_reference_"+part.name+".webp?v=1";
    })));
    return (ctx,poses)=>{
      ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
      const far=poses[0][3]+poses[0][4]>poses[1][3]+poses[1][4]?1:0;
      legs[far](ctx,poses[far]);
      legs[1-far](ctx,poses[1-far]);
    };
  };

  function captureLeg(frame,indices) {
    const {skeleton,worldPose,aspect}=frame;
    const [hip,knee,ankle,toe]=indices.map(index=>skeleton?.[index]);
    const visible=point=>point?.visibility>=.53&&point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1;
    if(![hip,knee,ankle].every(visible)) return null;
    const vector=(a,b)=>({x:(a.x-b.x)*aspect,y:b.y-a.y});
    const thigh=vector(hip,knee),shin=vector(knee,ankle);
    const thighSize=Math.hypot(thigh.x,thigh.y),shinSize=Math.hypot(shin.x,shin.y);
    if(thighSize<.025||shinSize<.025) return null;
    const angle=v=>Math.atan2(v.y,v.x);
    const lift=clamp(wrap(angle(thigh)-Math.PI/2)/radians,-38,38);
    const flex=clamp(wrap(angle(shin)-angle(thigh))/radians,-62,62);
    const foot=visible(toe)?clamp(wrap(angle(vector(ankle,toe))-angle(shin))/radians,-33,33):0;
    const shortcut=(a,b)=>{
      const p=worldPose?.[indices[a]],q=worldPose?.[indices[b]];
      if(!p||!q) return 1;
      const xy=Math.hypot(q.x-p.x,q.y-p.y);
      const length=Math.hypot(xy,q.z-p.z);
      return length>.02?clamp(xy/length+.08,.53,1):1;
    };
    return [lift,flex,foot,shortcut(0,1),shortcut(1,2)].map(value=>Math.round(value*1000)/1000);
  }
  window.readSakiLegs=frame=>[[23,25,27,31],[24,26,28,32]].map(indices=>captureLeg(frame,indices));
})();
