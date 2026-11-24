import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Integrations} from '../research.mjs';
import {TopicChannels,channelTopicArgs,channelTopicRows} from '../topic-channels.mjs';
import {matchesSubject,presentTrendJob,trendArgs} from '../keyword-trends.mjs';
import {createApp} from '../server.mjs';
const tool={name:'vidiq_channel_search',inputSchema:{properties:{query:{type:'string'}}}};
const channel={channelId:'UC'+'a'.repeat(22),channelTitle:'Piano room',niche:'Piano music',description:'Relaxing piano in 4K',country:'US',languages:'en, vi',score:180,subscriberCount:123,videoCount:24};
const result={structuredContent:{channels:[channel],total:1}};
const verify=async()=>({discover:async()=>({videos:[]}),detail:async()=>({channel:{title:channel.channelTitle,country:channel.country},videos:[{id:"abcdefghijk",title:"Relaxing piano 4k"},{id:"abcdefghijl",title:"Piano 4k music"}]})});
const cfg=()=>new Integrations({VIDIQ_API_KEY:'SECRET',VIDIQ_KEY_LOCKED:'1'});
test('custom subjects retain spacing variants and format constraints, never unrelated music growth',()=>{
  for(const [q,k]of [['deephouse','deep house mix'],['piano 4k','calm piano music 4k'],['relax','relaxing music']])assert.equal(matchesSubject(q,k),true);
  for(const [q,k]of [['deephouse','crab rave'],['deephouse','sped up'],['piano 4k','piano 24k'],['piano 4k','piano music'],['relax','gta gameplay']])assert.equal(matchesSubject(q,k),false);
  const j=presentTrendJob({args:trendArgs({niche:'deephouse',country:'ALL'}),evidence:[{id:'E1',result:{_meta:{widgetData:{risingKeywords:[{keyword:'crab rave',periodPercentChange:900},{keyword:'deep house mix',periodPercentChange:100}]}}}}]});assert.equal(j.items.length,1);assert.equal(j.coverage.excludedOffSubject,1);
});
test('direct channel search keeps original subject, relevance order and independent creator location/language',async()=>{
  const store=new Store();let calls=0;const topic=new TopicChannels(store,cfg(),{channelVerifierFactory:verify,factory:()=>({tools:async()=>[tool],call:async(name,args)=>{calls++;assert.equal(name,'vidiq_channel_search');assert.equal(args.query,'piano 4k');assert.equal(args.sort,'relevance');assert.equal(args.country,undefined);assert.equal(args.languages,undefined);return result;},close:async()=>{}})});const j=topic.create({q:'piano 4k'});await topic.idle;const saved=store.getResearch(j.id);assert.equal(saved.status,'completed');assert.equal(saved.items[0].id,channel.channelId);assert.equal(saved.items[0].score,180);const again=topic.create({q:'piano 4k'});assert.equal(again.calls,0);assert.equal(calls,1);assert.equal(again.cacheHit,true);assert.deepEqual(channelTopicArgs({q:'nhạc thư giãn'}).languages,['vi']);store.close();
});
test('explicit creator location is enforced without substituting country from keyword audience',async()=>{
  const store=new Store();const topic=new TopicChannels(store,cfg(),{channelVerifierFactory:verify,factory:()=>({tools:async()=>[tool],call:async(_name,args)=>{assert.deepEqual(args.country,['JP']);assert.deepEqual(args.languages,['ja']);return result;},close:async()=>{}})});const j=topic.create({q:'piano',country:'JP',language:'ja'});await topic.idle;assert.equal(store.getResearch(j.id).items.length,0);assert.equal(store.getResearch(j.id).status,'completed');store.close();
});
test('failed authentication never retries or removes key and reports connection state',async()=>{
  const store=new Store(),config=cfg();let calls=0;config.verified=true;const topic=new TopicChannels(store,config,{channelVerifierFactory:verify,factory:()=>({tools:async()=>{calls++;throw new Error('vidIQ từ chối xác thực');},close:async()=>{}})});const j=topic.create({q:'relax'});await topic.idle;assert.equal(calls,1);assert.equal(store.getResearch(j.id).status,'failed');assert.equal(config.vidiqKey,'SECRET');assert.equal(config.status().vidiqVerified,false);assert.match(config.status().connectionError,/xác thực/);store.close();
});
test('channel schema changes fail explicitly and preserve raw response',async()=>{
  assert.equal(channelTopicRows({content:[{type:'text',text:JSON.stringify({channels:[channel]})}]}).length,1);assert.throws(()=>channelTopicRows({}),/Không đọc/);const store=new Store();const topic=new TopicChannels(store,cfg(),{channelVerifierFactory:verify,factory:()=>({tools:async()=>[tool],call:async()=>({structuredContent:{unknown:'changed'}}),close:async()=>{}})});const j=topic.create({q:'relax'});await topic.idle;assert.equal(store.getResearch(j.id).evidence[0].result.structuredContent.unknown,'changed');assert.equal(store.getResearch(j.id).status,'failed');store.close();
});
test('a broad music/category hit without matching sample videos is rejected',async()=>{
  const store=new Store();const topic=new TopicChannels(store,cfg(),{channelVerifierFactory:async()=>({discover:async()=>({videos:[]}),detail:async()=>({channel:{title:'Cat videos'},videos:[{title:'Funny cats'},{title:'Cute pets'}]})}),factory:()=>({tools:async()=>[tool],call:async()=>result,close:async()=>{}})});const j=topic.create({q:'relax'});await topic.idle;assert.equal(store.getResearch(j.id).items.length,0);assert.equal(store.getResearch(j.id).coverage.checkedChannels,1);store.close();
});
test('connection recheck clears errors without calling a paid tool or changing credentials',async()=>{
  const c=cfg();c.connectionError='expired';await assert.rejects(c.check({factory:()=>({tools:async()=>{throw new Error('HTTP 401');},close:async()=>{}})}));assert.equal(c.status().vidiqVerified,false);assert.match(c.status().connectionError,/401/);await c.check({factory:()=>({tools:async()=>[{name:'vidiq_keyword_research'}],call:async()=>{throw new Error('must not call');},close:async()=>{}})});assert.equal(c.status().vidiqVerified,true);assert.equal(c.status().connectionError,null);assert.ok(c.status().vidiqVerifiedAt);assert.equal(c.vidiqKey,'SECRET');
});
test('channel search HTTP history and JSON preserve channels rather than reparse as keywords',async t=>{
  const app=createApp({integrations:cfg(),researchOptions:{channelVerifierFactory:verify,factory:()=>({tools:async()=>[tool],call:async()=>result,close:async()=>{}})}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>app.shutdown());const base='http://127.0.0.1:'+app.address().port;const j=await(await fetch(base+'/api/topic-channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:'piano 4k'})})).json();await app.topicChannels.idle;const saved=await(await fetch(base+'/api/research/'+j.id+'/export')).json();assert.equal(saved.items[0].title,'Piano room');assert.equal(JSON.stringify(saved).includes('SECRET'),false);assert.equal((await(await fetch(base+'/api/research')).json()).items[0].count,1);assert.equal((await fetch(base+'/topic-channels.mjs')).status,404);
});
