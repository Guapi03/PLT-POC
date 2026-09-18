import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { setupAR } from './ar.js';
import { setupLibrary,saveDownload } from './library.js';
import { disposeModel } from './model-io.js';

const $=s=>document.querySelector(s);
const bottleInfo={
 bottle:{title:'01 / 瓶身',copy:'盛装液体的玻璃容器。瓶口开放，瓶底封闭；容量与尺寸尚未实测校准。'},
 head:{title:'02 / 磨口上盖',copy:'通过 24/29 磨口与瓶身连接。抬起上盖时，两条导管会一起移动。'},
 long:{title:'03 / 长导管',copy:'延伸到瓶底附近的独立通道。隐藏瓶身后，可以更清楚地观察管路。'},
 short:{title:'04 / 短导管',copy:'与瓶内上部空间相通，与长导管保持独立。'}
};
const state={loaded:false,busy:false,lift:0,selected:null,view:'glass',hideBottle:false,autoRotate:false,inAR:false,modelId:null,profile:'bottle'};
const host=$('#canvas-host');let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}
catch(error){$('#load-message').textContent='当前浏览器无法启动 3D，请开启硬件加速或更换浏览器。';$('.spinner').hidden=true;throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');host.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.001,20);
camera.position.set(.42,.26,.63);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.target.set(0,.15,0);controls.maxPolarAngle=Math.PI*.88;controls.autoRotateSpeed=.7;
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();const envTarget=pmrem.fromScene(room,.04);scene.environment=envTarget.texture;scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe5f5ff,0x293b41,1.4));const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(-.5,.8,1);scene.add(key);const rim=new THREE.DirectionalLight(0xb8e8ff,2);rim.position.set(.5,.5,-.4);scene.add(rim);
const product=new THREE.Group();scene.add(product);const assembly=new THREE.Group();product.add(assembly);
const parts={},partInfo={},originals=new Map();let active=null,library,ar;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d'),grad=ctx.createRadialGradient(64,64,4,64,64,62);grad.addColorStop(0,'rgba(0,0,0,.4)');grad.addColorStop(.4,'rgba(0,0,0,.2)');grad.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.0005;scene.add(shadow);
function resize(){if(state.inAR)return;const r=host.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();if(state.loaded)fitView();}
new ResizeObserver(resize).observe(host);resize();
function fitView(resetAngle=false){
 if(!state.loaded||state.inAR)return;const box=new THREE.Box3().setFromObject(product),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 const radius=Math.max(size.length()/2,.0001),vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect);
 const d=radius/Math.sin(Math.min(vfov,hfov)/2)*(window.matchMedia('(max-width:620px)').matches?1.25:1.1);
 const direction=resetAngle?new THREE.Vector3(.38,.14,1).normalize():camera.position.clone().sub(controls.target).normalize();
 controls.minDistance=radius*.25;controls.maxDistance=d*8;camera.near=Math.max(radius/1000,.000001);camera.far=Math.max(d*20,10);camera.updateProjectionMatrix();controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,d);controls.update();
}
function applyAppearance(arMode=false){
 for(const [obj,saved] of originals){
  const current=[].concat(obj.material),bases=[].concat(saved.material);
  current.forEach((m,i)=>{
   const base=bases[i];m.copy(base);
   if(state.profile==='bottle'&&base.transmission>0){
    m.transmission=0;m.transparent=true;m.depthWrite=false;m.color.set(0xcde8ed);
    if(arMode){m.opacity=saved.part==='head'?.65:.28;m.roughness=saved.part==='head'?.5:.18;}
    else if(state.view==='solid'){m.transparent=false;m.opacity=1;m.depthWrite=true;m.roughness=.5;m.metalness=.08;m.color.set(saved.part==='head'?0x7daea7:0xc2d4db);}
    else{m.opacity=saved.part==='head'?.35:saved.part==='bottle'?.12:.28;m.roughness=saved.part==='head'?.35:.12;m.metalness=.05;}
   }else if(arMode&&base.transmission>0){m.transmission=0;m.transparent=true;m.opacity=.3;m.depthWrite=false;}
   else if(!arMode&&state.view==='solid'){if('transmission'in m)m.transmission=0;m.transparent=false;m.opacity=1;m.map=null;if(m.color)m.color.set(0xbad0d6);if('roughness'in m)m.roughness=.65;}
   if(!arMode&&state.selected===saved.part){if(m.emissive){m.emissive.set(0x1a7160);m.emissiveIntensity=.3;}else m.color?.set(0x7be6cc);if(state.view==='solid')m.color?.set(0x7be6cc);}m.needsUpdate=true;
  });
 }
}
function selectPart(part){
 if(part!==null&&!Object.hasOwn(parts,part))throw new Error('找不到这个部件。');state.selected=part;
 document.querySelectorAll('[data-part]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===part)));
 $('#detail-title').textContent=part?partInfo[part].title:'选择部件，查看模型。';$('#detail-copy').textContent=part?partInfo[part].copy:'点击模型或上方列表，定位一个部件。';applyAppearance(state.inAR);return getState();
}
function setLift(value,{fit=true}={}){const mm=Number(value);if(!Number.isFinite(mm)||mm<0||mm>180)throw new Error('抬起距离应为 0–180 mm。');if(state.profile!=='bottle'&&mm!==0)throw new Error('这个模型没有洗涤瓶拆装控制。');state.lift=mm;assembly.position.y=mm/1000;$('#lift').value=String(mm);$('#lift-value').textContent=Math.round(mm)+' mm';$('#assembly-toggle').textContent=mm>0?'复原组装 ↓':'抬起上盖 ↑';product.updateMatrixWorld(true);if(fit)fitView();ar?.invalidate();return getState();}
function setHidden(hidden){state.hideBottle=!!hidden;(parts.bottle||[]).forEach(o=>o.visible=!hidden);$('#hide-bottle').checked=!!hidden;ar?.invalidate();return getState();}
function setView(view){if(!['glass','solid'].includes(view))throw new Error('显示方式无效。');state.view=view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});applyAppearance(state.inAR);return getState();}
function getState(){return {...state,modelName:active?.name,parts:Object.entries(parts).map(([id,meshes])=>({id,name:partInfo[id].title,meshCount:meshes.length}))};}
function reset(){setLift(0);setHidden(false);selectPart(null);setView('glass');state.autoRotate=false;controls.autoRotate=false;$('#auto-rotate').checked=false;fitView(true);return getState();}
function drawParts(){
 $('#part-list').replaceChildren();const labels={bottle:'瓶身',head:'磨口上盖',long:'长导管',short:'短导管'};
 Object.keys(parts).forEach((id,i)=>{const b=document.createElement('button');b.className='part-button';b.dataset.part=id;b.setAttribute('aria-pressed','false');const number=document.createElement('span');number.className='part-number';number.textContent=String(i+1).padStart(2,'0');const label=document.createElement('span');label.textContent=labels[id]||partInfo[id].title;b.append(number,label);b.onclick=()=>selectPart(state.selected===id?null:id);$('#part-list').append(b);});$('#part-count').textContent=Object.keys(parts).length+' 个部件';
}
async function activate(entry,gltf){
 if(state.inAR)throw new Error('请先退出 AR。');
 state.loaded=false;ar?.invalidate();
 // All old meshes, including detached bottle assembly parts, live under product.
 disposeModel(product);for(const saved of originals.values())[].concat(saved.material).forEach(m=>m.dispose());originals.clear();product.clear();assembly.clear();assembly.position.set(0,0,0);product.add(assembly);product.position.set(0,0,0);product.quaternion.identity();product.scale.set(1,1,1);
 for(const key of Object.keys(parts))delete parts[key];for(const key of Object.keys(partInfo))delete partInfo[key];
 active=entry;state.modelId=entry.id;state.profile=entry.profile==='bottle'?'bottle':'generic';state.selected=null;state.lift=0;state.hideBottle=false;
 const model=gltf.scene;product.add(model);product.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(product),center=box.getCenter(new THREE.Vector3());model.position.sub(new THREE.Vector3(center.x,box.min.y,center.z));product.updateMatrixWorld(true);
 let index=0;if(state.profile==='bottle'){for(const [id,info] of Object.entries(bottleInfo)){parts[id]=[];partInfo[id]=info;}}
 model.traverse(obj=>{
  if(!obj.isMesh)return;let part;
  if(state.profile==='bottle')part=obj.name.includes('上盖')?'head':obj.name.includes('长导管')?'long':obj.name.includes('短导管')?'short':'bottle';
  else{part='mesh-'+index++;parts[part]=[];partInfo[part]={title:obj.name||'部件 '+index,copy:'这是导入模型中的独立网格。当前模型按文件中的尺寸显示。'};}
  obj.userData.part=part;parts[part].push(obj);const cloned=[].concat(obj.material).map(m=>m.clone());obj.material=cloned.length===1?cloned[0]:cloned;const base=cloned.map(m=>m.clone());originals.set(obj,{material:base.length===1?base[0]:base,part});
 });
 if(state.profile==='bottle')[...parts.head,...parts.long,...parts.short].forEach(obj=>assembly.attach(obj));
 const size=new THREE.Box3().setFromObject(product).getSize(new THREE.Vector3());shadow.scale.setScalar(Math.max(size.x,size.z)*2.2);shadow.position.y=-Math.max(size.y*.001,.00001);
 $('#model-title').textContent=entry.name;$('#model-subtitle').textContent=entry.description||'独立配件模型';$('#model-note').textContent=state.profile==='bottle'?'照片估算尺寸 · 容积未校准':'按 GLB 导出尺寸展示';$('#assembly-section').hidden=state.profile!=='bottle';document.querySelector('[data-view="glass"]').textContent=state.profile==='bottle'?'玻璃':'原始';
 $('#scale-note').textContent=`MODEL HEIGHT ≈ ${(size.y*1000).toLocaleString('en',{maximumFractionDigits:1})} mm`;
 state.loaded=true;drawParts();reset();$('#loading').hidden=true;
}
$('#lift').addEventListener('input',e=>setLift(e.target.value));$('#assembly-toggle').addEventListener('click',()=>setLift(state.lift>0?0:180));$('#hide-bottle').addEventListener('change',e=>setHidden(e.target.checked));$('#auto-rotate').addEventListener('change',e=>{state.autoRotate=e.target.checked;controls.autoRotate=state.autoRotate;});$('#reset-camera').addEventListener('click',()=>fitView(true));$('#retry').addEventListener('click',()=>location.reload());
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#download-model').addEventListener('click',async e=>{e.preventDefault();if(!active||!library)return;try{saveDownload(new Blob([await library.getBytes(active)],{type:'model/gltf-binary'}),active.name.replace(/[\\/:*?"<>|]/g,'-')+'.glb');}catch(error){$('#model-note').textContent=error.message;}});
let down;renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});renderer.domElement.addEventListener('pointerup',e=>{if(!state.loaded||state.inAR||state.busy||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=renderer.domElement.getBoundingClientRect();pointer.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(Object.values(parts).flat().filter(o=>o.visible),false);selectPart(hits[0]?.object.userData.part||null);});
ar=setupAR({THREE,renderer,scene,camera,controls,product,shadow,state,originals,applyAppearance,fitView,resize,getState});
let lastTime=0;renderer.setAnimationLoop((time,frame)=>{const dt=Math.min((time-lastTime)/1000,.05);lastTime=time;if(state.inAR)ar.onFrame(frame);else controls.update(dt);renderer.render(scene,camera);});
async function init(){
 try{library=await setupLibrary({activate,getActive:()=>active,isBusy:()=>state.inAR||state.arStarting,onBusyChange:busy=>{state.busy=busy;$('#open-ar').disabled=busy||!state.loaded;}});$('#open-ar').disabled=false;registerTools();}
 catch(error){console.error(error);$('#load-message').textContent='模型库未能载入：'+error.message;$('#loading .spinner').hidden=true;$('#retry').hidden=false;$('#library-feedback').textContent=error.message;}
}
function registerTools(){
 const context=document.modelContext;if(!context?.registerTool)return;const controller=new AbortController();window.addEventListener('pagehide',e=>{if(!e.persisted)controller.abort();});
 const tools=[
  {name:'read_glass_model_state',description:'Read the selected model, its mesh parts, and visible display controls.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:getState},
  {name:'list_model_library',description:'List available models in this browser and website.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>library.list()},
  {name:'select_library_model',description:'Select one existing model for 3D preview. Does not enter AR or import a file.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async({id})=>{await library.choose(id);return getState();}},
  {name:'configure_glass_model',description:'Change visible display controls. Lift and hide_bottle are available only for the bundled bottle.',inputSchema:{type:'object',properties:{lift_mm:{type:'number',minimum:0,maximum:180},hide_bottle:{type:'boolean'},part:{type:['string','null']},view:{type:'string',enum:['glass','solid']}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){
   if(state.busy||state.inAR)throw new Error('模型正忙，请稍后操作。');if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected object');for(const k of Object.keys(input))if(!['lift_mm','hide_bottle','part','view'].includes(k))throw new Error('Unknown setting');
   if('lift_mm'in input&&(typeof input.lift_mm!=='number'||!Number.isFinite(input.lift_mm)||input.lift_mm<0||input.lift_mm>180||state.profile!=='bottle'))throw new Error('Invalid lift');
   if('hide_bottle'in input&&(typeof input.hide_bottle!=='boolean'||state.profile!=='bottle'))throw new Error('Invalid hide_bottle');if('part'in input&&input.part!==null&&!Object.hasOwn(parts,input.part))throw new Error('Invalid part');if('view'in input&&!['glass','solid'].includes(input.view))throw new Error('Invalid view');
   if('lift_mm'in input)setLift(input.lift_mm);if('hide_bottle'in input)setHidden(input.hide_bottle);if('part'in input)selectPart(input.part);if('view'in input)setView(input.view);return getState();
  }},
  {name:'reset_glass_model',description:'Reset current model controls and camera.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:()=>{if(state.busy||state.inAR)throw new Error('模型正忙。');return reset();}}
 ];for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(console.warn);}catch(error){console.warn(error);}}
}
init();
