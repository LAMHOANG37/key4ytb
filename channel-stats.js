const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const first=(...values)=>values.find(v=>finite(v)!==null)??null;
const ratio=(a,b)=>a!==null&&b>0?a/b:null;
const stamp=x=>x&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const compact=x=>x===null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(x);
const decimal=x=>x===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(x);
const frequency=x=>x===null?'—':x>0&&x<.01?'<0.01':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(x);
export function channelStats(c,now=Date.now()){
  const subs=first(c.subs,c.subscriberCount),views=first(c.views,c.viewCount),videos=first(c.videos,c.videoCount);
  const created=stamp(c.publishedAt),last=stamp(c.latestUpload||c.lastVideoPublished);
  return {subs,views,videos,average:ratio(views,videos),average10:finite(c.recentAverageViews),sample10:finite(c.recentSampleSize),shorts:finite(c.shortsPct),last:last!==null&&last<=now?Math.floor((now-last)/86400000):null,frequency:finite(c.uploadFrequency),viewSub:ratio(views,subs),age:created!==null&&created<=now?Math.floor((now-created)/86400000):null};
}
const ago=d=>d===null?'—':d===0?'Hôm nay':d<30?`${d} ngày trước`:d<365?`${Math.floor(d/30)} tháng trước`:`${Math.floor(d/365)} năm trước`;
const age=d=>d===null?'—':`${d} ngày (~${Math.floor(d/365)}n ${Math.floor(d%365/30)}th)`;
export function channelStatsTable(rows,{detail=false,saveButton,now=Date.now(),proof=false}={}){
  const headings=['STT','AVATAR','TÊN KÊNH','ĐĂNG KÝ','SỐ VIDEO','TỔNG VIEW','TB VIEW/VIDEO','TB 10 VIDEO','% SHORTS','ĐĂNG CUỐI','TẦN SUẤT','VIEW/SUB','QUỐC GIA','TUỔI KÊNH','ID KÊNH'];
  return `<div class="channel-statistics"><div class="channel-stat-scroll" tabindex="0" aria-label="Bảng thống kê kênh, cuộn ngang để xem thêm"><table class="channel-stat-table"><thead><tr>${headings.map((h,i)=>`<th scope="col">${i>2&&i<14?`<button data-stat-sort="${i}" title="Sắp xếp theo ${h}">${h}</button>`:h}</th>`).join('')}${saveButton?'<th>LƯU</th>':''}${proof?'<th>VIDEO KHỚP</th>':''}</tr></thead><tbody>${rows.map((c,i)=>{
    const s=channelStats(c,now),id=c.id||c.channelId,title=c.title||c.channelTitle||id;
    const url=/^UC[\w-]{22}$/.test(id||'')?'https://www.youtube.com/channel/'+id:'#';
    const thumb=c.thumbnail||c.avatar;
    const avatar=typeof thumb==='string'&&/^https:\/\/(?:yt3\.(?:ggpht|googleusercontent)\.com|i\.ytimg\.com)\//.test(thumb)?`<img src="${esc(thumb)}" alt="" loading="lazy">`:`<span class="cs-avatar-fallback">${esc(title.slice(0,2))}</span>`;
    const cell=(value,label,sort=value)=>`<td data-sort="${esc(sort??'')}"${label?` title="${esc(label)}"`:''}>${esc(value)}</td>`;
    return `<tr><td class="cs-index">${i+1}</td><td>${avatar}</td><td class="cs-name">${detail?`<button data-detail="${esc(id)}">${esc(title)}</button>`:`<a href="${url}" target="_blank" rel="noreferrer">${esc(title)}</a>`}${c.demo?'<small>Dữ liệu mẫu</small>':''}</td>${cell(compact(s.subs),'',s.subs)}${cell(compact(s.videos),'',s.videos)}${cell(compact(s.views),'',s.views)}${cell(compact(s.average),'Tổng view / số video công khai',s.average)}${cell(compact(s.average10),s.sample10===null?'Chưa có mẫu video':`Trung bình ${s.sample10} video gần nhất có ngày/view trong mẫu (tối đa 10)`,s.average10)}${cell(s.shorts===null?'—':decimal(s.shorts)+'%',s.shorts===null?'Chưa đủ dữ liệu để tính tỷ lệ Shorts toàn kênh':'Tỷ lệ theo dữ liệu nguồn',s.shorts)}${cell(ago(s.last),'Ngày đăng mới nhất trong dữ liệu đã đọc',s.last===null?null:-s.last)}${cell(frequency(s.frequency),'Video/ngày theo cửa sổ mẫu; không suy ra từ tuổi kênh',s.frequency)}${cell(decimal(s.viewSub),'Tổng view / số đăng ký',s.viewSub)}${cell(c.country||'—','',c.country||'')}${cell(age(s.age),'Tuổi kênh từ ngày tạo được nguồn trả về',s.age)}<td class="cs-id"><button data-copy-channel="${esc(id)}" title="${esc(id)} · Bấm sao chép">${esc(id)}</button></td>${saveButton?`<td>${saveButton(c)}</td>`:''}${proof?`<td class="cs-proof"><details><summary>${c.matchedVideoCount??0}/${c.sampleVideoCount??0} video</summary>${(c.evidenceVideos||[]).map(v=>`<a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noreferrer">${esc(v.title)}</a>`).join('')}</details></td>`:''}</tr>`;
  }).join('')}</tbody></table></div><p class="cs-note">— Chưa đủ dữ liệu · TB 10 video và tần suất tính trên mẫu đã đọc · Cuộn ngang để xem đủ cột.</p><span class="cs-copy-status" role="status"></span></div>`;
}
export function initChannelStats(){
  document.addEventListener('click',async e=>{const copy=e.target.closest('[data-copy-channel]');if(copy){const status=copy.closest('.channel-statistics').querySelector('.cs-copy-status');try{await navigator.clipboard.writeText(copy.dataset.copyChannel);status.textContent='Đã sao chép ID kênh.';}catch{status.textContent='Không sao chép được. ID: '+copy.dataset.copyChannel;}return;}
    const b=e.target.closest('[data-stat-sort]');if(!b)return;const table=b.closest('table'),index=Number(b.dataset.statSort),direction=b.dataset.direction==='desc'?'asc':'desc';table.querySelectorAll('th').forEach(th=>th.removeAttribute('aria-sort'));b.closest('th').setAttribute('aria-sort',direction==='desc'?'descending':'ascending');b.dataset.direction=direction;
    const rows=[...table.tBodies[0].rows];rows.sort((a,c)=>{const x=a.cells[index].dataset.sort,y=c.cells[index].dataset.sort;if(x==='')return y===''?0:1;if(y==='')return -1;const delta=Number.isFinite(Number(x))&&Number.isFinite(Number(y))?Number(x)-Number(y):x.localeCompare(y);return direction==='asc'?delta:-delta;});for(const [i,r]of rows.entries()){r.cells[0].textContent=i+1;table.tBodies[0].append(r);}
  });
}
