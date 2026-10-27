const test=require('node:test');
const assert=require('node:assert/strict');
const {planner}=require('./helpers/planner.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));

function client(cloud){
  const p=planner();
  p.run(`var localPlan={qty:100};fullState=()=>localPlan;applyFullState=s=>{localPlan=s};
    syncCfg={url:'https://test.supabase.co',key:'public-test',plan:'default',enabled:true};
    authUser={id:'user-1'};authSession={user:authUser,access_token:'test-session'};
    syncStartupJSON=JSON.stringify(localPlan);`);
  p.context.fetch=(...args)=>cloud.fetch(...args);
  if(cloud.row)p.run(`rememberSyncBase('${cloud.row.updated_at}',JSON.stringify(localPlan));`);
  return p;
}
function cloud(row={data:{qty:100},updated_at:'2026-10-13T10:00:00.000Z'}){
  return {row:row&&clone(row),calls:[],async fetch(url,options={}){
    this.calls.push({url,options});
    const method=options.method||'GET',query=new URL(url).searchParams;
    let result=[];
    if(method==='GET')result=this.row?[clone(this.row)]:[];
    if(method==='PATCH'){
      if(this.row&&query.get('updated_at')==='eq.'+this.row.updated_at){this.row=JSON.parse(options.body);result=[clone(this.row)];}
    }
    if(method==='POST'){
      if(this.row)return {ok:false,status:409,text:async()=> 'duplicate key'};
      this.row=JSON.parse(options.body)[0];result=[clone(this.row)];
    }
    return {ok:true,status:200,json:async()=>result};
  }};
}

test('a delayed pull cannot replace local edits made while downloading',async()=>{
  const c=cloud(),p=client(c);let finish;
  p.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const pull=p.run('cloudPull(true)');
  p.run('localPlan={qty:200};');
  finish({ok:true,json:async()=>[clone(c.row)]});await pull;
  assert.deepEqual(p.json('localPlan'),{qty:200});
  assert.equal(p.run('!!syncConflict'),true);
});

test('an old download cannot roll back a successfully uploaded revision',async()=>{
  const c=cloud(),p=client(c);let finish;
  p.context.fetch=(url,options={})=>options.method?c.fetch(url,options):new Promise(resolve=>{finish=resolve;});
  const pull=p.run('cloudPull(true)');
  p.run('localPlan={qty:200};');
  await p.run('cloudPush()');
  finish({ok:true,json:async()=>[{data:{qty:100},updated_at:'2026-10-13T10:00:00.000Z'}]});await pull;
  assert.equal(p.run('localPlan.qty'),200);
  assert.equal(p.run('syncConflict'),null);
  assert.equal(c.row.data.qty,200);
});

test('two devices cannot overwrite a newer cloud revision',async()=>{
  const c=cloud(),a=client(c),b=client(c);
  a.run('localPlan={qty:200};');b.run('localPlan={qty:300};');
  await a.run('cloudPush()');await b.run('cloudPush()');
  assert.deepEqual(c.row.data,{qty:200});
  assert.deepEqual(b.json('localPlan'),{qty:300});
  assert.equal(b.run('!!syncConflict'),true);
  assert.equal(c.calls.filter(v=>v.options.method==='PATCH').length,2);
});

test('concurrent first uploads use INSERT without overwriting an existing plan',async()=>{
  const c=cloud(null),a=client(c),b=client(c);
  a.run("rememberSyncBase(null,JSON.stringify(localPlan));localPlan={qty:200};");
  b.run("rememberSyncBase(null,JSON.stringify(localPlan));localPlan={qty:300};");
  await a.run('cloudPush()');await b.run('cloudPush()');
  assert.deepEqual(c.row.data,{qty:200});
  assert.equal(b.run('!!syncConflict'),true);
  assert.ok(c.calls.filter(v=>v.options.method==='POST').every(v=>!v.url.includes('on_conflict')));
});

test('refreshing the session for the same user does not download the plan',()=>{
  const c=cloud(),p=client(c);
  p.run("setAuthSession({user:{id:'user-1'},access_token:'refreshed-session'},true);");
  assert.equal(c.calls.length,0);
});

test('edits during upload remain dirty after the earlier snapshot was saved',async()=>{
  const c=cloud(),p=client(c);let finish;
  p.run('localPlan={qty:200};');
  p.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const push=p.run('cloudPush()');p.run('localPlan={qty:250};');
  finish({ok:true,json:async()=>[{updated_at:'2026-10-13T11:00:00.000Z'}]});await push;
  assert.deepEqual(p.json('localPlan'),{qty:250});
  assert.equal(p.run('JSON.parse(syncBaseline.json).qty'),200);
  assert.equal(p.run('pushT'),1);
});

test('choosing the cloud creates a persisted recovery version before replacement',async()=>{
  const c=cloud(),p=client(c);p.run('localPlan={qty:200};');
  await p.run('cloudPull(true)');await p.run("resolveSyncConflict('cloud')");
  assert.deepEqual(p.json('localPlan'),{qty:100});
  assert.equal(JSON.parse(p.storage.get('ls_plan_versions'))[0].state.qty,200);
  assert.equal(p.run('syncConflict'),null);
});

test('choosing local uses a conditional update and keeps a copy of the cloud plan',async()=>{
  const c=cloud(),p=client(c);p.run('localPlan={qty:200};');
  c.row={data:{qty:300},updated_at:'2026-10-13T12:00:00.000Z'};
  await p.run('cloudPull(true)');await p.run("resolveSyncConflict('local')");
  assert.equal(c.row.data.qty,200);
  assert.equal(JSON.parse(p.storage.get('ls_plan_versions'))[0].state.qty,300);
});

test('failure to persist a recovery version does not replace local data',async()=>{
  const c=cloud(),p=client(c);p.run('localPlan={qty:200};');
  await p.run('cloudPull(true)');
  p.context.localStorage.setItem=()=>{throw Error('Storage full');};
  await p.run("resolveSyncConflict('cloud')");
  assert.equal(p.run('localPlan.qty'),200);
  assert.equal(p.run('!!syncConflict'),true);
});

test('a deleted cloud plan is not recreated by a stale device',async()=>{
  const c=cloud(),p=client(c);c.row=null;p.run('localPlan={qty:200};');
  await p.run('cloudPush()');
  assert.equal(c.row,null);
  assert.equal(p.run('localPlan.qty'),200);
  assert.equal(c.calls.filter(v=>v.options.method==='POST').length,0);
});
