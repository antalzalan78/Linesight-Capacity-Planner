// Read-only ERP adapter verification; private reviewed data remains in ignored .local/.
const fs=require('node:fs');
const path=require('node:path');
const XLSX=require('../vendor/xlsx.full.min.js');
const T=require('../src/control-tower.js');
const folder=process.argv[2];
if(!folder)throw Error('Usage: node scripts/prepare-control-tower.cjs PATH_TO_ERP_EXPORT_FOLDER');
const out=path.join(__dirname,'..','.local');fs.mkdirSync(out,{recursive:true});
function load(file,parse){
  process.stderr.write('Reading '+file+'\n');
  const book=XLSX.read(fs.readFileSync(path.join(folder,file)),{type:'buffer',cellFormula:false,cellHTML:false});
  const matrix=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:null,raw:true});
  return parse(matrix);
}
const master=load('Masterdata.xlsx',T.master),stock=load('Stock_on_hand.xlsx',T.stock),transactions=load('Transactions.xlsx',T.transactions);
if(stock.issues.length||transactions.issues.length)throw Error(JSON.stringify({stock:stock.issues,transactions:transactions.issues}));
const watch=require(path.join(out,'strategic-watchlist.cjs'));
const at=new Date().toISOString(),stockDate=fs.statSync(path.join(folder,'Stock_on_hand.xlsx')).mtime.toLocaleDateString('sv-SE');
const data={version:1,master,transactions:transactions.records,stock:[{date:stockDate,dateBasis:'Assumed from file modification date; confirm the actual stock reporting date',rows:stock.rows,source:'Stock_on_hand.xlsx',at}],watch,imports:{
  master:{source:'Masterdata.xlsx',at,rows:master.sourceRows},stock:{source:'Stock_on_hand.xlsx',at,rows:stock.sourceRows},transactions:{source:'Transactions.xlsx',at,rows:transactions.sourceRows}
}};
fs.writeFileSync(path.join(out,'control-tower-seed.json'),JSON.stringify(data));
const prod=T.production(transactions.records,master.items,{department:T.CFC});
const inventory=T.inventory(stock.rows,watch);
const checks={masterItems:Object.keys(master.items).length,masterDuplicates:master.duplicateRows,masterClassificationConflicts:master.issues,stockRows:stock.rows.length,stockSummaryRowsExcluded:stock.ignoredRows,transactionRecords:transactions.records.length,CFC:{records:prod.rows.length,units:prod.units,unmapped:prod.unmapped,unmappedUnits:prod.unmappedUnits,groups:prod.groups,lines:prod.lines},strategic:inventory.map(({detail,...r})=>r)};
fs.writeFileSync(path.join(out,'control-tower-checks.json'),JSON.stringify(checks,null,2));
process.stdout.write(JSON.stringify({...checks,strategic:{items:inventory.length,missing:inventory.filter(r=>r.available===null).map(r=>r.sku)}},null,2));
