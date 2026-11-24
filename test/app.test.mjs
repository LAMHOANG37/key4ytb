import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, videoMetrics, csvCell, durationSeconds } from '../metrics.mjs';
import { createApp } from '../server.mjs';
import { channelItem, createYouTube } from '../youtube.mjs';

test('missing statistics remain unknown and zero denominators do not invent ratios', () => {
  assert.deepEqual(metrics({views: 1000, videos: 0, subs: null}), {averageViews: null, viewsPerSub: null});
  assert.deepEqual(metrics({views: null, videos: 10, subs: 10}), {averageViews: null, viewsPerSub: null});
  const now=Date.parse('2026-11-19T00:00:00Z');
  assert.deepEqual(videoMetrics({views: 1200, publishedAt:'2026-11-18T00:00:00Z'}, {views:10000,videos:50}, now), {vph:50,outlier:6});
  assert.equal(videoMetrics({views:1200,publishedAt:'2026-11-20T00:00:00Z'}, {}, now).vph,null);
  assert.equal(durationSeconds('PT1H2M3S'),3723);
});
test('hidden subscribers and missing country are preserved by YouTube adapter', () => {
  const c=channelItem({id:'UC'+'x'.repeat(22),snippet:{title:'test',publishedAt:'2020-01-01'},statistics:{hiddenSubscriberCount:true,viewCount:'50',videoCount:'5'}});
  assert.equal(c.subs,null);assert.equal(c.viewsPerSub,null);assert.equal(c.country,null);assert.equal(c.averageViews,10);
});
test('CSV escapes spreadsheet formulas and quoted text', () => {
  assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('café, "tea"'),'"café, ""tea"""');
  assert.equal(csvCell(null),'""');
});
test('YouTube quota errors do not expose the API key',async()=>{
  const yt=createYouTube('private-key',async()=>new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}]}}),{status:403}));
  await assert.rejects(yt.search('food','US',0),error=>!error.message.includes('private-key')&&error.message.includes('hạn mức'));
});
test('YouTube channel search batches metadata and uses requested region',async()=>{
  const calls=[];const id='UC'+'a'.repeat(22);
  const yt=createYouTube('secret',async url=>{calls.push(url);return new Response(JSON.stringify({items:url.pathname.endsWith('/search')?[{id:{channelId:id}}]:[{id,snippet:{title:'Demo',country:'VN',publishedAt:'2020-01-01'},statistics:{subscriberCount:'10',viewCount:'100',videoCount:'5'}}]}));});
  const result=await yt.search('ẩm thực','VN',30);
  assert.equal(result[0].averageViews,20);assert.equal(calls.length,2);assert.equal(calls[0].searchParams.get('regionCode'),'VN');assert.equal(calls[0].searchParams.has('publishedAfter'),false);
});
test('local app supports demo discovery, search, similarity and explicit live errors',async t=>{
  const app=createApp({live:null});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
  const origin=`http://127.0.0.1:${app.address().port}`;
  const get=async path=>{const r=await fetch(origin+path);return{status:r.status,data:await r.json()};};
  const discover=await get('/api/discover?mode=demo');assert.equal(discover.data.items.length,12);
  const search=await get('/api/channels?mode=demo&q=am%20thuc&country=VN');assert.equal(search.data.items.length,2);assert.ok(search.data.items.every(c=>c.demo&&c.country==='VN'));
  const similar=await get('/api/similar?mode=demo&q='+encodeURIComponent('Bếp Nhỏ Mỗi Ngày'));assert.equal(similar.data.items.length,2);assert.ok(similar.data.items.every(c=>c.id!==similar.data.seed.id));
  assert.equal((await get('/api/channels?mode=live&q=test')).status,400);
  assert.equal((await get('/api/channels?mode=demo&q=abc&country=BAD')).status,400);
  const empty=await get('/api/channels?mode=demo&q=nonexistent');assert.equal(empty.data.items.length,0);
  const vietnamese=await get('/api/channels?mode=demo&q=di%20va%20ke');assert.equal(vietnamese.data.items[0].title,'Đi Và Kể');
  const detail=await get('/api/channel?mode=demo&id=demo-channel-1');assert.equal(detail.data.videos.length,1);
  assert.equal((await fetch(origin+'/.env')).status,404);
  assert.equal((await fetch(origin+'/')).status,200);
});
