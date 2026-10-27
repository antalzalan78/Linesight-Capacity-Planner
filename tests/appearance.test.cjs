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
