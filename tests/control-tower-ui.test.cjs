const test=require('node:test');
const assert=require('node:assert/strict');
const {towerUI}=require('./helpers/control-tower.cjs');
const T=require('../src/control-tower.js');

const stockRows=Array.from({length:102},(_,i)=>({sku:'QA'+String(i).padStart(3,'0')+'_NLC',name:'Synthetic '+i,location:T.AVAILABLE[0],available:i+10,onHand:i+20}));
const state=()=>({version:1,revision:1,master:{items:{},issues:[]},transactions:[],watch:[],imports:{},stock:[{date:'2026-11-17',rows:stockRows,source:'synthetic.csv',at:'2026-11-17T09:00:00Z'}]});

test('UI renders stock-only data and keeps all filtered items in CSV when the table is paginated',async()=>{
  const p=await towerUI(state());
  assert.match(p.html(),/Stock items/);assert.match(p.html(),/Showing 1–100 of 102/);
  assert.equal((p.html().match(/data-item=/g)||[]).length,100);
  p.element('ct-material-next').onclick();
  assert.match(p.html(),/Showing 101–102 of 102/);assert.equal((p.html().match(/data-item=/g)||[]).length,2);
  p.element('ct-export').onclick();const csv=await p.downloads[0].text();
  assert.equal(csv.split('\r\n').length,103);assert.match(csv,/QA000_NLC/);assert.match(csv,/QA101_NLC/);
  p.element('ct-material-search').value='QA101';p.element('ct-apply-search').onclick();p.element('ct-export').onclick();
  assert.equal((await p.downloads[1].text()).split('\r\n').length,2);
  assert.match(p.html(),/Showing 1–1 of 1/);
});

test('empty strategic scope and no-match filters have actionable empty states',async()=>{
  const p=await towerUI(state());p.change('ct-stock-scope','watch');
  assert.match(p.html(),/Your strategic watchlist is empty/);assert.doesNotMatch(p.html(),/<canvas/);
  p.element('ct-reset-materials').onclick();assert.match(p.html(),/Showing 1–100 of 102/);
  p.element('ct-material-search').value='does-not-exist';p.element('ct-apply-search').onclick();assert.match(p.html(),/No materials match these filters/);
  p.element('ct-reset-materials').onclick();assert.match(p.html(),/Showing 1–100 of 102/);
});

test('stock import preview requires Apply, then opens the dashboard after durable storage succeeds',async()=>{
  const p=await towerUI();assert.match(p.html(),/No stock snapshot imported/);
  p.element('ct-open-imports').onclick();p.element('ct-stock-report-date').value='2026-11-16';
  const input=p.inputs.find(r=>r.dataset.import==='stock');
  input.files=[{name:'synthetic.csv',matrix:[['Item','Location','On Hand','Available'],['A_NLC',T.AVAILABLE[0],30,25]]}];
  input.onchange();await p.flush();
  assert.equal(p.saved(),undefined);assert.match(p.element('ct-message').textContent,/Click Apply import/);
  assert.match(p.element('ct-import-preview').innerHTML,/Apply import/);
  await p.element('ct-apply').onclick();
  assert.equal(p.saved().stock[0].date,'2026-11-16');assert.deepEqual(p.saved().watch,[]);
  assert.match(p.html(),/Imported stock detail/);assert.match(p.html(),/A_NLC/);
  assert.match(p.element('ct-message').textContent,/Stock snapshot saved for 2026-11-16/);
});

test('a failed import write keeps existing ERP data and does not claim dashboard success',async()=>{
  const initial=state(),p=await towerUI(initial,{failWrite:true});p.view('imports');p.element('ct-stock-report-date').value='2026-11-18';
  const input=p.inputs.find(r=>r.dataset.import==='stock');input.files=[{name:'synthetic.csv',matrix:[['Item','Location','On Hand','Available'],['NEW_NLC',T.AVAILABLE[0],1,1]]}];
  input.onchange();await p.flush();await p.element('ct-apply').onclick();
  assert.deepEqual(p.saved(),initial);assert.match(p.element('ct-message').textContent,/Import was not saved/);
  assert.equal(p.element('ct-apply').disabled,false);
});
