import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js';
// Hosting consumes _headers instead of serving it. Keep this in sync with dist/_headers.
const HOSTING_HEADERS=`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), xr-spatial-tracking=(self)

/assets/*.glb
  Content-Type: model/gltf-binary
`;
export async function buildWebsiteArchive({files,models,defaultId,getBytes,fetchAsset}){
 const archive={'_headers':strToU8(HOSTING_HEADERS)};
 for(const path of files){
  if(typeof path!=='string'||path.startsWith('/')||path.includes('..'))throw new Error('打包清单无效。');
  if(path==='_headers')continue;
  archive[path]=new Uint8Array(await fetchAsset(path));
 }
 const catalog=[];let total=0;
 for(const item of models){if(!/^[a-zA-Z0-9_-]+$/.test(item.id))throw new Error('模型编号无效。');const buffer=await getBytes(item);total+=buffer.byteLength;if(total>110*1024*1024)throw new Error('当前模型总量过大，请减少模型后导出。');const src=`assets/${item.id}.glb`;archive[src]=new Uint8Array(buffer);const entry={id:item.id,name:item.name,src,profile:item.profile||'generic',description:item.description||''};if(item.settings!==undefined)entry.settings=JSON.parse(JSON.stringify(item.settings));catalog.push(entry);}
 if(!catalog.length)throw new Error('没有可以导出的模型。');
 archive['models.json']=strToU8(JSON.stringify({version:1,defaultId:catalog.some(m=>m.id===defaultId)?defaultId:catalog[0].id,models:catalog},null,2));
 return zipSync(archive,{level:1});
}
