const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');

// Every table is rebuilt on each render, so the caret has to be restored by hand.
// Number inputs throw on selectionStart, which dropped the caret to the front of
// the field and made continuous typing impossible.
test('editable value fields are text inputs so the caret can be restored',()=>{
  const keyed=html.match(/<input[^>]*data-k="[^"]*"[^>]*>/g)||[];
  assert.ok(keyed.length>10,'expected the keyed value inputs to be found');
  const numeric=keyed.filter(tag=>/type="number"/.test(tag));
  assert.deepEqual(numeric,[],'keyed value fields must not use type="number"');
  keyed.forEach(tag=>{
    assert.match(tag,/inputmode="(numeric|decimal)"/,`missing inputmode: ${tag}`);
  });
});

test('caret position is captured and restored around a render',()=>{
  assert.match(html,/function focusSnapshot\(\)/);
  assert.match(html,/el\.setSelectionRange\(snap\.start,snap\.end\)/);
  assert.match(html,/const focus=focusSnapshot\(\);/);
  assert.match(html,/focusRestore\(focus\);/);
});

test('numeric fields reject letters without disturbing the caret',()=>{
  assert.match(html,/addEventListener\('beforeinput'/);
  assert.match(html,/\[\^0-9\.,\]\/g:\/\[\^0-9\]/); // decimal keeps , and . , plain numeric does not
  assert.match(html,/e\.preventDefault\(\);/);
  // a mixed paste is stripped rather than dropped, and the caret lands after it
  assert.match(html,/el\.setSelectionRange\(s\+clean\.length,s\+clean\.length\)/);
});
