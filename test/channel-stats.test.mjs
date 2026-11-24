import test from 'node:test';import assert from 'node:assert/strict';
import {channelStats,channelStatsTable} from '../channel-stats.js';
test('channel statistics keep total averages separate from recent samples and preserve zeros',()=>{
  const s=channelStats({subs:20,views:1000,videos:10,recentAverageViews:5,recentSampleSize:4,shortsPct:0,uploadFrequency:0});assert.equal(s.average,100);assert.equal(s.average10,5);assert.equal(s.sample10,4);assert.equal(s.viewSub,50);assert.equal(s.shorts,0);assert.equal(s.frequency,0);
  const unknown=channelStats({subs:0,views:0,videos:0});assert.equal(unknown.average,null);assert.equal(unknown.viewSub,null);assert.equal(unknown.shorts,null);assert.equal(unknown.average10,null);
});
test('vidIQ fields and channel creation dates map without inventing missing metrics',()=>{
  const now=Date.parse('2026-11-22T00:00:00Z');const s=channelStats({subscriberCount:10,viewCount:500,videoCount:5,publishedAt:'2026-11-12T00:00:00Z',lastVideoPublished:'2026-11-21T00:00:00Z'},now);assert.equal(s.age,10);assert.equal(s.last,1);assert.equal(s.average,100);assert.equal(s.average10,null);assert.equal(s.frequency,null);assert.equal(channelStats({publishedAt:'2099-01-01'},now).age,null);
});
test('statistics table escapes channel names, renders every requested column and never substitutes zero for unknown shorts',()=>{
  const html=channelStatsTable([{id:'UC'+'a'.repeat(22),title:'<script>test</script>',subs:1,views:10,videos:2}]);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/TB 10 VIDEO/);assert.match(html,/% SHORTS/);assert.match(html,/TUỔI KÊNH/);assert.match(html,/ID KÊNH/);assert.match(html,/Chưa đủ dữ liệu để tính tỷ lệ Shorts/);assert.doesNotMatch(html,/>0%<\/td>/);
});
