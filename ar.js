import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { FrontSide } from 'three';
import { applyMaterialAppearance } from './appearance.js';

export async function exportARModel(product,originals,{profile='bottle',settings}={}){
  const clone=product.clone(true),materials=[];
  const sources=[];product.traverse(obj=>{if(obj.isMesh)sources.push(obj);});
  let index=0;
  clone.traverse(obj=>{
    if(!obj.isMesh)return;
    const source=sources[index++];const cloned=[].concat(originals.get(source)?.material||source.material).map(base=>{
      const m=base.clone();materials.push(m);m.side=FrontSide;
      if(settings){const group=settings.groups.find(g=>g.id===source.userData.part);applyMaterialAppearance(m,base,{preset:group?.preset||'auto',glassOpacity:settings.glassOpacity,arMode:true});m.side=FrontSide;}
      else if(m.transmission>0){m.transmission=0;m.opacity=profile==='bottle'?(obj.userData.part==='head'?.65:.28):.3;m.transparent=true;m.depthWrite=false;
        if(profile==='bottle'){m.roughness=obj.userData.part==='head'?.5:.18;m.color.set(0xc8ebec);}}
      return m;
    });obj.material=cloned.length===1?cloned[0]:cloned;
  });
  clone.updateMatrixWorld(true);
  try{return await new USDZExporter().parse(clone,{quickLookCompatible:true,onlyVisible:true,maxTextureSize:1024,includeAnchoringProperties:true,ar:{anchoring:{type:'plane'},planeAnchoring:{alignment:'horizontal'}}});}
  finally{materials.forEach(m=>m.dispose());}
}

export function setupAR(api){
  const {THREE,renderer,scene,camera,controls,product,shadow,state,originals,applyAppearance,fitView,resize}=api;
  const $=s=>document.querySelector(s), dialog=$('#ar-dialog'), overlay=$('#xr-overlay');
  const probe=document.createElement('a');let quickLook=false;
  try{quickLook=probe.relList.supports('ar');}catch{}
  let canXR=false,session=null,hitSource=null,refSpace=null,placed=false,xrStarting=false;
  let cachedURL=null,cachedVersion=-1,version=0,preparing=null;
  const reticle=new THREE.Mesh(new THREE.RingGeometry(.036,.043,48).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x7be6cc,transparent:true,opacity:.85,side:THREE.DoubleSide}));reticle.matrixAutoUpdate=false;reticle.visible=false;scene.add(reticle);
  let savedPosition,savedQuaternion,savedScale;
  $('#site-link').value=location.href;
  const buttonSVG='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="104"><rect width="640" height="104" rx="14" fill="#7be6cc"/><text x="320" y="65" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#092a25">在相机中查看 ↗</text></svg>';
  $('#quicklook-link img').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(buttonSVG);
  async function capability(){
    try{canXR=!!(window.isSecureContext&&navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar'));}catch{canXR=false;}
    $('#ar-capability').textContent=canXR?'此设备支持网页 AR':quickLook?'此设备支持 Apple Quick Look':'用支持 AR 的手机打开此页面';
  }
  capability();
  function invalidate(){version++;}
  async function makeUSDZ(){
    if(cachedURL&&cachedVersion===version)return cachedURL;
    if(preparing)return preparing;
    const currentVersion=version;
    preparing=(async()=>{
      const bytes=await exportARModel(product,originals,{profile:state.profile,settings:state.settings});
      if(currentVersion!==version)throw new Error('模型已变化，请重新打开 AR。');
      const url=URL.createObjectURL(new Blob([bytes],{type:'model/vnd.usdz+zip'}));if(cachedURL)URL.revokeObjectURL(cachedURL);cachedURL=url;cachedVersion=currentVersion;return url;
    })();
    try{return await preparing;}finally{preparing=null;}
  }
  async function openDialog(){
    if(!state.loaded||state.busy||state.inAR||state.arStarting)return;
    $('#ar-feedback').textContent='';$('#ar-progress').hidden=true;$('#quicklook-link').hidden=true;$('#start-webxr').hidden=true;$('#desktop-help').hidden=true;
    dialog.showModal();await capability();
    if(!dialog.open)return;
    if(canXR){$('#ar-description').textContent='允许相机访问后，缓慢移动手机寻找桌面。出现圆环时，点击放置当前模型。';$('#start-webxr').hidden=false;}
    else if(quickLook){
      $('#ar-description').textContent='将当前装配状态转换为 iPhone AR 模型。准备完成后，点击下方按钮打开系统查看器。';$('#ar-progress').hidden=false;
      try{const url=await makeUSDZ();if(dialog.open){$('#quicklook-link').href=url+'#allowsContentScaling=0';$('#quicklook-link').hidden=false;}}
      catch(error){console.error(error);$('#ar-feedback').textContent='AR 文件准备失败，请关闭后重试。网页 3D 仍可正常使用。';}
      finally{$('#ar-progress').hidden=true;}
    }else{$('#ar-description').textContent='这个浏览器目前没有可用的 AR 入口。你仍然可以操作 3D 模型；在支持 AR 的手机浏览器中打开此网页，再点击“在空间中查看”。';$('#desktop-help').hidden=false;}
  }
  $('#open-ar').addEventListener('click',openDialog);$('#close-ar').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  $('#copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);$('#ar-feedback').textContent='链接已复制。';}catch{$('#site-link').focus();$('#site-link').select();$('#ar-feedback').textContent='请长按或手动复制上方链接。';}});
  function restore(){
    hitSource?.cancel();hitSource=null;session=null;refSpace=null;placed=false;reticle.visible=false;state.inAR=false;state.arStarting=false;xrStarting=false;
    product.visible=true;if(savedPosition)product.position.copy(savedPosition);if(savedQuaternion)product.quaternion.copy(savedQuaternion);if(savedScale)product.scale.copy(savedScale);
    shadow.visible=true;controls.enabled=true;applyAppearance();overlay.hidden=true;document.body.classList.remove('xr-active');renderer.setClearColor(0x000000,0);resize();fitView();
  }
  async function startXR(){
    if(xrStarting||session||state.busy||!state.loaded)return;xrStarting=true;state.arStarting=true;
    $('#start-webxr').disabled=true;$('#ar-feedback').textContent='';
    try{
      const next=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test'],optionalFeatures:['dom-overlay'],domOverlay:{root:overlay}});
      session=next;next.addEventListener('end',()=>queueMicrotask(restore),{once:true});
      const viewer=await next.requestReferenceSpace('viewer');hitSource=await next.requestHitTestSource({space:viewer});
      savedPosition=product.position.clone();savedQuaternion=product.quaternion.clone();savedScale=product.scale.clone();
      state.inAR=true;placed=false;product.visible=false;shadow.visible=false;controls.enabled=false;applyAppearance(true);
      overlay.hidden=false;document.body.classList.add('xr-active');$('#xr-status').textContent='缓慢移动手机，寻找桌面';$('#replace-model').hidden=true;$('#place-model').hidden=false;$('#place-model').disabled=true;
      next.addEventListener('select',()=>{if(!next.domOverlayState&&placed){placed=false;product.visible=false;}else if(!placed&&reticle.visible)place();});
      dialog.close();await renderer.xr.setSession(next);refSpace=renderer.xr.getReferenceSpace();
    }catch(error){
      console.error(error);if(session)await session.end().catch(()=>{});restore();
      if(!dialog.open)dialog.showModal();$('#ar-feedback').textContent='无法启动 AR。请确认已允许相机访问，并使用支持 AR 的手机浏览器。';
    }finally{$('#start-webxr').disabled=false;xrStarting=false;state.arStarting=false;}
  }
  function place(){
    if(!session||!reticle.visible)return;
    const scale=new THREE.Vector3();reticle.matrix.decompose(product.position,product.quaternion,scale);
    product.scale.copy(savedScale);product.visible=true;placed=true;reticle.visible=false;
    $('#xr-status').textContent='模型已放置 · 可移动手机观察';$('#place-model').hidden=true;$('#replace-model').hidden=false;
  }
  $('#start-webxr').addEventListener('click',startXR);$('#place-model').addEventListener('click',place);
  $('#replace-model').addEventListener('click',()=>{placed=false;product.visible=false;$('#replace-model').hidden=true;$('#place-model').hidden=false;$('#place-model').disabled=true;$('#xr-status').textContent='重新寻找桌面';});
  $('#exit-ar').addEventListener('click',()=>session?.end());
  for(const button of overlay.querySelectorAll('button'))button.addEventListener('beforexrselect',e=>e.preventDefault());
  function onFrame(frame){
    if(!frame||!hitSource||!refSpace||placed)return;
    const hits=frame.getHitTestResults(hitSource);let found=false;
    for(const hit of hits){const pose=hit.getPose(refSpace);if(!pose)continue;const matrix=new THREE.Matrix4().fromArray(pose.transform.matrix);const up=new THREE.Vector3(0,1,0).transformDirection(matrix);if(up.dot(new THREE.Vector3(0,1,0))<.85)continue;reticle.matrix.copy(matrix);found=true;break;}
    reticle.visible=found;$('#place-model').disabled=!found;$('#place-model').textContent=found?'放置在这里':'找到桌面后放置';$('#xr-status').textContent=found?'已找到平面，点击放置':'缓慢移动手机，寻找桌面';
  }
  window.addEventListener('pagehide',()=>{if(cachedURL)URL.revokeObjectURL(cachedURL);cachedURL=null;cachedVersion=-1;});
  return {invalidate,onFrame,makeUSDZ};
}
