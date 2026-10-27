const test=require('node:test');
const assert=require('node:assert/strict');
const prod=require('../src/production.js');
const {planner}=require('./helpers/planner.cjs');
const row=(qty,date='2026-09-30',extra={})=>({job:'J1',date,qty,...extra});
const batch=(extra={})=>({job:'J1',date:'2026-09-28',dueDate:'2026-09-30',qty:100,...extra});
const ledger=rows=>prod.merge({},rows).ledger;

test('identical Job/day rows without IDs are legitimate partial completions',()=>{
  const out=ledger([row(399),row(399),row(399)]);
  assert.equal(Object.values(out)[0].qty,1197);
  assert.equal(Object.values(prod.merge(out,[row(399),row(399),row(399)]).ledger)[0].qty,1197);
});
test('a lower same-day snapshot is explicitly flagged and keeps quantity history',()=>{
  const old=ledger([row(60)]),result=prod.merge(old,[row(20)]);
  assert.equal(result.warnings.length,1);
  assert.equal(Object.values(old)[0].qty,60);
  assert.equal(Object.values(result.ledger)[0].history[0].qty,60);
});
test('incremental completions are deduplicated by their stable IDs across imports',()=>{
  const a=prod.merge({},[row(40,undefined,{id:'C1'})],{mode:'events'});
  const b=prod.merge(a.ledger,[row(40,undefined,{id:'C1'}),row(20,undefined,{id:'C2'})],{mode:'events'});
  assert.equal(Object.values(b.ledger)[0].qty,60);
  assert.equal(prod.merge(b.ledger,[row(20)],{mode:'events'}).errors.length,1);
  assert.equal(prod.merge({},[row(20,undefined,{id:'C1'}),row(20,undefined,{id:'C1'})],{mode:'events'}).errors.length,1);
});
test('correcting an event date moves its ID rather than counting it twice',()=>{
  const a=prod.merge({},[row(100,undefined,{id:'C1'})],{mode:'events'});
  const b=prod.merge(a.ledger,[row(100,'2026-10-01',{id:'C1'})],{mode:'events'});
  assert.ok(b.warnings.length>0);
  assert.equal(Object.values(b.ledger).reduce((s,v)=>s+v.qty,0),100);
});
test('a reduced event is flagged even if new events increase the daily total',()=>{
  const a=prod.merge({},[row(100,undefined,{id:'C1'})],{mode:'events'});
  const b=prod.merge(a.ledger,[row(50,undefined,{id:'C1'}),row(100,undefined,{id:'C2'})],{mode:'events'});
  assert.equal(Object.values(b.ledger)[0].qty,150);assert.ok(b.warnings.length>0);
});
test('undated manual reductions cannot leave a false 100 percent adherence',()=>{
  const metrics=prod.metrics([batch({manualProduction:{qty:50,date:null}})],ledger([row(100)]),{start:'2026-09-01',end:'2026-09-30'});
  assert.equal(metrics.adherence,null);assert.equal(metrics.undated,50);assert.equal(metrics.produced,0);
});
test('completion ratio and on-time adherence are distinct metrics',()=>{
  const batches=[batch()],data=ledger([row(100,'2026-10-01')]);
  const september=prod.metrics(batches,data,{start:'2026-09-01',end:'2026-09-30'});
  const october=prod.metrics(batches,data,{start:'2026-10-01',end:'2026-10-31'});
  assert.equal(september.completion,0);assert.equal(september.adherence,0);assert.equal(september.actual,0);
  assert.equal(october.actual,100);assert.equal(october.adherence,null);
  assert.equal(prod.summarize(batches[0],data).produced,100);
});
test('multi-day batches are measured against an explicit due date, not the start',()=>{
  const b=batch({date:'2026-09-01',dueDate:'2026-09-03'}),data=ledger([row(100,'2026-09-03')]);
  const metrics=prod.metrics([b],data,{start:'2026-09-01',end:'2026-09-30'});
  assert.equal(metrics.adherence,100);
  delete b.dueDate;
  const missing=prod.metrics([b],data,{start:'2026-09-01',end:'2026-09-30'});
  assert.equal(missing.adherence,null);assert.equal(missing.missingDue,1);
});
test('future due dates and undated actuals do not produce a false on-time success',()=>{
  const metrics=prod.metrics([batch({produced:100}),batch({job:'J2',dueDate:'2026-09-29'})],{},
    {start:'2026-09-01',end:'2026-09-30',asOf:'2026-09-20'});
  assert.equal(metrics.due,0);assert.equal(metrics.adherence,null);assert.equal(metrics.undated,100);
});
test('unmatched and ambiguous jobs remain in actual production, counted only once',()=>{
  const data=ledger([row(100)]),period={start:'2026-09-01',end:'2026-09-30'};
  assert.equal(prod.metrics([],data,period).actual,100);
  const ambiguous=prod.metrics([batch(),batch()],data,period);
  assert.equal(ambiguous.actual,100);assert.equal(ambiguous.produced,0);assert.equal(ambiguous.unmatched.length,1);
});
test('a manual reduction retains imported detail and reopens a completed batch',()=>{
  const data=ledger([row(100)]),b=batch({manualProduction:{qty:50,date:'2026-09-30'}});
  const summary=prod.summarize(b,data);
  assert.equal(summary.produced,50);assert.equal(summary.status,'In progress');assert.equal(summary.actualDate,'');
  assert.equal(Object.values(data)[0].qty,100);
  assert.equal(prod.metrics([b],data,{start:'2026-09-01',end:'2026-09-30'}).actual,50);
});
test('completion date is when cumulative actuals finish the batch, not the last extra unit',()=>{
  const data=ledger([row(60,'2026-09-28'),row(40,'2026-09-29'),row(10,'2026-09-30')]);
  assert.equal(prod.summarize(batch(),data).actualDate,'2026-09-29');
  assert.equal(prod.summarize(batch(),data).lastProductionDate,'2026-09-30');
});
test('dates and EU/US quantities are validated rather than silently changed to zero',()=>{
  assert.equal(prod.validDate('2026-02-30'),false);assert.equal(prod.validDate('2024-02-29'),true);
  assert.equal(prod.parseQuantity('1.200,00'),1200);assert.equal(prod.parseQuantity('1,200.00'),1200);
  assert.equal(prod.parseQuantity('abc'),null);
  const p=planner();assert.equal(p.run("parseAnyDate('99999')"),null);assert.equal(p.run("parseAnyDate('2026-02-30')"),null);
  assert.equal(p.run("parseAnyDate('45646')"),'2024-12-20');
});
test('HTML is escaped for both text and attribute contexts',()=>{
  assert.equal(prod.escapeHTML('<img src=x onerror="alert(1)"> & \'SKU\''),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;SKU&#39;');
});
test('application blocks a decreasing import until the correction checkbox is selected',()=>{
  const p=planner();p.run('render=()=>{};');p.set('productionLedger',ledger([row(60)]));
  p.set('completionPending',{rows:[row(20)],source:'partial.csv'});
  p.run('completionApply()');assert.equal(p.run('Object.values(productionLedger)[0].qty'),60);
  p.elements.get('completion-corrections').checked=true;
  p.run('completionApply()');assert.equal(p.run('Object.values(productionLedger)[0].qty'),20);
});
test('an unmatched import survives state restoration and attaches when its batch appears',()=>{
  const p=planner();p.run('render=()=>{};');p.set('completionPending',{rows:[row(100)],source:'daily.csv'});
  p.run('completionApply();var savedProduction=snapshotState();productionLedger={};applyState(savedProduction);');
  assert.equal(p.run('Object.values(productionLedger)[0].qty'),100);
  p.set('mps',[batch()]);p.run('reconcileProduction();');
  assert.equal(p.run('mps[0].produced'),100);assert.equal(p.run('batchDone(mps[0])'),true);
});
test('manual corrections and imported history are both preserved in plan snapshots',()=>{
  const p=planner();p.run('render=()=>{};');p.set('mps',[batch({produced:100,status:'Completed',completionByDate:{'2026-09-30':row(100)}})]);
  p.run("productionLedger=LineSightProduction.migrate(mps);setProduced(0,'50');var saved=snapshotState();applyState(saved);");
  assert.equal(p.run('batchDone(mps[0])'),false);assert.equal(p.run('mps[0].produced'),50);
  assert.equal(p.run('mps[0].completionByDate["2026-09-30"].qty'),100);
});
test('partial source files with invalid rows are blocked, even if corrections are approved',()=>{
  const p=planner();p.set('completionPending',{rows:[row(20)],skipped:['Bad row'],source:'partial.csv'});
  p.run("document.getElementById('completion-corrections').checked=true;");
  assert.equal(p.run('completionProposal().blocked'),true);
});
test('a stored status does not override a known lower produced quantity',()=>{
  const p=planner();
  assert.equal(p.run("batchDone({qty:100,produced:50,status:'Completed'})"),false);
  assert.equal(p.run("batchDone({qty:100,status:'Not completed'})"),false);
});
test('CSV formulas are treated as text while numeric values remain numeric',()=>{
  const p=planner();assert.equal(p.run("csvEscape('=1+1')"),"'=1+1");assert.equal(p.run('csvEscape(-20)'),'-20');
});

test('malicious SKU, Job, descriptions and status render as text throughout the MPS',()=>{
  const p=planner(),payload='\"><img src=x onerror=alert(1)>';
  p.run('curDate=new Date(2026,9,1);');
  p.set('skus',[{code:payload,pg:'soda',name:payload}]);
  p.set('mps',[{job:payload,sku:payload,line:'Line1',date:'2026-10-01',qty:100,status:payload}]);
  p.run('renderMPS();');
  const content=[...p.elements.values()].map(el=>el.innerHTML).join('\n');
  assert.ok(content.includes('&lt;img'));
  assert.ok(!content.includes('<img'));
});

test('MPS headers and rejected source values are escaped in the import preview',()=>{
  const p=planner(),payload='<img src=x onerror=alert(1)>';
  p.set('mpsRaw',[[payload,'Line','SKU','Qty'],['bad date','Line1',payload,10]]);
  p.run('mpsShowMapping();');
  assert.ok(!p.elements.get('mps-map').innerHTML.includes('<img'));
  p.run("showImpPreview([{m:'2026-9',pgKey:'soda',val:10}],['<img src=x onerror=alert(1)>']);");
  assert.ok(!p.elements.get('imp-preview').innerHTML.includes('<img'));
});
