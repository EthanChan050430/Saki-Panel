(() => {
  "use strict";
  const mode=document.documentElement.dataset.live;
  if(!mode || document.documentElement.dataset.call || location.protocol!=="http:") return;
  const $=id=>document.getElementById(id);
  const buttons=new Set(["wave","wave-left","wave-both","blink","reset","idle","legs-demo"]);
  const parameters=["ParamAngleX","ParamAngleY","ParamAngleZ","ParamEyeBallX","ParamMouthOpenY","ParamHairBack"];
  for(const side of ["Left","Right"]) for(const joint of ["Lift","Knee","Foot"]) parameters.push("ParamLeg"+joint+side);
  const sender=window.crypto.randomUUID();
  const stream=new EventSource("/live/events");
  let applying=false,supportsLegs=false;
  let sendingHands=false, newestHands=null;
  let sendQueue=Promise.resolve();

  async function post(message) {
    const response=await fetch("/live/input",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sender,...message}),
    });
    if(!response.ok) throw new Error("直播控制未送达");
  }
  function send(message) {
    sendQueue=sendQueue.then(()=>post(message)).catch(()=>{
      $("live-connection").textContent="直播连接已断开";
    });
  }
  function tracking(message) {
    document.dispatchEvent(new CustomEvent("saki-tracking",{detail:message}));
  }
  async function sendHands() {
    if(sendingHands || !newestHands) return;
    sendingHands=true;
    const message=newestHands;
    newestHands=null;
    try {
      await post(message);
    } catch {
      $("live-connection").textContent="直播连接已断开";
    } finally {
      sendingHands=false;
      if(newestHands) sendHands();
    }
  }
  function set(name,value) {
    const input=$(name);
    if(!input) return;
    input.value=value;
    input.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function setToggle(id,active) {
    if(($(id).getAttribute("aria-pressed")==="true")!==Boolean(active)) $(id).click();
  }
  stream.onopen=()=>{$("live-connection").textContent="直播服务已连接";};
  stream.onerror=()=>{$("live-connection").textContent="直播连接已断开，正在重连";};
  stream.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.sender===sender) return;
    applying=true;
    try {
      if(message.type==="tracking") tracking(message);
      if(message.type==="set") set(message.name,message.value);
      if(message.type==="button") {
        if(message.name==="idle") setToggle("idle",message.autoplay);
        else if(message.name==="legs-demo") setToggle("legs-demo",message.legDemo);
        else $(message.name)?.click();
      }
      if(message.type==="state") {
        supportsLegs=Object.hasOwn(message,"legDemo");
        if(!supportsLegs&&mode==="control"&&!new URLSearchParams(location.search).has("view"))
          $("view-half").click();
        for(const name of parameters) set(name,message.parameters[name]??0);
        setToggle("idle",message.autoplay);
        setToggle("legs-demo",message.legDemo);
        tracking(message.hands??{right:null,left:null});
      }
    } finally {
      applying=false;
    }
  };
  if(mode!=="control") return;

  document.addEventListener("input",event=>{
    const {id,value}=event.target;
    if(!applying&&parameters.includes(id)&&(supportsLegs||!id.startsWith("ParamLeg")))
      send({type:"set",name:id,value:Number(value)});
  });
  document.addEventListener("click",event=>{
    const id=event.target.closest("button")?.id;
    if(!applying&&buttons.has(id)&&(supportsLegs||id!=="legs-demo")) send({type:"button",name:id});
  });
  $("copy-overlay").addEventListener("click",async()=>{
    const url=new URL("/Saki_Preview.html?mode=overlay",location.origin);
    if($("frame").dataset.framing==="full") url.searchParams.set("view","full");
    try {
      await navigator.clipboard.writeText(url.href);
      $("live-connection").textContent="已复制 OBS 地址";
    } catch {
      window.prompt("OBS 浏览器源地址",url.href);
    }
  });
  window.publishSakiTracking=hands=>{
    newestHands={type:"tracking",...hands};
    tracking(newestHands);
    sendHands();
  };
})();
