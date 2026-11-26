const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const O=require('../src/operations-overview.js');
const T=require('../src/control-tower.js');
const {planner}=require('./helpers/planner.cjs');
const {towerUI}=require('./helpers/control-tower.cjs');
const base=()=>({start:'2026-11-01',end:'2026-11-30',today:'2026-11-26',focus:'2026-11-26',batches:[],ledger:{},calendars:[],labor:[],erp:{status:'loading'}});
const batch=(changes={})=>({index:0,date:'2026-11-23',dueDate:'2026-11-25',sku:'QA_NLC',job:'QA1',line:'Line1',qty:150,load:150,...changes});
const erp=()=>({version:1,stock:[],transactions:[],watch:[],imports:{},master:{items:{},issues:[]}});

test('focus scopes use local supplied dates, clip weeks to the selected month and avoid future actuals',()=>{
  const x=base();assert.deepEqual(O.scope(x),{start:x.start,end:x.end,today:x.today,focus:x.focus,asOf:x.today,weekStart:'2026-11-23',weekEnd:'2026-11-29',future:false});
  assert.equal(O.scope({...x,focus:'2026-11-30'}).weekEnd,'2026-11-30');
  assert.equal(O.scope({...x,start:'2027-01-01',end:'2027-01-31',focus:''}).focus,'2027-01-01');
  assert.equal(O.scope({...x,start:'2026-10-01',end:'2026-10-31',focus:''}).focus,'2026-10-31');
  assert.equal(O.scope({...x,focus:'2026-11-29'}).asOf,'2026-11-26');
});
test('a multi-day batch is spread through capacity, not treated as a start-day overload',()=>{
  const x=base();x.batches=[batch()];x.calendars=[{name:'Line1',days:{'2026-11-23':100,'2026-11-24':100}}];
  const m=O.build(x);assert.equal(m.daily.find(r=>r.date==='2026-11-23').planned,100);assert.equal(m.daily.find(r=>r.date==='2026-11-24').planned,50);
  assert.equal(m.totals.overloadedLines,0);assert.equal(m.week.planned,150);
  assert.equal(m.week.actual,null);assert.equal(m.day.actual,null);
});
test('FIFO sequencing and minutes-based loads preserve units and flag only uncleared month-end load',()=>{
  const x=base();x.batches=[batch({date:'2026-11-30',qty:120,load:60,seq:2}),batch({index:1,job:'QA2',date:'2026-11-30',qty:60,load:60,seq:1})];
  x.calendars=[{name:'Line1',days:{'2026-11-30':90}}];x.basis='runtime';
  const m=O.build(x);assert.equal(m.daily.at(-1).planned,120);assert.equal(m.plan.lines[0].spillLoad,30);assert.equal(m.plan.lines[0].spillUnits,60);assert.equal(m.totals.overloadedLines,1);
});
test('weekly comparison aligns plan and actual cutoff while retaining the full-week outlook',()=>{
  const x=base();x.batches=[batch(),batch({index:1,job:'QA2',date:'2026-11-27',load:200,qty:200})];
  x.calendars=[{name:'Line1',days:{'2026-11-23':150,'2026-11-27':200}}];x.ledger={a:{job:'QA1',date:'2026-11-23',qty:140}};
  const m=O.build(x);assert.equal(m.week.plannedToCutoff,150);assert.equal(m.week.planned,350);assert.equal(m.week.actual,140);
});
test('parked and offline-line batches cannot consume capacity and remain actionable',()=>{
  const x=base();x.batches=[batch({unalloc:true}),batch({index:1,job:'QA2',line:'Line8'})];x.calendars=[{name:'Line1',days:{'2026-11-23':1000}}];
  const m=O.build(x);assert.equal(m.week.planned,0);assert.equal(m.totals.parked,1);assert.equal(m.totals.schedule,1);
});
test('actual dated zero is distinct from missing data; no ERP production is added to completions',()=>{
  const x=base();x.ledger={a:{job:'QA1',date:'2026-11-26',qty:0},b:{job:'QA2',date:'2026-11-27',qty:100}};
  x.erp={status:'ready',groups:[],records:10000,productionDate:'2026-11-26',imports:{}};
  const m=O.build(x);assert.equal(m.day.actual,0);assert.equal(m.daily.find(r=>r.date==='2026-11-25').actual,null);assert.equal(m.daily.find(r=>r.date==='2026-11-27').actual,null);assert.equal(m.week.actual,0);
});
test('overdue uses explicit due dates and completion as of cutoff, not current completed status',()=>{
  const x=base();x.batches=[batch({produced:150,actualDate:'2026-11-27'}),batch({index:1,job:'QA2',dueDate:'2026-11-26'}),batch({index:2,job:'QA3',dueDate:''})];
  const m=O.build(x);assert.equal(m.totals.overdue,1);assert.equal(m.exceptions.find(e=>e.type==='overdue').remaining,150);
  assert.ok(m.exceptions.some(e=>e.index===2&&e.type==='data'));
});
test('ambiguous Jobs, undated completions and status-only completion never become verified overdue/remaining',()=>{
  const x=base();x.batches=[batch({produced:150}),batch({index:1,job:'DUP'}),batch({index:2,job:'DUP'}),batch({index:3,job:'DONE',status:'Completed'})];
  const m=O.build(x);assert.equal(m.totals.overdue,0);assert.equal(m.totals.dataIssues,4);assert.ok(m.exceptions.every(e=>e.remaining===null));
});
test('future due dates and actual production after the reporting cutoff do not leak into history',()=>{
  const x=base();x.focus='2026-11-24';x.batches=[batch()];x.ledger={a:{job:'QA1',date:'2026-11-26',qty:150}};
  const m=O.build(x);assert.equal(m.totals.overdue,0);assert.equal(m.week.actual,null);assert.equal(m.month.produced,0);
});
test('freshness uses data dates, not a recent upload timestamp, with an editable calendar-day rule',()=>{
  const x=base();x.warningDays=2;x.ledger={a:{job:'QA1',date:'2026-11-20',qty:20}};x.completionInfo={source:'synthetic.csv',at:'2026-11-26T10:00:00Z'};
  const m=O.build(x);assert.equal(m.sources[0].status,'stale');assert.equal(m.sources[0].age,6);assert.equal(m.sources[0].importedAt,x.completionInfo.at);
  assert.equal(O.build({...x,warningDays:6}).sources[0].status,'current');
  assert.equal(O.freshness('x',null,x.today,2).status,'missing');
});
test('stock assessment excludes future snapshots and HOLD, and preserves missing, partial and zero targets',()=>{
  const state=erp();state.monitors=T.defaultMonitors([]);state.monitors[0].groups=[{id:'one',name:'Known',skus:['A_NLC'],safetyStock:10},{id:'two',name:'Partial',skus:['A_NLC','B_NLC'],safetyStock:50}];
  // The same SKU cannot belong to two groups within a panel.
  state.monitors[0].groups[1].skus=['C_NLC','B_NLC'];
  state.stock=[{date:'2026-11-25',rows:[{sku:'A_NLC',location:T.AVAILABLE[0],available:5,onHand:5},{sku:'A_NLC',location:T.HOLD,available:999,onHand:999},{sku:'C_NLC',location:T.AVAILABLE[0],available:100,onHand:100}]},{date:'2026-11-27',rows:[]}];
  const out=O.erp(state,{asOf:'2026-11-26'});assert.equal(out.stockDate,'2026-11-25');assert.equal(out.groups[0].available,5);
  const m=O.build({...base(),erp:out});assert.equal(m.risks.length,1);assert.equal(m.unknownStock.length,1);assert.equal(m.unknownStock[0].gap,null);
  state.monitors[0].groups[0].safetyStock=0;assert.equal(O.build({...base(),erp:O.erp(state,{asOf:'2026-11-26'})}).risks.length,0);
});
test('ERP freshness and master coverage keep department/date scope and do not copy or modify transaction data',()=>{
  const state=erp();state.transactions=[{id:'1',date:'2026-11-25',sku:'A',qty:1,department:T.CFC},{id:'2',date:'2026-11-26',sku:'B',qty:1,department:'GAS'},{id:'3',date:'2026-11-27',sku:'A',qty:1,department:T.CFC}];
  const before=structuredClone(state),out=O.erp(state,{asOf:'2026-11-26'});
  assert.equal(out.productionDate,'2026-11-25');assert.equal(out.records,1);assert.equal(out.unmapped,1);assert.equal(out.transactions,undefined);assert.deepEqual(state,before);
});
test('workforce gaps preserve missing availability rather than presenting no operators as full coverage',()=>{
  const m=O.build({...base(),labor:[{label:'W1',required:100,available:null},{label:'W2',required:100,available:80},{label:'W3',required:100,available:120}]});
  assert.equal(m.labor[0].gap,null);assert.equal(m.totals.staffingWeeks,1);
});
test('assumed stock reporting dates remain explicitly qualified in freshness metadata',()=>{
  const state=erp();state.stock=[{date:'2026-11-20',dateBasis:'Assumed; confirm reporting date',rows:[]}];
  const m=O.build({...base(),erp:O.erp(state,{asOf:'2026-11-26'})});assert.equal(m.sources.find(s=>s.label==='Stock snapshot').dateBasis,state.stock[0].dateBasis);
});
test('overview adapter uses the existing monthly line/calendar/workforce overrides without changing the plan',()=>{
  const p=planner();p.set('curDate',new Date(2026,10,1));p.set('lineOvr',{'2026-10':[{name:'Line8',cap:100,pg:'soda',hc:2,actS:[true,false]}]});p.set('wfOvr',{'2026-10':{ops:3,contract:36,absence:10}});
  p.context.window.LineSightTowerUI={getOverview:()=>({status:'loading'})};
  const before=p.json('fullState()'),input=p.json("operationsOverviewContext('2026-11-26',2)");
  assert.deepEqual(input.calendars.map(l=>l.name),['Line8']);assert.equal(input.labor[1].available,97);assert.equal(input.labor[1].required,80);
  assert.equal(Object.values(input.calendars[0].days).reduce((s,v)=>s+v,0),16800);
  assert.deepEqual(p.json('fullState()'),before);assert.equal(p.storage.size,0);
});
test('the ERP read-only overview API exposes current aggregates without persisting',async()=>{
  const state=erp(),p=await towerUI(state),before=structuredClone(p.saved());
  assert.equal(p.api.getOverview({asOf:'2026-11-26'}).status,'ready');assert.deepEqual(p.saved(),before);
});
test('overview renders, escapes imported names and exports the same selected week without plan writes',()=>{
  const p=planner();p.set('curDate',new Date(2026,10,1));p.set('mps',[batch({job:'<script>bad</script>'})]);p.context.window.LineSightOverview=p.run('LineSightOverview');
  p.context.window.LineSightTowerUI={getOverview:()=>({status:'ready',groups:[],masterItems:0,masterIssues:0,unmapped:0,imports:{}})};
  p.context.exported=[];p.run('downloadCSV=(rows,name)=>exported.push({rows,name})');const before=p.json('fullState()');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','operations-overview-ui.js'),'utf8'),p.context);
  const html=p.elements.get('panel-overview').innerHTML;assert.match(html,/Operations|Batch action queue/);assert.ok(!html.includes('<script>bad</script>'));assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  p.context.window.LineSightOverviewUI.exportView();assert.equal(p.context.exported.length,1);assert.ok(p.context.exported[0].rows.some(r=>r[0]==='Freshness rule (calendar days)'));
  assert.deepEqual(p.json('fullState()'),before);assert.equal(p.storage.size,0);
});
test('overview date/queue filters, source controls and exported units remain aligned',()=>{
  const p=planner();p.set('curDate',new Date(2026,10,1));p.set('mps',[batch({unalloc:true}),batch({index:1,job:'QA2',dueDate:''})]);p.set('mpsBasis','runtime');
  p.context.window.LineSightOverview=p.run('LineSightOverview');p.context.window.LineSightTowerUI={getOverview:()=>({status:'loading'})};
  p.context.exported=[];p.run('downloadCSV=(rows,name)=>exported.push({rows,name})');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src','operations-overview-ui.js'),'utf8'),p.context);
  p.elements.get('ops-focus').onchange({target:{value:'2026-11-10'}});
  p.elements.get('ops-exception-filter').onchange({target:{value:'parked'}});
  p.elements.get('ops-freshness-days').onchange({target:{value:'0'}});
  p.context.window.LineSightOverviewUI.exportView();const rows=p.context.exported[0].rows;
  assert.equal(rows.find(r=>r[0]==='Focus date')[1],'2026-11-10');assert.equal(rows.find(r=>r[0]==='Freshness rule (calendar days)')[1],0);
  const dailyAt=rows.findIndex(r=>r[0]==='Daily production'),dailyRows=rows.slice(dailyAt+1,dailyAt+8);
  assert.deepEqual(Array.from(dailyRows,r=>r[0]),['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15']);
  const signalAt=rows.findIndex(r=>r[0]==='Signal');assert.equal(rows[signalAt+1][0],'Un-allocated');assert.equal(rows[signalAt+2].length,0);
  assert.ok(rows.some(r=>r[0]==='Line1'&&r[1]==='runtime'&&r[2]==='hours'));
});
