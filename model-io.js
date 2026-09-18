import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MAX_FILE_BYTES=25*1024*1024;
export function inspectGLB(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<20)throw new Error('文件不是有效的 GLB。');
  if(buffer.byteLength>MAX_FILE_BYTES)throw new Error('单个模型不能超过 25 MiB，请先精简模型或贴图。');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw new Error('请使用完整的 glTF 2.0 二进制文件（.glb）。');
  const n=view.getUint32(12,true);
  if(view.getUint32(16,true)!==0x4e4f534a||n+20>buffer.byteLength)throw new Error('GLB 文件结构不完整。');
  let data;try{data=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,n)).trim());}catch{throw new Error('无法读取 GLB 模型信息。');}
  const extensions=new Set([...(data.extensionsUsed||[]),...(data.extensionsRequired||[])]);
  if(['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].some(x=>extensions.has(x)))throw new Error('这个模型使用了 Draco、Meshopt 或 KTX2 压缩。请重新导出为未压缩 GLB，贴图使用 PNG/JPEG。');
  if(extensions.has('EXT_mesh_gpu_instancing')||(data.skins||[]).length||(data.animations||[]).length||(data.meshes||[]).some(m=>m.primitives?.some(p=>p.targets?.length)))throw new Error('当前版本用于静态配件。请应用骨骼/形态键并关闭动画、实例扩展后重新导出。');
  if(!(data.meshes||[]).length)throw new Error('模型中没有可显示的网格。');
  if(data.meshes.some(m=>m.primitives?.some(p=>p.mode!==undefined&&p.mode!==4)))throw new Error('请把线条或点转换成三角面网格后导出。');
  for(const resource of [...(data.buffers||[]),...(data.images||[])]){
    if(resource.uri&&!resource.uri.startsWith('data:'))throw new Error('模型引用了外部文件。请将所有贴图和网格嵌入同一个 GLB。');
  }
  for(const im of data.images||[]){
    if(im.mimeType&&!['image/png','image/jpeg'].includes(im.mimeType))throw new Error('当前版本支持 PNG/JPEG 贴图，请转换贴图格式后导出。');
    if(im.uri&&!/^data:image\/(png|jpeg);base64,/i.test(im.uri))throw new Error('请使用内嵌 PNG/JPEG 贴图。');
  }
  return data;
}
export async function parseModel(buffer){
  inspectGLB(buffer);
  const gltf=await new GLTFLoader().parseAsync(buffer,'');
  try{
    const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3());
    if(box.isEmpty()||![...box.min,...box.max].every(Number.isFinite)||Math.max(size.x,size.y,size.z)<1e-7)throw new Error('模型尺寸无效，请检查导出单位和网格。');
    gltf.scene.traverse(obj=>{if(obj.matrixWorld.determinant()<0)throw new Error('模型包含镜像负缩放。请在 Blender 中应用缩放并检查法线后导出。');if(obj.isMesh&&!obj.geometry.attributes.normal)obj.geometry.computeVertexNormals();});
    return gltf;
  }catch(error){disposeModel(gltf.scene);throw error;}
}
export function disposeModel(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(obj=>{if(!obj.isMesh)return;geometries.add(obj.geometry);for(const m of [].concat(obj.material||[])){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
}
