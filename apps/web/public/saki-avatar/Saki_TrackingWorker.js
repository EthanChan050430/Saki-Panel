"use strict";

let pose, hands, face;
async function start() {
  const {FilesetResolver,PoseLandmarker,HandLandmarker,FaceLandmarker}=await import("./tracking/vision_bundle.mjs");
  const assets=await FilesetResolver.forVisionTasks(new URL("./tracking/wasm",self.location.href).href);
  const options={runningMode:"VIDEO",minTrackingConfidence:.50};
  pose=await PoseLandmarker.createFromOptions(assets,{
    ...options,numPoses:1,baseOptions:{
      modelAssetPath:"./tracking/pose_landmarker_lite.task",delegate:"CPU",
    },
  });
  hands=await HandLandmarker.createFromOptions(assets,{
    ...options,numHands:2,baseOptions:{
      modelAssetPath:"./tracking/hand_landmarker.task",delegate:"CPU",
    },
  });
  try {
    face=await FaceLandmarker.createFromOptions(assets,{
      ...options,numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,
      baseOptions:{modelAssetPath:"./tracking/face_landmarker.task",delegate:"CPU"},
    });
  } catch(error) {
    console.warn("Saki face tracker",error.message);
  }
  postMessage({type:"ready",faceAvailable:Boolean(face)});
}
const initialization=start().catch(error=>postMessage({type:"error",message:error.message}));

function eyeMeasure(points,outer,inner,pairs,aspect) {
  const gap=(a,b)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
  const a=points[outer],b=points[inner];
  const span=gap(a,b);
  const aperture=pairs.reduce((sum,[top,bottom])=>sum+gap(points[top],points[bottom]),0);
  return {x:(a.x+b.x)*.5,y:(a.y+b.y)*.5,span,aperture:aperture/(3*Math.max(span,.001))};
}

function faceTrack(result,aspect) {
  const points=result.faceLandmarks[0];
  const matrix=result.facialTransformationMatrixes[0]?.data;
  if(!points || !matrix || matrix.length!==16) return null;
  const degrees=180/Math.PI;
  const categories=result.faceBlendshapes[0]?.categories??[];
  const scores=new Map(categories.map(item=>[item.categoryName,item.score]));
  const score=name=>scores.get(name)??0;
  let x0=1,y0=1,x1=0,y1=0;
  for(const {x,y} of points) {
    x0=Math.min(x0,x); y0=Math.min(y0,y);
    x1=Math.max(x1,x); y1=Math.max(y1,y);
  }
  // Face Geometry is right-handed and describes the unmirrored camera.
  const yaw=-Math.atan2(matrix[2],matrix[10])*degrees;
  const pitch=Math.atan2(matrix[6],Math.hypot(matrix[2],matrix[10]))*degrees;
  const roll=Math.atan2(matrix[4],matrix[5])*degrees;
  const gazeX=(score("eyeLookInLeft")+score("eyeLookOutRight")-
    score("eyeLookOutLeft")-score("eyeLookInRight"))*.5;
  const gazeY=(score("eyeLookDownLeft")+score("eyeLookDownRight")-
    score("eyeLookUpLeft")-score("eyeLookUpRight"))*.5;
  const outerRight=points[33],outerLeft=points[263];
  const innerRight=points[133],innerLeft=points[362];
  const between=(a,b)=>[(a.x+b.x)*.5,(a.y+b.y)*.5];
  return {bounds:[x0,y0,x1,y1],eyes:[
    (outerRight.x+innerRight.x+innerLeft.x+outerLeft.x)*.25,
    (outerRight.y+innerRight.y+innerLeft.y+outerLeft.y)*.25,
    outerLeft.x-outerRight.x,outerLeft.y-outerRight.y,
  ],features:[[points[1].x,points[1].y],between(points[13],points[14]),
    between(outerLeft,innerLeft),between(outerRight,innerRight)],
  lids:[
    eyeMeasure(points,33,133,[[160,144],[159,145],[158,153]],aspect),
    eyeMeasure(points,263,362,[[387,373],[386,374],[385,380]],aspect),
  ],
  values:[yaw,pitch,roll,
    score("eyeBlinkRight"),score("eyeBlinkLeft"),gazeX,gazeY,score("jawOpen")]};
}

onmessage=async ({data})=>{
  const {image,timestamp}=data;
  await initialization;
  try {
    const body=pose.detectForVideo(image,timestamp);
    const skeleton=body.landmarks[0]??null;
    const worldPose=body.worldLandmarks?.[0]??null;
    const handResult=hands.detectForVideo(image,timestamp);
    const handList=handResult.landmarks;
    const handedness=handResult.handedness.map(categories=>categories[0]?.categoryName??null);
    let head=null;
    if(face) {
      try {
        head=faceTrack(face.detectForVideo(image,timestamp),image.width/image.height);
      } catch(error) {
        console.warn("Saki face tracking",error.message);
        face.close();
        face=null;
        postMessage({type:"face-error"});
      }
    }
    postMessage({type:"landmarks",skeleton,worldPose,hands:handList,handedness,head,aspect:image.width/image.height});
  } catch(error) {
    postMessage({type:"error",message:error.message});
  } finally {
    image.close();
  }
};
