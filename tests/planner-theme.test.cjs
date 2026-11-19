const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {planner}=require('./helpers/planner.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');
const theme=fs.readFileSync(path.join(__dirname,'..','src','planner-theme.css'),'utf8');

test('the reference-inspired theme uses a navy shell, light workspace and readable interface type',()=>{
  assert.match(html,/--navy:#002248;--light-blue:#7ebff4/);
  assert.match(html,/--bg:#f4f1ec;--bg2:#ffffff/);assert.match(html,/--font:'Century Gothic'/);
  assert.ok(html.indexOf('src/planner-theme.css')>html.indexOf('</style>'));
  assert.match(theme,/\.planner-rail\{[^}]*background:var\(--navy\)/);
  assert.match(theme,/\.planner-hero\{[^}]*linear-gradient\(120deg,#002248,#013a6b/);
  assert.match(theme,/\.metric-val\{[^}]*font-variant-numeric:tabular-nums/);
});

test('one accessible navigation preserves the original planner views and the Control Tower extension point',()=>{
  const nav=html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)[0];
  assert.equal((html.match(/<nav class="tabs"/g)||[]).length,1);
  assert.match(nav,/aria-label="Planner views"/);
  assert.deepEqual([...nav.matchAll(/data-panel="([^"]+)"/g)].map(m=>m[1]),['weekly','mps','monthly','backlog','demand','headcount','chart','scenarios']);
  assert.equal((nav.match(/<svg[^>]*aria-hidden="true"/g)||[]).length,8);
  assert.match(html,/aria-controls="planner-rail"/);assert.match(html,/class="skip-link" href="#planner-view-title"/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','src','control-tower-ui.js'),'utf8'),/button.dataset.panel='tower'/);
});

function navigationFixture(narrow=false){
  const p=planner(),classes=new Set(),buttons=p.json('Object.keys(plannerViews)').map(name=>({dataset:{panel:name},attributes:{},
    classList:{toggle(key,on){this[key]=on;}},setAttribute(key,value){this.attributes[key]=value;}}));
  p.context.window.matchMedia=()=>({matches:narrow});
  p.context.document.querySelectorAll=selector=>selector==='.tabs .tab'?buttons:[];
  p.context.document.body.classList={contains:name=>classes.has(name),remove:name=>classes.delete(name),
    toggle(name){if(classes.has(name)){classes.delete(name);return false;}classes.add(name);return true;}};
  return {...p,classes,buttons};
}

test('all nine views keep the breadcrumb, hero and selected navigation in sync without changing plan values',()=>{
  const p=navigationFixture(),before=p.json('fullState()');
  for(const name of p.json('Object.keys(plannerViews)')){
    p.set('activeTab',name);p.run('syncPlannerNavigation()');const copy=p.json('plannerViews[activeTab]');
    ['nav-current-view','planner-view-title','planner-view-description','planner-view-tag'].forEach((id,i)=>assert.equal(p.elements.get(id).textContent,copy[i]));
    assert.deepEqual(p.buttons.filter(b=>b.attributes['aria-current']==='page').map(b=>b.dataset.panel),[name]);
  }
  assert.deepEqual(p.json('fullState()'),before);
});

test('desktop navigation can collapse while the narrow menu closes and leaves hidden links inert',()=>{
  const desktop=navigationFixture();desktop.run('syncPlannerNavigation();togglePlannerNavigation();');
  assert.ok(desktop.classes.has('nav-collapsed'));assert.equal(desktop.elements.get('nav-toggle').attributes['aria-expanded'],'false');
  desktop.run('togglePlannerNavigation()');assert.equal(desktop.classes.has('nav-collapsed'),false);
  const mobile=navigationFixture(true);mobile.run('syncPlannerNavigation()');
  assert.equal(mobile.elements.get('planner-rail').inert,true);
  mobile.run('togglePlannerNavigation()');assert.ok(mobile.classes.has('nav-open'));
  assert.equal(mobile.elements.get('nav-toggle').attributes['aria-expanded'],'true');assert.equal(mobile.elements.get('planner-rail').inert,false);
  mobile.run('closePlannerNavigation()');assert.equal(mobile.classes.has('nav-open'),false);assert.equal(mobile.elements.get('planner-rail').inert,true);
});

test('the theme preserves scrollable planning tables, keyboard focus, reduced motion and report printing',()=>{
  assert.match(html,/min-width:1052px/);assert.match(html,/min-width:144px/);assert.match(html,/max-width:200px/);
  assert.match(theme,/@media\(max-width:1100px\)/);assert.match(theme,/@media\(max-width:700px\)/);
  assert.match(theme,/@media\(prefers-reduced-motion:reduce\)/);assert.match(theme,/@media print/);
  assert.match(theme,/\.planner-rail \.tab:focus-visible/);assert.match(html,/event.key==='Escape'/);
  assert.match(theme,/minmax\(min\(100%,420px\),1fr\)/);assert.match(theme,/\.mps-add-batch\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  const version=html.match(/planner-theme\.css\?v=([^" ]+)/)[1];
  assert.equal(version,html.match(/control-tower-ui\.js\?v=([^" ]+)/)[1]);
});
