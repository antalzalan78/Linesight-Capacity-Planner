"""Read-only ERP profiling. Private results are never part of a published build."""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv)<2:
    raise SystemExit('Usage: profile-control-tower.py PATH_TO_ERP_EXPORT_FOLDER')
SOURCE = Path(sys.argv[1])

def records(name):
    book = load_workbook(SOURCE/name, read_only=True, data_only=True)
    sheet = book.worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = next(rows)
    for row in rows:
        if any(v is not None for v in row):
            yield dict(zip(header,row))
    book.close()

def day(value):
    if isinstance(value,(float,int)):
        return (datetime(1899,12,30)+timedelta(days=value)).date().isoformat()
    if isinstance(value,datetime):return value.date().isoformat()
    return str(value or '')

def number(value):
    return float(str(value or 0).replace(',',''))

master = defaultdict(list)
for row in records('Masterdata.xlsx'):
    master[str(row['Item Code2']).strip()].append(row)
master_conflicts = []
for item, rows in master.items():
    variants = {json.dumps(r,sort_keys=True,default=str) for r in rows}
    if len(variants)>1:master_conflicts.append({'item':item,'rows':rows})

stocks = defaultdict(lambda: {'rows':0,'onHand':0,'available':0,'committed':0})
stock_items = defaultdict(dict)
for row in records('Stock_on_hand.xlsx'):
    if not row.get('Item'):continue
    loc = str(row.get('Location') or '').strip()
    group = stocks[loc]
    group['rows']+=1
    for col,key in [('On Hand','onHand'),('Available','available'),('Committed','committed')]:
        group[key]+=number(row.get(col))
    item=str(row.get('Item') or '').strip()
    target=stock_items[item].setdefault(loc,{'onHand':0,'available':0,'rows':0,'name':row.get('Display Name')})
    target['rows']+=1
    target['onHand']+=number(row.get('On Hand'))
    target['available']+=number(row.get('Available'))

counts=Counter(); by_department=defaultdict(lambda:Counter()); by_type=defaultdict(lambda:Counter())
ids={}; duplicate_ids=Counter(); exact_duplicates=0; conflicting_ids=[]
daily=defaultdict(Counter); samples=defaultdict(list); unmatched=Counter(); classes=Counter(); zeros=[]
for row in records('Transactions.xlsx'):
    if not row.get('Internal ID'):continue
    counts['rows']+=1
    qty=number(row.get('Quantity')); built=number(row.get('Built'))
    department=str(row.get('Department') or '')
    typ=str(row.get('Type') or '')
    item=str(row.get('Item') or '')
    date=day(row.get('Transaction Date'))
    ident=str(row.get('Internal ID') or '')
    sig=tuple(str(row.get(k) or '') for k in ['Department','Transaction Date','Job','Work Order Completion Number','Machine / Line','Item','Type','Quantity','Built','Remaining'])
    if ident in ids:
        duplicate_ids[ident]+=1
        if ids[ident]==sig:exact_duplicates+=1
        elif len(conflicting_ids)<15:conflicting_ids.append({'id':ident,'before':ids[ident],'after':sig})
    else:ids[ident]=sig
    group=by_department[department]; group['rows']+=1;group['qty']+=qty;group['built']+=built
    group['negative']+=qty<0;group['zero']+=qty==0;group['matched']+=item in master
    by_type[typ]['rows']+=1;by_type[typ]['qty']+=qty
    classes[(str(row.get('NLC - Type Group')),str(row.get('Class Code')))]+=1
    daily[date]['qty']+=qty;daily[date]['rows']+=1
    if item not in master:unmatched[item]+=1
    sample_key=department+' / '+typ
    if len(samples[sample_key])<2:
        samples[sample_key].append({k:v for k,v in row.items() if k!='Created By'})
    if qty==0 and len(zeros)<8:zeros.append({k:v for k,v in row.items() if k!='Created By'})

profile={'master':{'rows':sum(map(len,master.values())),'items':len(master),'duplicateItems':{k:len(v) for k,v in master.items() if len(v)>1},'conflicts':master_conflicts,'categories':dict(Counter(str(v[0].get('Type')) for v in master.values()))},
 'stock':{'locations':dict(stocks),'items':dict(stock_items)},
 'transactions':{'counts':dict(counts),'dateMin':min(daily),'dateMax':max(daily),'byDepartment':dict(by_department),'byType':dict(by_type),'uniqueIds':len(ids),'duplicateIdKeys':len(duplicate_ids),'duplicateIdRows':sum(duplicate_ids.values()),'exactDuplicates':exact_duplicates,'conflictingIdExamples':conflicting_ids,'classification':{' / '.join(k):v for k,v in classes.items()},'unmatchedItemCount':len(unmatched),'unmatchedTop':unmatched.most_common(15),'samples':dict(samples),'zeroExamples':zeros,'daily':dict(sorted(daily.items()))}}
output=ROOT/'.local'/'control-tower-profile.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(profile,default=str,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'master':profile['master'],'locations':profile['stock']['locations'],'transactions':{k:v for k,v in profile['transactions'].items() if k not in ['daily','samples','zeroExamples']}},default=str,ensure_ascii=False,indent=2))
print('PRIVATE_PROFILE',output)
