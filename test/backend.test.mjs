import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { Jobs,validateSearch } from '../jobs.mjs';
import { enrichChannel,scoreVideos,rankChannels } from '../analysis.mjs';
import { parseCount,parsePublished,normalizeVideo } from '../innertube.mjs';
import { createApp } from '../server.mjs';

const id='UC'+'a'.repeat(22);
const ago=days=>new Date(Date.now()-days*86400000).toISOString();
const channel={id,title:'Urban garden',description:'Grow vegetables on a balcony',subs:100,views:10000,videos:20,country:null,publishedAt:ago(800),demo:false,source:'test'};
const videos=Array.from({length:5},(_,i)=>({id:'v'+String(i).padStart(10,'0'),channelId:id,channelTitle:channel.title,title:'Grow vegetables balcony '+i,format:'long',views:(i+1)*100,publishedAt:ago(i+3),demo:false}));
async function settled(store,id){for(let i=0;i<300;i++){const job=store.getJob(id);if(['completed','failed','cancelled','partial'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw new Error('Job did not settle');}
function fakeFactory(extra={}){return async(_provider,context)=>({
  discover:async()=>{context.onRequest();return {channels:[{id,title:channel.title},{id,title:channel.title}],videos};},
  detail:async()=>{context.signal.throwIfAborted();context.onRequest();return {channel:{...channel,...extra},videos};},
  resolveChannel:async()=>({id}),
});}

test('YouTube renderer normalization keeps unknown counts, dates and Shorts explicit',()=>{
  assert.equal(parseCount('1.75M subscribers'),1750000);assert.equal(parseCount('27,422,004 views'),27422004);assert.equal(parseCount('hidden'),null);assert.equal(parseCount('No views'),0);
  assert.equal(parsePublished('3 days ago',Date.parse('2026-11-20T00:00:00Z')),'2026-11-17T00:00:00.000Z');assert.equal(parsePublished('LIVE'),null);
  const item=normalizeVideo({type:'ShortsLockupView',on_tap_endpoint:{payload:{videoId:'abcdefghijk'}},overlay_metadata:{primary_text:'A short',secondary_text:'12K views'}},channel);
  assert.equal(item.format,'short');assert.equal(item.publishedAt,null);assert.equal(item.views,12000);assert.equal(item.duration,null);
});
test('sample analysis excludes target and mixed formats; separate tabs do not invent Shorts ratio',()=>{
  const source=[...videos,{...videos[0],id:'xxxxxxxxxxx',views:1e7,format:'short'}];const scored=scoreVideos(source);
  assert.equal(scored[0].outlierBaseline,350);assert.equal(scored[0].outlierSampleSize,4);assert.equal(scored.at(-1).outlier,null);
  const result=enrichChannel({...channel,formatSampling:'separate-tabs'},source);assert.equal(result.shortsPct,null);assert.equal(result.formatSampleCounts.short,1);
  assert.equal(enrichChannel(channel,[]).uploadFrequency,null);
});
test('semantic relevance is kept separate from popularity and is not a success probability',()=>{
  const result=rankChannels([{...channel,subs:1e7,profile:'sports',recentMedianViews:1e6},{...channel,id:'other',subs:10,profile:'grow vegetables',recentMedianViews:100}], 'vegetables',[0.4,0.8]);
  assert.equal(result[0].id,'other');assert.equal(result[0].rankMethod,'multilingual-e5-small');assert.equal(result[0].relevance,0.8);
});
test('SQLite survives reopening, marks interrupted jobs and computes snapshot deltas',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'nichescope-test-'));const path=join(dir,'db.sqlite');
  let store=new Store(path);
  try{
    store.putChannel(channel);store.saveLibrary(channel);
    store.putVideo({...videos[0],views:100,observedAt:'2026-11-19T00:00:00Z'});
    const next=store.putVideo({...videos[0],views:220,observedAt:'2026-11-19T02:00:00Z'});assert.equal(next.recentVph,60);assert.equal(next.recentIntervalHours,2);
    store.saveJob({id:'interrupted',status:'running',createdAt:ago(0),items:[channel],args:{},logs:[]});store.close();store=new Store(path);
    assert.equal(store.library().length,1);assert.equal(store.getChannel(id).title,channel.title);assert.equal(store.getJob('interrupted').status,'interrupted');assert.equal(store.getJob('interrupted').items.length,1);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('job deduplicates candidates, keeps undeclared country and persists completed results',async()=>{
  const store=new Store();const jobs=new Jobs(store,{providerFactory:fakeFactory(),semantic:{scores:async()=>[0.9]}});
  try{const job=jobs.create({q:'urban garden',country:'US',limit:4,expand:false});const done=await settled(store,job.id);assert.equal(done.status,'completed');assert.equal(done.candidateCount,1);assert.equal(done.items.length,1);assert.equal(done.rankMethod,'multilingual-e5-small');assert.equal(store.history()[0].jobId,job.id);assert.equal(store.getChannel(id).rankMethod,'multilingual-e5-small');}
  finally{await jobs.close();store.close();}
});
test('strict declared-country filter removes unknown, without changing market semantics',async()=>{
  const store=new Store();const jobs=new Jobs(store,{providerFactory:fakeFactory(),semantic:{scores:async()=>[]}});
  try{const job=jobs.create({q:'urban garden',country:'US',strictCountry:true,limit:4,expand:false});const done=await settled(store,job.id);assert.equal(done.status,'completed');assert.equal(done.items.length,0);}
  finally{await jobs.close();store.close();}
});
test('model failure is partial with explicit lexical ranking, never demo fallback',async()=>{
  const store=new Store();const jobs=new Jobs(store,{providerFactory:fakeFactory(),semantic:{scores:async()=>{throw new Error('model unavailable');}}});
  try{const job=jobs.create({q:'urban garden',limit:4,expand:false});const done=await settled(store,job.id);assert.equal(done.status,'partial');assert.equal(done.rankMethod,'keyword-overlap');assert.ok(done.warnings[0].includes('model unavailable'));assert.ok(done.items.every(c=>!c.demo));}
  finally{await jobs.close();store.close();}
});
test('cancel running job aborts provider and cancels queued job without new requests',async()=>{
  const store=new Store();let began;const started=new Promise(r=>began=r);let count=0;
  const jobs=new Jobs(store,{providerFactory:async(_p,context)=>({discover:async()=>{count++;began();await new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));return{};}})});
  try{const first=jobs.create({q:'garden',limit:4});const queued=jobs.create({q:'cooking',limit:4});await started;jobs.cancel(queued.id);jobs.cancel(first.id);const done=await settled(store,first.id);assert.equal(done.status,'cancelled');assert.equal(store.getJob(queued.id).status,'cancelled');assert.equal(count,1);}
  finally{await jobs.close();store.close();}
});
test('bad source and request budgets fail explicitly; input limits are checked',async()=>{
  assert.throws(()=>validateSearch({q:'x',limit:500}));assert.throws(()=>validateSearch({q:'x',country:'BAD'}));
  const store=new Store();const jobs=new Jobs(store,{maxRequests:0,providerFactory:fakeFactory()});
  try{const job=jobs.create({q:'garden',limit:4});const done=await settled(store,job.id);assert.equal(done.status,'failed');assert.equal(done.items.length,0);assert.match(done.error,/ngân sách/);}
  finally{await jobs.close();store.close();}
});
test('HTTP job, library and history work end-to-end; file access and cross-origin writes are blocked',async t=>{
  const app=createApp({providerFactory:fakeFactory(),semantic:{state:'ready',scores:async()=>[0.9],close:async()=>{}}});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>app.shutdown());
  const base=`http://127.0.0.1:${app.address().port}`;
  const post=(path,data,origin)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});
  const response=await post('/api/jobs',{q:'urban garden',limit:4,expand:false});assert.equal(response.status,202);const initial=await response.json();const done=await settled(app.store,initial.id);assert.equal(done.status,'completed');
  assert.equal((await post('/api/library',{id})).status,200);assert.equal((await(await fetch(base+'/api/library')).json()).items.length,1);
  assert.equal((await(await fetch(base+'/api/history')).json()).items[0].count,1);
  const csv=await(await fetch(base+`/api/jobs/${initial.id}/export?format=csv`)).text();assert.match(csv,/Urban garden/);
  assert.equal((await post('/api/jobs',{q:'x'},'https://evil.example')).status,403);
  assert.equal((await fetch(base+'/data/nichescope.sqlite')).status,404);assert.equal((await fetch(base+'/.env')).status,404);
});
