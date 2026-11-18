const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const T=require('../../src/control-tower.js');

// Exercise the actual UI handlers without reading or writing browser/user storage.
async function towerUI(initial,{failWrite=false}={}){
  let saved=initial?structuredClone(initial):undefined;
  const elements=new Map(),downloads=[],plots=[];
  const tabs=['materials','explorer','production','imports'].map(view=>({dataset:{view},setAttribute(){}}));
  const inputs=['master','stock','transactions'].map(kind=>({dataset:{import:kind},files:[]}));
  function element(id){
    if(elements.has(id))return elements.get(id);
    const value={id,innerHTML:'',textContent:'',value:'',dataset:{},style:{},disabled:false,
      parentElement:{innerHTML:''},setAttribute(){},appendChild(){},before(){},click(){},
      querySelectorAll:selector=>selector==='[data-view]'?tabs:selector==='[data-import]'?inputs:[]};
    elements.set(id,value);return value;
  }
  const db={transaction(){
    const tx={objectStore:()=>({get:()=>{const req={};queueMicrotask(()=>req.onsuccess?.({}));Object.defineProperty(req,'result',{get:()=>saved});return req;},
      put:next=>queueMicrotask(()=>{if(failWrite){tx.error=Error('Storage full');tx.onerror?.();}else{saved=structuredClone(next);tx.oncomplete?.();}})}),
      abort(){tx.onabort?.();}};
    return tx;
  }};
  const window={LineSightTower:T,Chart:true};
  const context=vm.createContext({console,Date,Math,Map,Set,JSON,Blob,queueMicrotask,
    document:{createElement:()=>element(Symbol()),querySelector:element,getElementById:element},window,
    indexedDB:{open(){const req={result:db};queueMicrotask(()=>req.onsuccess?.());return req;}},
    location:{hash:''},confirm:()=>true,setTimeout(){},
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:synthetic';},revokeObjectURL(){}},
    Chart:class{constructor(canvas,config){this.canvas=canvas;this.config=config;plots.push(this);}destroy(){this.destroyed=true;}},
    Worker:class{postMessage({kind,file}){queueMicrotask(()=>this.onmessage({data:{result:T[kind](file.matrix)}}));}terminate(){}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','..','src','control-tower-ui.js'),'utf8'),context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
  return {element,tabs,inputs,downloads,plots,flush,saved:()=>saved,html:()=>element('ct-body').innerHTML,
    view:kind=>tabs.find(t=>t.dataset.view===kind).onclick(),
    change:(id,value)=>{element(id).value=value;element(id).onchange({target:{value}});}};
}
module.exports={towerUI};
