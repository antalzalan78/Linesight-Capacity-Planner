const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..','..');

// Load the real application, but do not start a browser session or cloud request.
function planner(){
  const html=fs.readFileSync(path.join(root,'linesight_monthly_planner14.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m=>m[1]).find(s=>s.includes('function render()'));
  const elements=new Map(),storage=new Map();
  function element(id=''){
    if(elements.has(id))return elements.get(id);
    const el={value:({shifts:2,shiftlen:8,oee:100,days:5})[id]??'',style:{},dataset:{},
      textContent:'',innerHTML:'',classList:{add(){},remove(){},toggle(){}},
      addEventListener(){},appendChild(){},contains(){return false;},focus(){},getAttribute(){return null;},rows:[],
      createTHead(){this.head=element(Symbol());return this.head;},createTBody(){this.body=element(Symbol());return this.body;},
      insertRow(){const row=element(Symbol());this.rows.push(row);return row;},getContext(){return {};}};
    elements.set(id,el);return el;
  }
  const context=vm.createContext({console,Date,Math,Map,Set,JSON,URL,encodeURIComponent,
    setTimeout:()=>1,clearTimeout(){},alert(){},confirm:()=>true,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,querySelector:element,querySelectorAll:()=>[],
      createElement:()=>element(Symbol()),addEventListener(){},activeElement:null},window:{},fetch:()=>{throw Error('Unexpected network request');}});
  vm.runInContext(fs.readFileSync(path.join(root,'src','calculations.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'src','production.js'),'utf8'),context);
  vm.runInContext(script.slice(0,script.lastIndexOf("document.getElementById('footer-date')")),context);
  const run=code=>vm.runInContext(code,context);
  const set=(name,value)=>{context.fixtureValue=value;run(name+'=fixtureValue;');delete context.fixtureValue;};
  const json=code=>JSON.parse(JSON.stringify(run(code)));
  return {run,set,json,context,elements,storage};
}
module.exports={planner};
