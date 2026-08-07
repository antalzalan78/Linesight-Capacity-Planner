const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const calc=require('../src/calculations.js');

test('percentage calculation handles normal and zero totals',()=>{
  assert.equal(calc.percent(80,100),80);
  assert.equal(calc.percent(1,3),33);
  assert.equal(calc.percent(10,0),0);
});

test('daily unit capacity includes line rate, OEE, shift length and active shifts',()=>{
  assert.equal(calc.dailyCapacity({
    rate:450,oee:0.72,shiftLength:8,activeShifts:2,basis:'units',
  }),5184);
});

test('daily minute capacity uses only available effective production minutes',()=>{
  assert.equal(calc.dailyCapacity({
    rate:999,oee:0.72,shiftLength:8,activeShifts:2,basis:'minutes',
  }),691);
});

test('workforce availability and required operators include absence',()=>{
  assert.equal(calc.availableLaborHours({
    operators:20,contractHours:40,absenceRate:8,workingDays:5,
  }),736);
  assert.equal(calc.operatorsNeeded({
    requiredHours:800,contractHours:40,absenceRate:8,workingDays:5,
  }),22);
});

test('contract hours spread over the working week the site actually runs',()=>{
  // 36 h over 5 days is 7.2 h/day, but over 4.5 days it is a full 8 h/day
  assert.equal(calc.contractDailyHours(36,5),7.2);
  assert.equal(calc.contractDailyHours(36,4.5),8);
  assert.equal(calc.contractDailyHours(36,7),36/7);
  assert.equal(calc.contractDailyHours(36,0),7.2); // guard: fall back to a 5-day week
  // one person covers one 8 h position exactly on a 4.5-day week, absence aside
  assert.equal(calc.availableLaborHours({
    operators:1,contractHours:36,absenceRate:0,workingDays:4.5,standardDays:4.5,
  }),36);
  assert.equal(calc.operatorsNeeded({
    requiredHours:36,contractHours:36,absenceRate:0,workingDays:4.5,standardDays:4.5,
  }),1);
  // a 7-day operation needs far more people for the same position
  assert.equal(calc.operatorsNeeded({
    requiredHours:8*7,contractHours:36,absenceRate:0,workingDays:7,standardDays:7,
  }),2);
});

test('month-end carry can be absorbed by later free working-day capacity',()=>{
  assert.equal(calc.monthEndCarry({
    daysInMonth:5,
    loadsByDay:{1:250,3:50},
    dayCapacity:100,
    isWorkingDay:()=>true,
  }),0);
});

test('month-end carry remains when later capacity cannot absorb the load',()=>{
  assert.equal(calc.monthEndCarry({
    daysInMonth:5,
    loadsByDay:{5:150},
    dayCapacity:100,
    isWorkingDay:()=>true,
  }),50);
});

test('non-working days do not add capacity but later working days can clear carry',()=>{
  assert.equal(calc.monthEndCarry({
    daysInMonth:3,
    loadsByDay:{2:100},
    dayCapacity:100,
    isWorkingDay:day=>day!==2,
  }),0);
});

test('basis shortfall converts proportionally back to units and product groups',()=>{
  const shortUnits=calc.basisShortfallToUnits({carry:300,totalLoad:1200,totalUnits:1000});
  assert.equal(shortUnits,250);
  assert.deepEqual(calc.allocateUnitsByGroup(shortUnits,{soda:600,bottle:400}),{
    soda:150,bottle:100,
  });
});

test('production completions aggregate by job and transaction date',()=>{
  assert.deepEqual(calc.aggregateCompletions([
    {job:'1100449',date:'2024-12-20',qty:399},
    {job:'1100449',date:'2024-12-20',qty:399},
    {job:'1100449',date:'2024-12-20',qty:399},
    {job:'1100449',date:'2024-12-21',qty:50},
    {job:'',date:'2024-12-20',qty:1405},
  ]),[
    {job:'1100449',date:'2024-12-20',qty:1197,rows:3},
    {job:'1100449',date:'2024-12-21',qty:50,rows:1},
  ]);
});

test('plan adherence is capped at planned quantity per batch',()=>{
  assert.equal(calc.cappedAdherence([
    {qty:100,produced:120},
    {qty:100,produced:50},
  ]),75);
});

test('planner loads the calculation module before the application script',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');
  const moduleAt=html.indexOf('<script src="./src/calculations.js"></script>');
  const appAt=html.indexOf('<script>',moduleAt);
  assert.ok(moduleAt>=0,'calculation module script is missing');
  assert.ok(appAt>moduleAt,'calculation module must load before the application script');
});
