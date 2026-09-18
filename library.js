import { buildWebsiteArchive } from './website-export.js';
import { createLibraryStore } from './library-store.js';
import { parseModel, MAX_FILE_BYTES } from './model-io.js';

const $=s=>document.querySelector(s);
const bytesLabel=n=>n>=1048576?`${(n/1048576).toFixed(1)} MiB`:`${Math.round(n/1024)} KiB`;
export function saveDownload(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function setupLibrary({activate,getActive,isBusy,onBusyChange=()=>{}}){
  const store=await createLibraryStore(),records=new Map();let pendingFile=null,busy=false;
  const manifest=await fetch('./models.json').then(r=>{if(!r.ok)throw new Error('模型目录读取失败，请检查 models.json。');return r.json();});
  for(const m of manifest.models||[]){if(typeof m.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(m.id)||typeof m.name!=='string'||!/^assets\/[a-zA-Z0-9_./-]+\.glb$/.test(m.src)||m.src.includes('..'))throw new Error('模型目录格式不正确。');records.set(m.id,{...m,published:true});}
  for(const r of await store.list()){if(r.blob||records.has(r.id))records.set(r.id,{...records.get(r.id),...r});}
  function entries(){return [...records.values()].filter(m=>!m.deleted);}
  function feedback(text,error=false,target='#library-feedback'){const el=$(target);el.textContent=text;el.classList.toggle('error',error);}
  function errorText(error){return error?.name==='QuotaExceededError'?'浏览器存储空间不足，请移除不需要的模型后重试。':error.message||'操作失败，请重试。';}
  async function getBytes(entry){if(entry.blob)return entry.blob.arrayBuffer();const r=await fetch('./'+entry.src);if(!r.ok)throw new Error('无法读取模型文件：'+entry.name);return r.arrayBuffer();}
  async function updateEntry(id,patch={}){
    if(busy||isBusy())throw new Error('请等待当前操作完成，或先退出 AR。');
    const item=records.get(id);if(!item||item.deleted)throw new Error('找不到这个模型。');
    const updated={...item};
    if(Object.hasOwn(patch,'name')){
      if(typeof patch.name!=='string'||!patch.name.trim())throw new Error('请输入模型名称。');
      const name=patch.name.trim();if(name.length>80)throw new Error('模型名称最多 80 个字符。');updated.name=name;
    }
    if(Object.hasOwn(patch,'description')){
      if(typeof patch.description!=='string')throw new Error('请输入有效的模型说明。');
      const description=patch.description.trim();if(description.length>300)throw new Error('模型说明最多 300 个字符。');updated.description=description;
    }
    if(Object.hasOwn(patch,'settings')){
      try{updated.settings=JSON.parse(JSON.stringify(patch.settings));}catch{throw new Error('模型设置无法保存，请检查后重试。');}
    }
    busy=true;setButtons();
    try{await store.put(updated);records.set(id,updated);render();return updated;}
    finally{busy=false;setButtons();}
  }
  async function choose(id,{close=false,prepared}={}){
    if((busy||isBusy())&&!prepared)throw new Error('请等待当前操作完成，或先退出 AR。');
    const item=records.get(id);if(!item||item.deleted)throw new Error('找不到这个模型。');
    busy=true;setButtons();
    try{await activate(item,prepared||await parseModel(await getBytes(item)));render();if(close)$('#library-dialog').close();}
    finally{busy=false;setButtons();$('#model-select').value=getActive()?.id||'';}
  }
  function setButtons(){
    onBusyChange(busy);
    $('#import-submit').disabled=busy;$('#export-library').disabled=busy;$('#model-select').disabled=busy;
    document.querySelectorAll('.library-actions button').forEach(b=>b.disabled=busy);
  }
  function render(){
    const items=entries(),active=getActive()?.id;$('#library-count').textContent=String(items.length);
    $('#model-select').replaceChildren();$('#library-list').replaceChildren();
    for(const item of items){
      const option=document.createElement('option');option.value=item.id;option.textContent=item.name;$('#model-select').append(option);
      const card=document.createElement('article');card.className='library-entry'+(active===item.id?' active':'');
      const title=document.createElement('h3');title.textContent=item.name;
      const note=document.createElement('p');note.textContent=(item.published?'网站内模型':'此浏览器添加')+(item.blob?' · '+bytesLabel(item.blob.size):'')+(active===item.id?' · 正在查看':'');
      const actions=document.createElement('div');actions.className='library-actions';
      function button(label,fn,cls){const b=document.createElement('button');b.type='button';b.textContent=label;if(cls)b.className=cls;b.onclick=()=>Promise.resolve(fn()).catch(e=>feedback(errorText(e),true));actions.append(b);return b;}
      button('查看',()=>choose(item.id,{close:true}));
      button('改名',()=>{
        if(busy||isBusy())return;
        const input=document.createElement('input');input.maxLength=80;input.value=item.name;input.setAttribute('aria-label','新的模型名称');title.replaceWith(input);actions.replaceChildren();
        const save=button('保存',async()=>{if(busy||isBusy())return;const updated=await updateEntry(item.id,{name:input.value});if(getActive()?.id===item.id){$('#model-title').textContent=updated.name;getActive().name=updated.name;}feedback('名称已保存。');});
        button('取消',render);input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();save.click();}if(e.key==='Escape'){e.preventDefault();render();}});input.focus();input.select();
      });
      if(item.id!=='glass-bottle'&&items.length>1)button('移除',()=>{
        if(busy||isBusy())return;
        actions.replaceChildren();const question=document.createElement('span');question.textContent='从模型库移除？';actions.append(question);
        button('确认移除',async()=>{
          if(busy||isBusy())return;
          if(active===item.id){const fallback=entries().find(m=>m.id!==item.id);await choose(fallback.id);}
          busy=true;setButtons();try{const deleted={id:item.id,deleted:true};await store.put(deleted);records.set(item.id,deleted);render();feedback('已从此浏览器的模型库移除。重新导出并部署后，网站上的列表才会更新。');}finally{busy=false;setButtons();}
        },'danger');button('取消',render);
      },'danger');
      card.append(title,note,actions);$('#library-list').append(card);
    }
    $('#model-select').value=active||'';setButtons();
  }
  function pick(file){
    if(!file||busy)return;pendingFile=file;$('#file-caption').textContent=file.name;$('#import-name').value=file.name.replace(/\.glb$/i,'').slice(0,80);feedback('已选择 '+file.name,false,'#import-feedback');
  }
  $('#model-file').addEventListener('change',e=>pick(e.target.files[0]));
  const zone=$('#drop-zone');for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.add('dragging');});
  for(const name of ['dragleave','drop'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('dragging');});
  zone.addEventListener('drop',e=>{pick(e.dataTransfer.files[0]);$('#model-file').required=false;});
  $('#import-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy||isBusy())return;
    const file=pendingFile,name=$('#import-name').value.trim();if(!file||!name){feedback('请选择 GLB 文件并填写名称。',true,'#import-feedback');return;}
    if(!/\.glb$/i.test(file.name)||file.size>MAX_FILE_BYTES){feedback('请选择不超过 25 MiB 的 .glb 文件。',true,'#import-feedback');return;}
    if(entries().reduce((sum,m)=>sum+(m.blob?.size||0),0)+file.size>100*1024*1024){feedback('此版本的本地模型总量上限为 100 MiB。请先移除不需要的模型。',true,'#import-feedback');return;}
    busy=true;setButtons();feedback('正在检查模型…',false,'#import-feedback');let prepared;
    try{
      prepared=await parseModel(await file.arrayBuffer());
      const item={id:'model-'+crypto.randomUUID(),name,blob:file,profile:'generic',description:'导入的配件模型'};
      await store.put(item);records.set(item.id,item);busy=false;
      await choose(item.id,{prepared,close:true});prepared=null;pendingFile=null;$('#import-form').reset();$('#model-file').required=true;$('#file-caption').textContent='选择或拖入 GLB 文件';
      feedback('模型已添加，可从“当前模型”切换查看。',false,'#import-feedback');
    }catch(error){if(prepared){const {disposeModel}=await import('./model-io.js');disposeModel(prepared.scene);}feedback(errorText(error),true,'#import-feedback');}
    finally{busy=false;setButtons();}
  });
  $('#model-select').addEventListener('change',e=>choose(e.target.value).catch(error=>{feedback(errorText(error),true);$('#library-dialog').showModal();$('#model-select').value=getActive()?.id||'';}));
  $('#export-library').addEventListener('click',async()=>{
    if(busy||isBusy())return;busy=true;setButtons();feedback('正在打包网页与模型…');
    try{
      const r=await fetch('./site-files.json');if(!r.ok)throw new Error('缺少打包文件清单。');const files=await r.json();
      const zip=await buildWebsiteArchive({files,models:entries(),defaultId:getActive()?.id,getBytes,fetchAsset:async path=>{const response=await fetch('./'+path);if(!response.ok)throw new Error('打包时无法读取 '+path);return response.arrayBuffer();}});
      saveDownload(new Blob([zip],{type:'application/zip'}),'glass-lab-website.zip');feedback('网站包已导出。上传此 ZIP 到 Cloudflare Pages；使用 Netlify 时先解压，再上传文件夹。');
    }catch(error){feedback(errorText(error),true);}finally{busy=false;setButtons();}
  });
  $('#import-submit').textContent='添加并查看';
  if(!store.persistent)feedback('浏览器存储不可用，模型只在本次页面中保留。请在关闭页面前导出网站包。',true);
  else feedback('保存在当前浏览器。清除网站数据会移除本地模型，请用导出网站包备份。');
  render();const initial=records.get(manifest.defaultId);await choose(initial&&!initial.deleted?initial.id:entries()[0]?.id);
  return {list:()=>entries().map(({id,name,profile,settings})=>({id,name,profile,hasSettings:settings!=null})),choose,getBytes,render,updateEntry};
}
