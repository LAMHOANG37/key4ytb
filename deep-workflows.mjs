import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./vendor/tubelab-research/',import.meta.url);
export const workflowSource=JSON.parse(readFileSync(new URL('source.json',root),'utf8').replace(/^\uFEFF/,''));
export const workflowLicense=readFileSync(new URL('LICENSE',root),'utf8');
export const tubeLabGuide=readFileSync(new URL('skills/tubelab-mcp/SKILL.md',root),'utf8');
const definitions={
  'reverse-engineer-channel':['Phân tích kênh chuyên sâu','Tìm nội dung nổi bật, mẫu tiêu đề và định dạng hiệu quả.','channel','Kênh'],
  'roast-channel':['Đánh giá điểm mạnh / yếu','Chuẩn bị căn cứ để đánh giá định vị và nội dung kênh.','channel','Kênh'],
  'video-ideation':['Ý tưởng video','Chuẩn bị dữ liệu kênh và video để AI đề xuất ý tưởng có căn cứ.','channel','Nội dung'],
  'niche-bending':['Mở rộng ngách','Nghiên cứu cách chuyển một định dạng sang thị trường khác.','channel','Ngách'],
  'niche-finder':['Khám phá ngách','Chuẩn bị mẫu kênh cùng chủ đề để tìm hướng phát triển.','niche','Ngách'],
  'niche-validator':['Đánh giá ngách','Chuẩn bị mẫu và số liệu để đánh giá một ngách.','niche','Ngách'],
  'reverse-engineer-niche':['Phân tích ngách / đối thủ','Tập hợp các kênh cùng chủ đề, định dạng và video dẫn chứng.','niche','Ngách'],
  'trend-report':['Báo cáo xu hướng','Chuẩn bị dữ liệu hiệu suất video trong mẫu chủ đề.','niche','Nội dung'],
  'title-formulas':['Mẫu tiêu đề','Tập hợp tiêu đề và hiệu suất để nghiên cứu cách đặt tên.','niche','Nội dung'],
  'thumbnail-concepts':['Ý tưởng thumbnail','Chuẩn bị nguồn và yêu cầu nghiên cứu thumbnail.','niche','Nội dung'],
  'comment-mining':['Nghiên cứu bình luận','Chuẩn bị hồ sơ video và yêu cầu phân tích tiếng nói khán giả.','channel','Khán giả'],
  'script-breakdown':['Phân tích kịch bản','Chuẩn bị video và yêu cầu phân tích hook, cấu trúc, nhịp kể.','video','Nội dung'],
  'revenue-maxxing':['Cơ hội kiếm tiền','Chuẩn bị dữ liệu cho nghiên cứu nguồn thu và khoảng trống.','channel','Kinh doanh'],
  'audit-channel-risk':['Đánh giá rủi ro kênh','Chuẩn bị bằng chứng, không tự chấm rủi ro khi thiếu nguồn.','channel','Kinh doanh'],
  'sponsorship-prospecting':['Tìm đối tác tài trợ','Lập hồ sơ sản phẩm và yêu cầu tìm kênh phù hợp.','brief','Kinh doanh'],
  'niche-watchlist':['Danh sách theo dõi ngách','Tạo hồ sơ ngách để so sánh các lần chuẩn bị; chưa tự chạy định kỳ.','niche','Ngách'],
};
export const workflows=readdirSync(new URL('skills/',root),{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='tubelab-mcp').map(d=>{
  const text=readFileSync(new URL('skills/'+d.name+'/SKILL.md',root),'utf8');const [title,description,input,group]=definitions[d.name]||[d.name,'Quy trình từ TubeLab.','brief','Khác'];
  const workflow=text.split(/## Workflow\s*/)[1]?.split(/## Output Format/)[0]?.trim()||'';
  return {id:d.name,title,description,input,group,version:text.match(/version:\s*["']?([^\r\n"']+)/)?.[1]?.trim()||null,sha256:createHash('sha256').update(text).digest('hex'),guideUrl:`${workflowSource.repository}/blob/${workflowSource.revision}/skills/${d.name}/SKILL.md`,steps:workflow.split('\n').filter(l=>/^\d+\./.test(l)).map(l=>l.replace(/^\d+\.\s*/,'')),text};
});
export const publicWorkflow=w=>{const {text,...metadata}=w;return metadata;};
export function getWorkflow(id){const w=workflows.find(w=>w.id===id);if(!w)throw Object.assign(new Error('Không tìm thấy quy trình nghiên cứu.'),{status:400});return w;}
