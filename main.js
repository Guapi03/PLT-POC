import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setupAR } from './ar.js';

const $ = s => document.querySelector(s);
const partInfo = {
  bottle: { title:'01 / 瓶身', copy:'盛装液体的玻璃容器。瓶口开放，瓶底封闭；此样稿的容量与尺寸尚未实测校准。' },
  head: { title:'02 / 磨口上盖', copy:'通过 24/29 磨口与瓶身连接。抬起上盖时，两条导管会一起移动。' },
  long: { title:'03 / 长导管', copy:'延伸到瓶底附近的独立通道。隐藏瓶身后，可以更清楚地观察管路。' },
  short: { title:'04 / 短导管', copy:'与瓶内上部空间相通，与长导管保持独立。两侧弯管在上盖内不会互相连通。' },
};
const state = { loaded:false, lift:0, selected:null, view:'glass', hideBottle:false, autoRotate:false, inAR:false };
const host = $('#canvas-host');
let renderer;
try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'}); }
catch(error) { $('#load-message').textContent='当前浏览器无法启动 3D。请尝试更新浏览器或开启硬件加速。'; $('.spinner').hidden=true; throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');
host.append(renderer.domElement);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(34,1,.001,20);
camera.position.set(.42,.26,.63);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.07;controls.target.set(0,.15,0);
controls.minDistance=.18;controls.maxDistance=1.7;controls.maxPolarAngle=Math.PI*.88;controls.autoRotateSpeed=.7;
const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
const envTarget=pmrem.fromScene(room,.04);scene.environment=envTarget.texture;scene.environmentIntensity=.7;
room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe5f5ff,0x293b41,1.4));
const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(-.5,.8,1);scene.add(key);
const rim=new THREE.DirectionalLight(0xb8e8ff,2);rim.position.set(.5,.5,-.4);scene.add(rim);
const product=new THREE.Group();product.name='GlassBottle';scene.add(product);
const assembly=new THREE.Group();assembly.name='HeadAssembly';product.add(assembly);
const parts={bottle:[],head:[],long:[],short:[]};const originals=new Map();
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let model,ar;
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
const ctx=shadowCanvas.getContext('2d'), grad=ctx.createRadialGradient(64,64,4,64,64,62);
grad.addColorStop(0,'rgba(0,0,0,.4)');grad.addColorStop(.4,'rgba(0,0,0,.2)');grad.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(.24,.24),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=-.0005;scene.add(shadow);
function resize(){if(state.inAR)return;const r=host.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(state.loaded)fitView();}
new ResizeObserver(resize).observe(host);resize();
function fitView(resetAngle=false){
  if(!state.loaded||state.inAR)return;
  const box=new THREE.Box3().setFromObject(product), center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const direction=resetAngle?new THREE.Vector3(.38,.14,1).normalize():camera.position.clone().sub(controls.target).normalize();
  const vfov=THREE.MathUtils.degToRad(camera.fov), hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect);
  let d=Math.max(size.y/(2*Math.tan(vfov/2)),size.x/(2*Math.tan(hfov/2)))*1.32;
  const mobile=window.matchMedia('(max-width:620px)').matches;
  if(mobile)d*=1.1;
  center.y-=size.y*.025;controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,d);controls.update();
}
function saveMaterials(){model.traverse(obj=>{
  if(!obj.isMesh)return;
  obj.material=obj.material.clone();obj.material.envMapIntensity=.85;
  originals.set(obj,{material:obj.material.clone(),part:obj.userData.part});
});}
function applyAppearance(arMode=false){
  for(const [obj,saved] of originals){
    const base=saved.material,m=obj.material;m.copy(base);
    if(base.transmission>0){
      if(arMode){m.transmission=0;m.transparent=true;m.opacity=saved.part==='head'?.65:.28;m.depthWrite=false;m.roughness=saved.part==='head'?.5:.18;m.color.set(0xc8ebec);}
      else if(state.view==='solid'){m.transmission=0;m.transparent=false;m.opacity=1;m.roughness=.5;m.metalness=.08;m.color.set(saved.part==='head'?0x7daea7:0xc2d4db);}
      else {m.transmission=0;m.transparent=true;m.opacity=saved.part==='head'?.35:saved.part==='bottle'?.12:.28;m.depthWrite=false;m.roughness=saved.part==='head'?.35:.12;m.color.set(0xcde8ed);m.metalness=.05;}
    }
    if(!arMode&&state.selected===saved.part){m.emissive.set(0x1a7160);m.emissiveIntensity=.22;if(state.view==='solid')m.color.set(0x7be6cc);}
    m.needsUpdate=true;
  }
}
function selectPart(part){
  if(part!==null&&!Object.hasOwn(parts,part))throw new Error('Unknown part');
  state.selected=part;
  document.querySelectorAll('[data-part]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===part)));
  $('#detail-title').textContent=part?partInfo[part].title:'从外形，看到内部。';
  $('#detail-copy').textContent=part?partInfo[part].copy:'选择一个部件，查看它的位置与作用。';
  applyAppearance(state.inAR);return getState();
}
function setLift(value,{fit=true}={}){
  const mm=Number(value);if(!Number.isFinite(mm)||mm<0||mm>180)throw new Error('Lift must be between 0 and 180 mm');
  state.lift=mm;assembly.position.y=mm/1000;$('#lift').value=String(mm);$('#lift-value').innerHTML=`${Math.round(mm)} <small>mm</small>`;
  $('#assembly-toggle').textContent=mm>0?'复原组装 ↓':'抬起上盖 ↑';product.updateMatrixWorld(true);if(fit)fitView();ar?.invalidate();return getState();
}
function setHidden(hidden){state.hideBottle=!!hidden;parts.bottle.forEach(o=>o.visible=!hidden);$('#hide-bottle').checked=!!hidden;ar?.invalidate();return getState();}
function setView(view){if(!['glass','solid'].includes(view))throw new Error('Invalid view');state.view=view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});applyAppearance(state.inAR);return getState();}
function getState(){return {...state,parts:Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,v.length]))};}
function reset(){setLift(0);setHidden(false);selectPart(null);setView('glass');state.autoRotate=false;controls.autoRotate=false;$('#auto-rotate').checked=false;fitView(true);return getState();}
document.querySelectorAll('[data-part]').forEach(b=>b.addEventListener('click',()=>selectPart(state.selected===b.dataset.part?null:b.dataset.part)));
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#lift').addEventListener('input',e=>setLift(e.target.value));$('#assembly-toggle').addEventListener('click',()=>setLift(state.lift>0?0:180));
$('#hide-bottle').addEventListener('change',e=>setHidden(e.target.checked));$('#auto-rotate').addEventListener('change',e=>{state.autoRotate=e.target.checked;controls.autoRotate=state.autoRotate;});
$('#reset-camera').addEventListener('click',()=>fitView(true));$('#retry').addEventListener('click',()=>location.reload());
let down;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!state.loaded||state.inAR||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);raycaster.setFromCamera(pointer,camera);
  const meshes=Object.values(parts).flat().filter(o=>o.visible&&o.isMesh);const hits=raycaster.intersectObjects(meshes,false);
  selectPart(hits[0]?.object.userData.part||null);
});
async function load(){
  try{
    const gltf=await new GLTFLoader().loadAsync('./assets/glass-bottle.glb');model=gltf.scene;
    const b=new THREE.Box3().setFromObject(model),center=b.getCenter(new THREE.Vector3());model.position.set(-center.x,-b.min.y,-center.z);product.add(model);product.updateMatrixWorld(true);
    model.traverse(obj=>{if(!obj.isMesh)return;const name=obj.name;let part=name.includes('上盖')?'head':name.includes('长导管')?'long':name.includes('短导管')?'short':'bottle';obj.userData.part=part;parts[part].push(obj);});
    saveMaterials();[...parts.head,...parts.long,...parts.short].forEach(obj=>assembly.attach(obj));product.updateMatrixWorld(true);
    state.loaded=true;applyAppearance();fitView(true);$('#loading').hidden=true;
    const mm=Math.round(new THREE.Box3().setFromObject(product).getSize(new THREE.Vector3()).y*1000);$('#scale-note').textContent=`ASSEMBLED HEIGHT ≈ ${mm} mm`;
    ar=setupAR({THREE,renderer,scene,camera,controls,product,shadow,state,originals,applyAppearance,fitView,resize,getState});
    $('#open-ar').disabled=false;registerTools();
    document.dispatchEvent(new CustomEvent('glass-lab-ready',{detail:getState()}));
  }catch(error){console.error(error);$('#load-message').textContent='模型未能载入，请检查连接后重试。';$('#loading .spinner').hidden=true;$('#retry').hidden=false;}
}
let lastTime=0;
renderer.setAnimationLoop((time,frame)=>{const dt=Math.min((time-lastTime)/1000,.05);lastTime=time;if(state.inAR)ar?.onFrame(frame);else controls.update(dt);renderer.render(scene,camera);});
function registerTools(){
  const context=document.modelContext;if(!context?.registerTool)return;
  const controller=new AbortController();window.addEventListener('pagehide',()=>controller.abort(),{once:true});
  const tools=[
    {name:'read_glass_model_state',description:'Read visible glass bottle controls and selected part.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>getState()},
    {name:'configure_glass_model',description:'Change the same assembly and display controls available on the page. Does not enter AR.',inputSchema:{type:'object',properties:{lift_mm:{type:'number',minimum:0,maximum:180},hide_bottle:{type:'boolean'},part:{type:['string','null'],enum:['bottle','head','long','short',null]},view:{type:'string',enum:['glass','solid']}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){
      if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected object');
      for(const k of Object.keys(input))if(!['lift_mm','hide_bottle','part','view'].includes(k))throw new Error('Unknown setting');
      if('lift_mm'in input&&(typeof input.lift_mm!=='number'||!Number.isFinite(input.lift_mm)||input.lift_mm<0||input.lift_mm>180))throw new Error('Invalid lift');
      if('hide_bottle'in input&&typeof input.hide_bottle!=='boolean')throw new Error('Invalid hide_bottle');
      if('part'in input&&input.part!==null&&!Object.hasOwn(parts,input.part))throw new Error('Invalid part');
      if('view'in input&&!['glass','solid'].includes(input.view))throw new Error('Invalid view');
      if('lift_mm'in input)setLift(input.lift_mm);if('hide_bottle'in input)setHidden(input.hide_bottle);if('part'in input)selectPart(input.part);if('view'in input)setView(input.view);return getState();
    }},
    {name:'reset_glass_model',description:'Restore the assembled glass model, visibility and camera.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:reset}
  ];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(console.warn);}catch(e){console.warn(e);}}
}
load();
