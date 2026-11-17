const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const T=require('../src/control-tower.js');
const matrix=(headers,rows)=>[headers,...rows];

test('stock includes only the selected Available locations and keeps HOLD separate',()=>{
  const input=matrix(['Item','Location','On Hand','Available','Committed'],[
    ['1000000001_NLC','NLC 3PL',100,80,900],['1000000001_NLC','NLC 3PL',30,25,900],
    ['1000000001_NLC','NLC Production WIP CFC',40,35,900],['1000000001_NLC','NLC to 3PL In Transit',20,15,900],
    ['1000000001_NLC','NLC 3PL HOLD',50,50,900],['1000000001_NLC','NLC Production Hold',1000,1000,900],
    ['1000000001_NLC','NLC Production WIP GAS',2000,2000,900],['Total',null,'3,340.0','3,205.0',9999]
  ]);
  const parsed=T.stock(input),row=T.inventory(parsed.rows,[{sku:'1000000001_NLC',minimum:200}])[0];
  assert.equal(row.available,155);assert.equal(row.blocked,50);assert.equal(row.status,'Below minimum');
  assert.equal(parsed.ignoredRows,1);assert.equal(parsed.issues.length,0);
});

test('a strategic SKU absent from the export is unknown, not a fabricated zero',()=>{
  const row=T.inventory([],[{sku:'MISSING_NLC',minimum:null}])[0];
  assert.equal(row.available,null);assert.equal(row.blocked,null);assert.equal(row.status,'Not in export');
});

test('minimum zero is preserved and an unset minimum does not imply healthy stock',()=>{
  const rows=[{sku:'A_NLC',location:T.AVAILABLE[0],available:10,onHand:10}];
  assert.equal(T.inventory(rows,[{sku:'A_NLC',minimum:0}])[0].status,'Above minimum');
  assert.equal(T.inventory(rows,[{sku:'A_NLC',minimum:null}])[0].status,'Minimum not set');
});

test('duplicate master rows cannot multiply the production fact table',()=>{
  const m=T.master(matrix(['Item Code2','Type','Type 2','Country','HC required'],[
    ['1000000001_NLC','Soda makers','DUO','Germany',16],['1000000001_NLC','Soda makers','DUO','Germany',17],
    ['1000000001_NLC','Soda makers','DUO','Switzerland',17]
  ]));
  assert.equal(Object.keys(m.items).length,1);assert.equal(m.duplicateRows,2);assert.equal(m.issues.length,0);
  assert.deepEqual(m.items['1000000001_NLC'].countries,['Germany','Switzerland']);
  const p=T.production([{id:'1',sku:'1000000001_NLC',qty:20,date:'2026-11-01',job:'1',line:'CFC-L1',department:T.CFC}],m.items,{});
  assert.equal(p.units,20);assert.equal(p.groups[0].label,'Soda makers');
});

test('conflicting master classifications are exposed rather than chosen by row order',()=>{
  const m=T.master(matrix(['Item Code2','Type'],[['A_NLC','Bottles'],['A_NLC','Accessory']]));
  assert.equal(m.items.A_NLC.group,'Conflicting masterdata');assert.equal(m.issues.length,1);
});

const headers=['Internal ID','Transaction Date','Item','Quantity','Type','Built','Job','Department','Machine / Line'];
const completion=(id,qty=25)=>[id,46327.6,'1000000001_NLC',qty,'Work Order Completion',0,'Work Order #123',T.CFC,'CFC-L1'];
test('production uses Quantity, not Built, and preserves the date of Excel timestamps',()=>{
  const r=T.transactions(matrix(headers,[completion(1)]));
  assert.equal(r.records[0].qty,25);assert.equal(r.records[0].date,T.date(46327));assert.equal(r.records[0].job,'123');
});

test('identical Internal IDs are deduplicated; distinct completions of one job remain distinct',()=>{
  const r=T.transactions(matrix(headers,[completion(1),completion(1),completion(2)]));
  assert.equal(r.records.length,2);assert.equal(r.duplicateRows,1);assert.equal(T.production(r.records).units,50);
});

test('conflicting IDs block imports and invalid quantities never become zero',()=>{
  const r=T.transactions(matrix(headers,[completion(1),completion(1,40),completion(2,'bad')]));
  assert.equal(r.issues.length,2);assert.equal(r.records.length,1);
  assert.equal(T.number('bad'),null);assert.equal(T.number('64,819,104.18223872'),64819104.18223872);
});

test('overlapping transaction exports merge idempotently and identify corrections',()=>{
  const original=T.transactions(matrix(headers,[completion(1),completion(2)])).records;
  const incoming=T.transactions(matrix(headers,[completion(2),completion(3)])).records;
  const first=T.mergeTransactions(original,incoming),again=T.mergeTransactions(first.records,incoming);
  assert.equal(first.records.length,3);assert.equal(first.added,1);assert.equal(again.added,0);assert.equal(again.unchanged,2);
  const changed=T.mergeTransactions(original,T.transactions(matrix(headers,[completion(1,10)])).records);
  assert.equal(changed.updated,1);assert.equal(changed.records[0].qty,10);
});

test('department, dates, line and master category filters intersect at the same grain',()=>{
  const rows=[{id:'1',date:'2026-11-01',department:T.CFC,line:'CFC-L1',sku:'A_NLC',qty:10},
    {id:'2',date:'2026-11-02',department:T.CFC,line:'CFC-L2',sku:'B_NLC',qty:20},
    {id:'3',date:'2026-11-01',department:'GAS',line:'GAS-L1',sku:'A_NLC',qty:100}];
  const master={A_NLC:{group:'Soda makers',family:'DUO'},B_NLC:{group:'Bottles',family:'Glass'}};
  const r=T.production(rows,master,{department:T.CFC,from:'2026-11-01',to:'2026-11-01',line:'CFC-L1',group:'Soda makers'});
  assert.equal(r.units,10);assert.equal(r.rows.length,1);assert.equal(r.days[0].qty,10);assert.equal(r.lines[0].qty,10);
});

test('unmatched SKUs and zero quantity transactions remain inspectable',()=>{
  const r=T.production([{id:'1',date:'2026-11-01',sku:'UNKNOWN_NLC',qty:0,line:'A',department:T.CFC},
    {id:'2',date:'2026-11-03',sku:'UNKNOWN_NLC',qty:5,line:'A',department:T.CFC}],{},{});
  assert.equal(r.unmapped,2);assert.equal(r.unmappedUnits,5);assert.equal(r.zeroRows,1);assert.equal(r.days.length,2);
  assert.equal(r.items[0].group,'Unmapped');
});

test('private source files and strategic watchlists are not embedded in public app code',()=>{
  assert.deepEqual(T.WATCH,[]);
  const root=path.join(__dirname,'..');
  assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/\.local\//);
  const worker=fs.readFileSync(path.join(root,'src','erp-import-worker.js'),'utf8');
  assert.match(worker,/importScripts\('\.\.\/vendor\/xlsx.full.min.js'/);
  assert.doesNotMatch(worker,/https?:\/\//);
  const ui=fs.readFileSync(path.join(root,'src','control-tower-ui.js'),'utf8');
  assert.match(ui,/indexedDB.open/);assert.doesNotMatch(ui,/fetch\(|localStorage.setItem/);
});

test('calendar charts preserve real day spacing and keep missing days null',()=>{
  const rows=T.calendar([{date:'2026-11-02',qty:20},{date:'2026-11-04',qty:10}],'2026-11-01','2026-11-05');
  assert.deepEqual(rows.map(r=>r.qty),[null,20,null,10,null]);
  assert.deepEqual(T.calendar([],'2026-11-01','2026-11-05'),[]);
});

test('backup validation rejects broken quantities and duplicate IDs before storage replacement',()=>{
  const state={version:1,master:{items:{},issues:[]},stock:[],transactions:[{id:'1',date:'2026-11-01',sku:'A_NLC',qty:10,line:'A',department:T.CFC}],imports:{},watch:[]};
  assert.equal(T.validateBackup(state),state);
  assert.throws(()=>T.validateBackup({...state,transactions:[{...state.transactions[0],qty:'bad'}]}));
  assert.throws(()=>T.validateBackup({...state,transactions:[state.transactions[0],state.transactions[0]]}));
});

test('Excel parsing worker runs offline and uses the same validated production adapter',async()=>{
  const vm=require('node:vm');
  const root=path.join(__dirname,'..'),messages=[];
  const scope={console,Date,Math,Map,Set,JSON,ArrayBuffer,Uint8Array,TextDecoder,TextEncoder,postMessage:m=>messages.push(m)};
  scope.self=scope;
  const ctx=vm.createContext(scope);
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.resolve(root,'src',file.split('?')[0]),'utf8'),ctx));
  vm.runInContext(fs.readFileSync(path.join(root,'src','erp-import-worker.js'),'utf8'),ctx);
  const raw='Internal ID,Transaction Date,Item,Quantity,Type\n1,46327,A_NLC,25,Work Order Completion\n';
  const buffer=new TextEncoder().encode(raw);
  await ctx.self.onmessage({data:{kind:'transactions',file:{name:'synthetic.csv',size:buffer.length,arrayBuffer:async()=>buffer.buffer}}});
  const result=messages.find(m=>m.result)?.result;
  assert.ok(result,JSON.stringify(messages));assert.equal(result.records[0].qty,25);assert.equal(result.issues.length,0);
});
