// Read-only evidence capture. Never imports application boot/configuration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require(path.join(process.cwd(),'EchoAI/node_modules/pg'));
const out = __dirname;
const blacor = '65292e37-c1b2-4c04-b2c5-5167dbb04581';
const sds = ['bfe13534-f06d-4206-8139-3c217a52c8da','ae125e32-f130-4b5c-8c68-1f41cfd8ae20','d5745758-30a6-462a-baa6-4233216b8f93'];
const owner = '8e55c26c-7ac2-4ea6-9884-1703b0806016';
const forbidden = /token|secret|password|credential|authorization|api_key|signed_url/i;
function clean(v) {
  if(v instanceof Date) return v.toISOString();
  if(Array.isArray(v)) return v.map(clean);
  if(v && typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,forbidden.test(k)?'[REDACTED]':clean(v[k])]));
  return v;
}
function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonical(v) {
  if(v instanceof Date) return v.toISOString();
  if(Array.isArray(v)) return v.map(canonical);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
function save(name, data) { const str=JSON.stringify(canonical(data));fs.writeFileSync(path.join(out,name),str);return {file:name,bytes:Buffer.byteLength(str),sha256:hash(str)}; }
const quote=s=>'"'+s.replace(/"/g,'""')+'"';
(async()=>{
 const db=new Client({connectionString:process.env.STAGING_DATABASE_URL});
 await db.connect();
 try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL TIME ZONE 'UTC'");
  const meta=(await db.query("SELECT statement_timestamp()::text observed_at,current_setting('transaction_read_only') read_only")).rows[0];
  const cols=(await db.query("SELECT c.table_name,c.column_name,c.data_type FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name) WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position")).rows;
  const tables={};for(const c of cols)(tables[c.table_name]??=[]).push(c);
  const datasets={},definitions={};
  for(const [table, columns] of Object.entries(tables)) {
   const hasBrand=columns.some(c=>c.column_name==='brand_id');
   const userTable=['api_integrations','google_integrations','setup_sessions'].includes(table);
   if(!hasBrand&&!userTable)continue;
   const selected=columns.filter(c=>!forbidden.test(c.column_name)).map(c=>c.column_name);
   const filter=hasBrand?'brand_id = ANY($1::uuid[])':'user_id = $1::uuid';
   const parameters=hasBrand?[[blacor,...sds]]:[owner];
   const sql=`SELECT ${selected.map(quote).join(',')} FROM public.${quote(table)} WHERE ${filter}`;
   const rows=(await db.query(sql,parameters)).rows.map(clean);
   rows.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
   datasets[table]=rows;
   definitions[table]={sql,parameters,selectedFields:selected,excludedFields:columns.filter(c=>forbidden.test(c.column_name)).map(c=>c.column_name),count:rows.length};
  }
  const files=[];
  files.push(save('bank.json',{schemaVersion:'blacor-facebook-gate-v1',datasets}));
  files.push(save('serialization.json',{meta,definitions,canonicalization:'UTF-8 JSON.stringify; recursively lexically sorted object keys; arrays preserved except table rows sorted by full canonical row string; SQL NULL JSON null; pg timestamps UTC ISO milliseconds; pg numeric strings preserved; excluded secret columns listed; nested sensitive key values redacted; SHA-256 exact bytes, no trailing newline.',scope:{blacor,sds,owner}}));
  const sdsRows=Object.values(datasets).flat().filter(r=>sds.includes(r.brand_id));
  const needles=[{kind:'SDS Page',value:'140006069194366'},...sds.map(value=>({kind:'SDS brand',value}))];
  for(const r of sdsRows) for(const k of ['account_id','campaign_id','ad_link_url','facebook_page_id']) if(r[k])needles.push({kind:k,value:String(r[k])});
  const hits=[];
  function scan(v,p,table,row){
   if(typeof v==='string')for(const n of needles)if(v.includes(n.value))hits.push({table,row,path:p,...n});
   if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))scan(x,p+'.'+k,table,row);
  }
  for(const [table,rows]of Object.entries(datasets))rows.forEach((r,i)=>{if(r.brand_id===blacor)scan(r,'$',table,i)});
  files.push(save('cross-reference-scan.json',{needles:[...new Map(needles.map(n=>[n.kind+':'+n.value,n])).values()],hits,limitation:'Scans every non-secret selected field of all brand_id-scoped base tables, including nested JSON/text. Secret columns omitted. Does not establish remote-provider state or audit intervening history.'}));
  // Reproduce the previously banked SDS canonical-v1 definitions verbatim.
  const baselineRelative='review_package/evidence/026-sds-baseline-drift-reconciliation/baseline-manifest.json';
  const baselinePath=fs.existsSync(baselineRelative)?baselineRelative:path.join('.local/sds-baseline-reconciliation',baselineRelative);
  const old=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
  const comparisons=[];
  const presence={credentials_present:'credentials_encrypted',api_token_present:'api_token_encrypted',facebook_page_tokens_present:'facebook_page_tokens',access_token_present:'access_token_encrypted',refresh_token_present:'refresh_token_encrypted'};
  for(const [name,d]of Object.entries(old.datasets)){
   const fields=d.selectedFields.map(f=>presence[f]?`(${presence[f]} IS NOT NULL) AS ${f}`:f);
   const sql=`SELECT ${fields.join(', ')} FROM ${d.table} WHERE ${d.filter} ORDER BY ${d.sortOrder}`;
   const result=await db.query(sql,d.parameterValues);
   const payload={schemaVersion:old.baselineVersion,dataset:name,columns:result.fields.map(f=>f.name),rows:result.rows.map(r=>result.fields.map(f=>canonical(r[f.name])))};
   const text=JSON.stringify(payload); const file='sds-v1-'+name+'.json';fs.writeFileSync(path.join(out,file),text);
   comparisons.push({name,sql,parameters:d.parameterValues,oldHash:d.sha256,newHash:hash(text),same:d.sha256===hash(text),oldCount:d.rowCount,newCount:result.rows.length,file});
  }
  files.push(save('sds-v1-comparison.json',{meta,comparisons}));
  await db.query('ROLLBACK');
  console.log(JSON.stringify({meta,files,blacorCounts:Object.fromEntries(Object.entries(datasets).map(([t,r])=>[t,r.filter(x=>x.brand_id===blacor).length]).filter(([,n])=>n)),crossReferenceHits:hits,sdsComparison:comparisons.map(x=>({name:x.name,same:x.same,old:x.oldCount,new:x.newCount}))},null,2));
 } finally {await db.query('ROLLBACK').catch(()=>{});await db.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});