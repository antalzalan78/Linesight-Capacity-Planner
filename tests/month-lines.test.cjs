const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');

// A month can run its own line allocation. Months without one share lineBase,
// so a shared edit must still reach every month that has no set of its own.
test('the line set is resolved per month',()=>{
  assert.match(html,/let lineBase\s*=/);
  assert.match(html,/let lineOvr\s*=\s*\{\}/);
  assert.match(html,/function linesFor\(m\)\{ return lineOvr\[m\]\|\|lineBase; \}/);
  assert.match(html,/function syncLines\(\)\{ lines=linesFor\(mk\(curDate\)\); \}/);
});

test('month-scoped calculations read that month own line set',()=>{
  assert.match(html,/function wkCap\(week,m,wi\)\{ return linesFor\(m\)\./);
  assert.match(html,/function wkDem\(week,m,wi,weeks\)\{ return PGS\.reduce/);
  assert.match(html,/function wkHC\(week, m, wi\)\{\s*return linesFor\(m\)\./);
  // backlog and MPS spill roll across months, so they must not read the visible month
  assert.match(html,/capacity\[g.key\]=linesFor\(m\)\.filter/);
  assert.match(html,/const pgL=linesFor\(m\)\.filter\(x=>x\.pg===line\.pg\)/);
  assert.match(html,/const line=linesFor\(m\)\.find\(l=>l\.name===name\)/);
});

test('the six-month summary uses each month own allocation',()=>{
  const both=html.match(/linesFor\(m2\)\.filter\(l=>l\.pg===g\.key\)/g)||[];
  assert.equal(both.length,2,'expected the monthly table and its CSV export to be month-scoped');
});

test('the visible month allocation is refreshed on every render',()=>{
  assert.match(html,/syncLines\(\);\s+\/\/ the month on screen/);
});

test('month-specific line sets are saved, restored and snapshotted',()=>{
  assert.match(html,/lines:lineBase, lineOvr, pgDemand, weekOvr, demandMode/); // localStorage + cloud
  assert.match(html,/lines:lineBase, lineOvr, pgDemand, weekOvr, blOpen/);     // scenario snapshot
  assert.match(html,/lineOvr=d\.lineOvr\|\|\{\}/);
  assert.match(html,/lineOvr=s\.lineOvr\|\|\{\}; syncLines\(\)/);
});

test('batches on a line the month does not run stay visible',()=>{
  assert.match(html,/const offRows=monthRows\.filter\(r=>!lines\.some\(l=>l\.name===r\.line\)\)/);
  assert.match(html,/id="mps-offline-note"/);
  assert.match(html,/not this month/);
});
