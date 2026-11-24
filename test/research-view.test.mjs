import test from 'node:test';
import assert from 'node:assert/strict';
import {researchView,errorHelp} from '../keywords.js';
const base={status:'running',args:{analyze:true},logs:[],evidence:[],items:[],report:null};
test('shows current step without claiming unfinished steps succeeded',()=>{const v=researchView({...base,logs:[{message:'AI lập truy vấn vidIQ (1/1)'}]});assert.deepEqual(v.steps.map(s=>s.state),['success','running','pending','pending']);});
test('retains completed data step and shows AI failure in its own step',()=>{const v=researchView({...base,status:'partial',error:'AI trả HTTP 500',logs:[{message:'AI phân nhóm từ khóa và giải thích căn cứ'}],evidence:[{}],items:[{}]});assert.deepEqual(v.steps.map(s=>s.state),['success','success','success','error']);assert.equal(v.steps[3].detail,'AI trả HTTP 500');assert.match(v.title,/còn bước/);});
test('failed connection does not mark later stages successful',()=>{const v=researchView({...base,status:'failed',error:'vidIQ từ chối xác thực'});assert.deepEqual(v.steps.map(s=>s.state),['error','pending','pending','pending']);assert.match(errorHelp('vidIQ từ chối xác thực'),/khóa vidIQ/);});
test('cancelled and interrupted are distinct from success or error; disabled AI is skipped',()=>{for(const status of ['cancelled','interrupted'])assert.equal(researchView({...base,status}).steps[0].state,'stopped');const v=researchView({...base,status:'completed',args:{analyze:false},items:[{}]});assert.equal(v.steps[3].state,'skipped');assert.equal(v.success,true);});
