import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.mjs';
import {Integrations} from '../research.mjs';
import {KeywordTrends,trendArgs,trendCacheKey,presentTrendJob} from '../keyword-trends.mjs';
import {createApp} from '../server.mjs';
const tool={name:'vidiq_keyword_research',inputSchema:{properties:{mode:{enum:['rising']}}}};
const result={_meta:{widgetData:{mode:'rising',period:'week',availableTopics:['ai'],risingKeywords:[
  {keyword:'growing VN',periodPercentChange:120,estimatedMonthlySearch:100,topMarkets:[{country:'VN',pct:.4}]},
  {keyword:'growing US',periodPercentChange:200,estimatedMonthlySearch:200,topMarkets:[{country:'US',pct:.8}]},
  {keyword:'not localized',periodPercentChange:300,topMarkets:[]},
  {keyword:'decreasing',periodPercentChange:-50,topMarkets:[{country:'VN',pct:1}]},
  {keyword:'zero',periodPercentChange:0,topMarkets:[{country:'VN',pct:1}]},
  {keyword:'unknown',periodPercentChange:null,topMarkets:[{country:'VN',pct:1}]}
]}}};
const config=()=>new Integrations({VIDIQ_API_KEY:'TEST_SECRET',VIDIQ_KEY_LOCKED:'1'});
const snapshot={id:'cached-source',tool:tool.name,arguments:{mode:'rising',period:'week',language:'all'},observedAt:'2026-11-22T01:00:00Z',result};
test('rising demand stays global; country is matched by topMarkets and missing markets are unknown',()=>{
  const job={args:trendArgs({country:'VN'}),evidence:[{id:'E1',result}]};const view=presentTrendJob(job);
  assert.deepEqual(view.items.map(x=>x.keyword),['growing VN']);assert.equal(view.items[0].growthPct,120);assert.equal(view.items[0].country,null);assert.equal(view.items[0].countryVolume,null);assert.equal(view.items[0].searchVolume,100);
  assert.equal(presentTrendJob({...job,args:trendArgs({country:'ALL'})}).items.length,3);
});
test('cache is shared across countries and survives reopening without a new paid call',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ns-trends-'));try{let store=new Store(join(dir,'cache.sqlite'));store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);store.close();store=new Store(join(dir,'cache.sqlite'));const trends=new KeywordTrends(store,config(),{factory:()=>{throw new Error('must not call provider');}});const j=trends.create({country:'US'});assert.equal(j.cacheHit,true);assert.equal(j.calls,0);assert.deepEqual(j.items.map(x=>x.keyword),['growing US']);assert.equal(store.getResearch(j.id).items.length,1);assert.deepEqual(trends.topics(),['ai']);store.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('topic queries use only provider categories, all languages, one call, and never country as rising filter',async()=>{
  const store=new Store();store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);let calls=0;
  const trends=new KeywordTrends(store,config(),{factory:()=>({tools:async()=>[tool],call:async(name,args)=>{calls++;assert.equal(args.topic,'ai');assert.equal(args.language,'all');assert.equal(args.country,undefined);assert.equal(args.mode,'rising');return result;},close:async()=>{}})});
  assert.throws(()=>trends.create({topic:'invented'}),/chủ đề riêng/);const j=trends.create({country:'VN',topic:'ai'});assert.throws(()=>trends.create({country:'VN',topic:'ai'}),/Đang cập nhật/);await trends.idle;assert.equal(store.getResearch(j.id).status,'completed');assert.equal(calls,1);store.close();
});
test('provider auth failure preserves cached results and key, and never retries paid calls',async()=>{
  const store=new Store();store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);const cfg=config();let calls=0;const trends=new KeywordTrends(store,cfg,{factory:()=>({tools:async()=>[tool],call:async()=>{calls++;throw new Error('vidIQ từ chối xác thực');},close:async()=>{}})});const j=trends.create({refresh:true});await trends.idle;assert.equal(store.getResearch(j.id).status,'failed');assert.match(store.getResearch(j.id).error,/xác thực/);assert.equal(calls,1);assert.equal(cfg.vidiqKey,'TEST_SECRET');assert.equal(trends.cached({}).items.length,1);store.close();
});
test('protected default key cannot be cleared or replaced, missing key is explicit, status never reveals secret',()=>{
  const cfg=config();assert.throws(()=>cfg.configure({vidiqKey:''}),/không được xóa/);assert.throws(()=>cfg.configure({vidiqKey:'different'}),/không được xóa/);assert.equal(cfg.vidiqKey,'TEST_SECRET');assert.equal(JSON.stringify(cfg.status()).includes('TEST_SECRET'),false);assert.equal(cfg.status().credentialStorage,'server-env');const missing=new Integrations({VIDIQ_KEY_LOCKED:'1'});assert.match(missing.status().credentialWarning,/bị thiếu/);
});
test('unrecognized provider data is retained for export while prior cache stays usable',async()=>{
  const store=new Store();store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);const trends=new KeywordTrends(store,config(),{factory:()=>({tools:async()=>[tool],call:async()=>({content:[{type:'text',text:'Changed schema'}]}),close:async()=>{}})});const j=trends.create({refresh:true});await trends.idle;const saved=store.getResearch(j.id);assert.equal(saved.status,'failed');assert.equal(saved.evidence[0].result.content[0].text,'Changed schema');assert.equal(trends.cached({}).items[0].keyword,'growing VN');store.close();
});
test('cancellation aborts provider request and does not overwrite previous snapshot',async()=>{
  const store=new Store();store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);let began;const ready=new Promise(r=>began=r);const trends=new KeywordTrends(store,config(),{factory:(_key,{signal})=>({tools:async()=>[tool],call:async()=>{began();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},close:async()=>{}})});const j=trends.create({refresh:true});await ready;trends.cancel(j.id);await trends.idle;assert.equal(store.getResearch(j.id).status,'cancelled');assert.equal(trends.cached({}).items.length,1);store.close();
});
test('trends HTTP reads cache for free, keeps raw export, rejects key deletion and blocks credential files',async t=>{
  const store=new Store();store.saveTrendSnapshot(trendCacheKey(trendArgs()),snapshot);const app=createApp({store,integrations:config()});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.shutdown());const base='http://127.0.0.1:'+app.address().port;
  const cached=await(await fetch(base+'/api/keyword-trends?country=VN')).json();assert.equal(cached.job.items.length,1);assert.deepEqual(cached.topics,['ai']);assert.equal(JSON.stringify(cached).includes('TEST_SECRET'),false);
  const j=await(await fetch(base+'/api/keyword-trends',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:'US'})})).json();const exported=await(await fetch(base+'/api/research/'+j.id+'/export')).json();assert.equal(exported.items[0].keyword,'growing US');assert.equal(exported.evidence[0].result._meta.widgetData.risingKeywords.length,6);
  assert.equal((await fetch(base+'/api/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vidiqKey:''})})).status,400);
  for(const path of ['/.env','/data/vidiq-key-required.json','/keyword-trends.mjs'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/keyword-ui.js')).status,200);
});
