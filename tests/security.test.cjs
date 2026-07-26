const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'linesight_monthly_planner14.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase','secure_auth_migration.sql'),'utf8');

test('cloud requests use the signed-in session token and owner id',()=>{
  assert.match(html,/Authorization:'Bearer '\+authSession\.access_token/);
  assert.match(html,/owner_id:authUser\.id/);
  assert.match(html,/if\(!authUser\)/);
});

test('email authentication uses the default sign-in link flow',()=>{
  assert.match(html,/Send sign-in link/);
  assert.match(html,/detectSessionInUrl:true/);
  assert.doesNotMatch(html,/id="auth-code"/);
  assert.doesNotMatch(html,/Verify and sign in/);
});

test('legacy open-access policy is removed from the planner instructions',()=>{
  assert.doesNotMatch(html,/create policy "open access"/i);
});

test('database migration removes anonymous access and scopes rows to auth.uid',()=>{
  assert.match(migration,/drop policy if exists "open access"/i);
  assert.match(migration,/revoke all on table public\.plans from anon/i);
  assert.match(migration,/to authenticated/i);
  assert.match(migration,/auth\.uid\(\)\) = owner_id/i);
  assert.doesNotMatch(migration,/for all using\s*\(\s*true\s*\)/i);
});

test('secret or service-role keys are not embedded in the application',()=>{
  assert.doesNotMatch(html,/eyJ[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(html,/sb_secret_/i);
});
