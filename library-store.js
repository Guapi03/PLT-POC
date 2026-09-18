export async function createLibraryStore(){
  const memory=new Map();let db=null;
  try{
    db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('glass-lab-model-library',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('models',{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Storage blocked'));
    });
    db.onversionchange=()=>db.close();
  }catch{}
  async function run(mode,action){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('models',mode);let result;
      const req=action(tx.objectStore('models'));req.onsuccess=()=>{result=req.result;};
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Storage failed'));
    });
  }
  return {
    persistent:!!db,
    async list(){return db?run('readonly',store=>store.getAll()):[...memory.values()];},
    async put(record){if(db)await run('readwrite',store=>store.put(record));else memory.set(record.id,record);},
  };
}
