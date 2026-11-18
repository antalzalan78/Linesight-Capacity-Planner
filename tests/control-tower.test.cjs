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

test('a stock-only setup displays eligible items without masterdata or a private watchlist',()=>{
  const rows=[{sku:'A_NLC',location:T.AVAILABLE[0],name:'Sample material',available:20,onHand:25},
    {sku:'A_NLC',location:T.AVAILABLE[1],available:5,onHand:5},
    {sku:'B_NLC',location:T.HOLD,available:9,onHand:9},
    {sku:'OTHER_NLC',location:'Other warehouse',available:500,onHand:500}];
  const watch=[],catalog=T.materialCatalog(rows,watch,{},'all'),actual=T.inventory(rows,catalog);
  assert.deepEqual(catalog.map(r=>r.sku),['A_NLC','B_NLC']);assert.equal(catalog[0].category,'Unclassified');
  assert.equal(actual[0].name,'Sample material');assert.equal(actual[0].available,25);assert.equal(actual[0].minimum,null);
  assert.equal(actual[1].available,0);assert.equal(actual[1].blocked,9);assert.deepEqual(watch,[]);
});

test('stock overview preserves configured categories and minimums without expanding the strategic list',()=>{
  const rows=[{sku:'A_NLC',location:T.AVAILABLE[0],available:5,onHand:5},{sku:'B_NLC',location:T.AVAILABLE[2],available:8,onHand:8}];
  const watch=[{sku:'A_NLC',name:'Tracked',category:'Strategic',family:'Private family',minimum:10},
    {sku:'MISSING_NLC',name:'Missing',category:'Strategic',family:'Private family',minimum:null}];
  const items={A_NLC:{group:'Different',family:'Different'},B_NLC:{name:'Master name',group:'Bottles',family:'Glass'}};
  const all=T.materialCatalog(rows,watch,items,'all');
  assert.equal(all.length,2);assert.equal(all[0].category,'Strategic');assert.equal(all[0].minimum,10);
  assert.equal(all[1].name,'Master name');assert.equal(all[1].category,'Bottles');
  assert.equal(T.inventory(rows,all)[0].status,'Below minimum');
  const strategic=T.inventory(rows,T.materialCatalog(rows,watch,items,'watch'));
  assert.deepEqual(strategic.map(r=>r.sku),['A_NLC','MISSING_NLC']);assert.equal(strategic[1].available,null);
  all[0].minimum=100;assert.equal(watch[0].minimum,10);assert.equal(watch.length,2);
});

test('an empty strategic scope stays explicitly empty instead of silently displaying every stock item',()=>{
  const rows=[{sku:'A_NLC',location:T.AVAILABLE[0],available:1,onHand:1}];
  assert.deepEqual(T.materialCatalog(rows,[],{},'watch'),[]);
  assert.deepEqual(T.materialCatalog([],[],{},'all'),[]);
});

test('Control Tower asset versions are aligned across the page, UI and Excel worker',()=>{
  const root=path.join(__dirname,'..'),ui=fs.readFileSync(path.join(root,'src','control-tower-ui.js'),'utf8');
  const version=ui.match(/VERSION='([^']+)'/)[1],html=fs.readFileSync(path.join(root,'linesight_monthly_planner14.html'),'utf8');
  for(const asset of ['control-tower.js','control-tower-ui.js','control-tower.css'])assert.ok(html.includes('./src/'+asset+'?v='+version));
  assert.ok(fs.readFileSync(path.join(root,'src','erp-import-worker.js'),'utf8').includes('control-tower.js?v='+version));
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

test('classification choices merge case and whitespace variants without changing acronyms or real distinctions',()=>{
  const labels=T.labelOptions(['SODA MAKERS','Soda makers',' soda   makers ','DUO','duo','E-DUO','E DUO','é','e']);
  assert.deepEqual(labels.filter(v=>T.labelKey(v)==='soda makers'),['Soda makers']);
  assert.deepEqual(labels.filter(v=>T.labelKey(v)==='duo'),['DUO']);
  assert.ok(labels.includes('E-DUO'));assert.ok(labels.includes('E DUO'));assert.ok(labels.includes('é'));assert.ok(labels.includes('e'));
  assert.deepEqual(T.labelOptions(labels.slice().reverse()),T.labelOptions(labels));
});

test('new masterdata imports do not flag case-only classification differences as conflicts',()=>{
  const m=T.master(matrix(['Item Code2','Description','Type','Type 2','Type3','Generic'],[
    ['A_NLC','Same name','SODA MAKERS','DUO','BLACK','GENERIC'],
    ['A_NLC','Same name','Soda makers','duo','black','Generic'],
    ['B_NLC','Other name','soda makers','duo','black','generic']
  ]));
  assert.equal(m.issues.length,0);assert.equal(m.duplicateRows,1);assert.deepEqual(m.items.A_NLC.conflicts,[]);
  assert.equal(m.items.A_NLC.group,'Soda makers');assert.equal(m.items.A_NLC.family,'DUO');assert.equal(m.items.A_NLC.generic,'Generic');
  assert.equal(m.items.B_NLC.group,m.items.A_NLC.group);assert.equal(m.items.B_NLC.family,m.items.A_NLC.family);
});

test('canonical masterdata supports existing imports without mutating stored identifiers or descriptions',()=>{
  const source={A_NLC:{sku:'A_NLC',name:'Keep THIS description',group:'SODA MAKERS',family:'duo',generic:'GENERIC'},
    B_NLC:{sku:'B_NLC',name:'Another Description',group:'Soda makers',family:'DUO',generic:'Generic'}};
  const original=structuredClone(source);Object.values(source).forEach(Object.freeze);Object.freeze(source);
  const m=T.canonicalMaster(source);
  assert.equal(m.A_NLC.group,'Soda makers');assert.equal(m.A_NLC.family,'DUO');assert.equal(m.A_NLC.generic,'Generic');
  assert.equal(m.A_NLC.sku,'A_NLC');assert.equal(m.A_NLC.name,'Keep THIS description');assert.deepEqual(source,original);
});

test('classification filtering and group charts include every case variant without duplicating facts',()=>{
  const facts=[{id:'1',sku:'A_NLC',date:'2026-11-18',qty:10,department:T.CFC,line:'CFC-L1'},
    {id:'2',sku:'B_NLC',date:'2026-11-18',qty:20,department:T.CFC,line:'CFC-L2'},
    {id:'3',sku:'C_NLC',date:'2026-11-18',qty:40,department:T.CFC,line:'CFC-L1'}];
  const source={A_NLC:{name:'A',group:'SODA MAKERS',family:'duo',generic:'GENERIC'},B_NLC:{name:'B',group:'Soda makers',family:'DUO',generic:'Generic'},C_NLC:{name:'C',group:'Bottles',family:'Glass',generic:'Generic'}};
  for(const group of ['SODA MAKERS','Soda makers','soda makers']){
    const result=T.production(facts,source,{group,family:'dUo',generic:'generic'});
    assert.equal(result.rows.length,2);assert.equal(result.units,30);assert.deepEqual(result.groups,[{label:'Soda makers',qty:30}]);
    assert.equal(result.items[0].group,'Soda makers');assert.equal(result.items[0].family,'DUO');assert.equal(result.days[0].qty,30);
  }
  const all=T.production(facts,source);assert.equal(all.units,70);assert.equal(all.groups.length,2);
  assert.equal(all.groups.reduce((sum,r)=>sum+r.qty,0),all.units);
  assert.equal(T.production(facts,source,{group:'soda makers',line:'CFC-L1'}).units,10);
  assert.equal(T.production(facts,source,{sku:'a_nlc'}).units,0);
});

const headers=['Internal ID','Transaction Date','Item','Quantity','Type','Built','Job','Department','Machine / Line'];
const completion=(id,qty=25)=>[id,46327.6,'1000000001_NLC',qty,'Work Order Completion',0,'Work Order #123',T.CFC,'CFC-L1'];
test('production uses Quantity, not Built, and preserves the date of Excel timestamps',()=>{
  const r=T.transactions(matrix(headers,[completion(1)]));
  assert.equal(r.records[0].qty,25);assert.equal(r.records[0].date,T.date(46327));assert.equal(r.records[0].job,'123');
});

test('identical repeated Machine / Line columns are validated and count production only once',()=>{
  const result=T.transactions(matrix([...headers,'Machine / Line'],[[...completion(1),'CFC-L1'],[...completion(2),'CFC-L1']]));
  assert.equal(result.records.length,2);assert.equal(result.issues.length,0);assert.equal(result.warnings.length,1);
  assert.equal(result.records[0].line,'CFC-L1');assert.equal(T.production(result.records).units,50);
  assert.match(result.warnings[0],/Matching values or blanks are combined/);
});

test('repeated line columns coalesce non-empty values and preserve truly missing lines',()=>{
  const rows=[completion(1),completion(2),completion(3)];rows[0][8]=' ';rows[2][8]=null;
  const result=T.transactions(matrix([...headers,'Machine / Line'],[[...rows[0],'CFC-L2'],[...rows[1],''],[...rows[2],null]]));
  assert.deepEqual(result.records.map(r=>r.line),['CFC-L2','CFC-L1','Unspecified']);assert.equal(result.issues.length,0);
});

test('conflicting repeated line values block the import instead of silently choosing a line',()=>{
  const result=T.transactions(matrix([...headers,'Machine / Line'],[[...completion(1),'CFC-L2'],[...completion(2),'CFC-L1']]));
  assert.equal(result.issues.length,1);assert.match(result.issues[0],/Row 2: conflicting Machine \/ Line/);
  assert.match(result.issues[0],/CFC-L1 \/ CFC-L2/);assert.equal(result.records.length,1);assert.equal(result.records[0].id,'2');
});

test('repeated line headers are normalized without treating numbered legacy aliases as duplicates',()=>{
  const result=T.transactions(matrix([...headers,' machine / line ','Machine / Line2'],[[...completion(1),' CFC-L1 ','Other legacy value']]));
  assert.equal(result.issues.length,0);assert.equal(result.records[0].line,'CFC-L1');assert.equal(result.warnings.length,1);
  const blank=completion(2);blank[8]='';
  assert.equal(T.transactions(matrix([...headers,'Machine / Line2'],[[...blank,'CFC-L4']])).records[0].line,'CFC-L4');
});

test('every repeated line occurrence is checked, including a third conflicting column',()=>{
  const result=T.transactions(matrix([...headers,'Machine / Line','Machine / Line'],[[...completion(1),'CFC-L1','CFC-L3']]));
  assert.equal(result.records.length,0);assert.equal(result.issues.length,1);assert.equal(result.warnings.length,1);
});

test('duplicate quantity and ID headers remain blocked even if their values match',()=>{
  for(const [name,value] of [['Quantity',25],['Internal ID',1],['quantity',25]]){
    assert.throws(()=>T.transactions(matrix([...headers,name],[[...completion(1),value]])),/Duplicate column/);
  }
  assert.throws(()=>T.stock(matrix(['Item','Location','On Hand','Available','Available'],[['A_NLC',T.AVAILABLE[0],1,1,1]])),/Duplicate column/);
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
  const raw='Internal ID,Transaction Date,Item,Quantity,Type,Machine / Line,Machine / Line\n1,46327,A_NLC,25,Work Order Completion,CFC-L1,CFC-L1\n';
  const buffer=new TextEncoder().encode(raw);
  await ctx.self.onmessage({data:{kind:'transactions',file:{name:'synthetic.csv',size:buffer.length,arrayBuffer:async()=>buffer.buffer}}});
  const result=messages.find(m=>m.result)?.result;
  assert.ok(result,JSON.stringify(messages));assert.equal(result.records[0].qty,25);assert.equal(result.issues.length,0);assert.equal(result.records[0].line,'CFC-L1');assert.equal(result.warnings.length,1);
});
