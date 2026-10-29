const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');
const root=html.match(/:root\{([\s\S]*?)\}/)[1];
const colors=Object.fromEntries([...root.matchAll(/--([\w-]+):(#\w{6})\b/g)].map(m=>[m[1],m[2]]));
function luminance(hex){
  const [r,g,b]=hex.slice(1).match(/../g).map(v=>{
    const c=parseInt(v,16)/255;
    return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
  });
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}

test('planner uses light surfaces and light native date controls',()=>{
  for(const key of ['bg','bg2','bg3'])assert.ok(luminance(colors[key])>0.8,`${key} must be a light surface`);
  assert.match(root,/color-scheme:light/);
  assert.doesNotMatch(html,/color-scheme:dark/);
});

test('text and semantic labels retain readable contrast on light surfaces',()=>{
  const pairs=[
    ['text','bg'],['text2','bg'],['text','bg2'],['text2','bg2'],['text','bg3'],['text2','bg3'],
    ['green','bg2'],['green-l','green-bg'],['blue-l','bg2'],['yellow','yellow-bg'],['red','red-bg']
  ];
  for(const [fg,bg] of pairs){
    const ratio=contrast(colors[fg],colors[bg]);
    assert.ok(ratio>=4.5,`${fg} on ${bg}: ${ratio.toFixed(2)}:1 is below 4.5:1`);
  }
});

test('charts and drag-and-drop chips no longer rely on white-on-dark styling',()=>{
  assert.doesNotMatch(html,/color:'#7a8299'|color:'rgba\(255,255,255,0\.04\)'/);
  assert.match(html,/\.mps-chip\{[^}]*background:rgba\(24,40,59,0\.07\)/);
  assert.match(html,/#mps-tray\{[^}]*border:2px dashed var\(--red\)/);
  assert.match(html,/button:focus-visible,input:focus-visible/);
});

test('production lines spans the weekly layout and scrolls without shrinking its columns',()=>{
  assert.match(html,/class="layout weekly-layout"/);
  assert.match(html,/#production-lines-card\{grid-area:lines;/);
  assert.match(html,/grid-template-areas:"parameters breakdown" "lines lines" "calendar utilisation"/);
  assert.match(html,/\.lines-table-scroll\{[^}]*overflow-x:auto/);
  assert.match(html,/#lines-table\{table-layout:fixed;width:100%;min-width:1052px;max-width:1280px;/);
  assert.match(html,/class="lines-table-scroll" role="region" aria-label="Production lines table" tabindex="0"/);
});

test('production line fields preserve large quantities and all three shift values',()=>{
  const {planner}=require('./helpers/planner.cjs');
  const p=planner(),rows=[];
  p.run("document.getElementById('shifts').value=3;");
  p.set('lines',[{name:'Line8',pg:'soda',cap:99999,oee:100,hcS:[999,123,456],hcIS:[987,654,321]}]);
  p.run("document.getElementById('lines-body');");
  p.elements.get('lines-body').appendChild=row=>rows.push(row.innerHTML);
  p.run('renderLines();');
  const row=rows[0];
  assert.match(row,/>Line8<\/option>/);
  assert.match(row,/value="99999"/);
  assert.equal((row.match(/class="numi shift-count"/g)||[]).length,6);
  for(const qty of [999,123,456,987,654,321])assert.ok(row.includes(`value="${qty}"`));
  assert.match(html,/#lines-table \.shift-count\{width:48px;min-width:48px;flex-shrink:0;/);
  assert.doesNotMatch(row,/width:26px/);
  assert.match(row,/class="si line-name"/);
  assert.match(row,/class="si line-product-group"/);
});

test('line names have reserved width and product group controls stay compact on wide monitors',()=>{
  assert.match(html,/#lines-table \.line-name\{min-width:144px;/);
  assert.match(html,/#lines-table \.line-product-group\{width:200px;max-width:200px;/);
  const table=html.match(/<table class="gt" id="lines-table">([\s\S]*?)<\/table>/)[1];
  const columns=[...table.matchAll(/<col style="width:(\d+)px;">/g)].map(m=>+m[1]);
  assert.deepEqual(columns,[168,128,88,200,200,224,44]);
  assert.equal(columns.reduce((a,b)=>a+b,0),1052);
});
