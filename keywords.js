import { keywordRows,keywordCoverage } from './metrics.mjs';
export const statusLabel={running:'Đang chạy',completed:'Thành công',partial:'Hoàn tất một phần',failed:'Không thành công',cancelled:'Đã dừng',interrupted:'Bị gián đoạn'};
export const finished=status=>status!=='running';
export function researchView(job){
  const logs=job.logs||[],last=logs.at(-1)?.message||'';
  let phase=/phân nhóm|giải thích căn cứ/.test(last)?3:/Đang lấy dữ liệu/.test(last)?2:/lập truy vấn/.test(last)?1:0;
  if(job.report)phase=3;
  const done=finished(job.status),success=job.status==='completed';
  const steps=['Kết nối vidIQ','Chuẩn bị truy vấn','Lấy dữ liệu','AI phân tích'].map((title,i)=>{
    let state=success?'success':i<phase?'success':i===phase?(done?(job.status==='cancelled'||job.status==='interrupted'?'stopped':'error'):'running'):'pending';
    if(i===3&&job.args.analyze===false)state='skipped';
    const labels={success:'Thành công',running:'Đang thực hiện',error:'Không thành công',pending:'Chưa thực hiện',skipped:'Bỏ qua',stopped:'Đã dừng'};
    let detail=i===0?'Đọc công cụ của tài khoản':i===1?(job.args.analyze?'AI chuẩn bị từ khóa':'Dùng từ khóa bạn nhập'):i===2?(job.evidence?.length?`Đã nhận ${job.evidence.length} phản hồi · ${job.items?.length||0} từ khóa`:'Chờ vidIQ trả dữ liệu'):'Nhóm chủ đề và đề xuất nội dung';
    if(state==='running'&&i===1)detail='Ollama có thể cần 1–3 phút. Bạn có thể dừng bất cứ lúc nào.';
    if(state==='error')detail=job.error||'Bước này chưa hoàn tất.';
    if(state==='skipped')detail='Bạn đã tắt phân tích AI';
    return {title,state,label:labels[state],detail};
  });
  const title=success?`Đã hoàn tất · ${job.items?.length||0} từ khóa`:job.status==='partial'?'Đã lấy dữ liệu, còn bước chưa hoàn tất':statusLabel[job.status]||'Đang xử lý';
  return {steps,title,phase,done,success};
}
export function errorHelp(error=''){
  if(/xác thực|quyền truy cập|API key|kết nối vidIQ|HTTP 401|HTTP 403/i.test(error))return 'Mở Kết nối, kiểm tra khóa vidIQ rồi thử lại.';
  if(/AI|model|Ollama|JSON|dẫn chứng|truy vấn/i.test(error))return 'Kiểm tra Ollama và model. Bạn có thể tắt AI để lấy dữ liệu trước.';
  if(/credit|hạn mức|429|ngân sách/i.test(error))return 'Kiểm tra credit hoặc chờ hết giới hạn của vidIQ.';
  if(/thời gian|mạng|kết nối/i.test(error))return 'Kiểm tra mạng và dịch vụ. Dữ liệu đã nhận vẫn được giữ.';
  return 'Xem chi tiết bên dưới, điều chỉnh cấu hình rồi chạy lại khi sẵn sàng.';
}

export {initKeywords} from './keyword-ui.js';
