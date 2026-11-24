# NicheScope — key4ytb

Ứng dụng nghiên cứu YouTube chạy trên máy cá nhân: tìm kênh, nghiên cứu từ khóa, phân tích kênh và chuẩn bị/phân tích hồ sơ theo quy trình TubeLab Research Skills.

## Chạy ứng dụng

Yêu cầu Node.js **24.22.1 trở lên** và npm. Trong thư mục repo:

```sh
npm ci
npm start
```

Mở **http://127.0.0.1:4173**. Trên Windows có thể dùng `start.cmd` sau khi cài dependency. Backend chỉ lắng nghe loopback; đây chưa phải dịch vụ nhiều người dùng để triển khai công khai.

YouTube.js là nguồn mặc định, không cần API key. Model E5 tải và lưu cache cục bộ khi cần xếp hạng ngữ nghĩa. Có thể chuẩn bị model trước bằng `node scripts/setup-model.mjs` khi server đã dừng.

## Cấu hình riêng

Sao chép `.env.example` thành `.env` rồi cấu hình trên máy. `.env`, database, lịch sử và model cache **không được đưa lên Git**.

| Biến | Công dụng |
|---|---|
| `PORT` | Cổng local, mặc định `4173` |
| `YOUTUBE_API_KEY` | Tùy chọn, cho nguồn YouTube Data API chính thức |
| `VIDIQ_API_KEY` | Khóa MCP vidIQ của chính người dùng |
| `VIDIQ_KEY_LOCKED` | Đặt `1` để chặn xóa/thay khóa mặc định qua API cấu hình |
| `RESEARCH_AI_PROVIDER` | `ollama` cho AI trên máy |
| `RESEARCH_AI_MODEL` | Mặc định `qwen3:4b` |

Khóa môi trường phải được giữ trong `.env`; app không trả giá trị khóa về trình duyệt. Kết nối vidIQ trong một ứng dụng chat không tự cấp quyền cho backend này. Các lượt tìm kiếm mới của vidIQ có thể tính credit; app hiển thị thông báo và dùng lại cache khi có.

## Ollama

Cài và khởi động Ollama trên máy, rồi tải model:

```sh
ollama pull qwen3:4b
```

Backend gọi Ollama tại `http://127.0.0.1:11434`. Nghiên cứu chuyên sâu có tùy chọn phân tích ngay sau khi chuẩn bị, hoặc phân tích lại từ hồ sơ đã lưu mà không gọi lại nguồn. Lỗi AI giữ lại dữ liệu; nhận định phải được đối chiếu với bằng chứng. Muse chưa được tích hợp.

## Chức năng

- **Tìm kênh / kênh tương tự:** thu thập ứng viên, đọc mẫu video, xếp hạng theo từ khóa hoặc E5.
- **Từ khóa:** dữ liệu vidIQ theo chủ đề, quốc gia và khoảng thời gian. Growth của chế độ rising là toàn cầu; quốc gia lọc theo thị trường nguồn cung cấp.
- **Tìm kênh theo chủ đề:** kết hợp vidIQ với YouTube, kiểm tra video mẫu và hiển thị dẫn chứng.
- **Phân tích kênh:** nhập link, `@handle` hoặc Channel ID; thu thập metadata/tag công khai với giới hạn rõ ràng.
- **Nghiên cứu chuyên sâu:** 16 quy trình từ TubeLab Research Skills; chuẩn bị hồ sơ, phân tích bằng Ollama, lưu lịch sử và xuất JSON/Markdown. Nguồn TubeLab chưa được kết nối, nên không có các dữ liệu độc quyền của dịch vụ đó.
- **Thống kê / thư viện:** bảng nền sáng, sắp xếp, sao chép ID, lưu kênh và xuất dữ liệu.

Địa chỉ chức năng dùng URL hash, ví dụ `/#keywords`, `/#channel-analysis`, `/#research`.

## Giới hạn dữ liệu

Các chỉ số thiếu hiển thị `—`; không thay bằng số 0 hoặc dữ liệu giả. Số liệu nguồn có thể được làm tròn. TB gần đây, tần suất và outlier phụ thuộc mẫu đã đọc; không xác nhận toàn bộ video của kênh. Outlier cục bộ dùng trung vị video khác cùng kênh/định dạng, chưa cân bằng tuổi video và không phải chỉ số TubeLab. AI chỉ đọc mẫu giới hạn cùng thống kê tổng hợp, không có Analytics riêng tư, không chứng minh nguyên nhân hoặc bảo đảm hiệu quả nội dung.

## Kiểm thử

```sh
npm test
```

Tests dùng dữ liệu kiểm thử và HTTP local; không yêu cầu khóa thật hoặc gọi nghiên cứu trả phí. Bản phát hành không bao gồm `.env`, SQLite, thư viện/lịch sử cá nhân, kết quả khảo sát thực tế, screenshot hay model tải về.

## Cấu trúc

- `server.mjs`, `store.mjs`: API local và SQLite.
- `innertube.mjs`, `youtube.mjs`, `vidiq.mjs`: adapter dữ liệu.
- `jobs.mjs`, `research.mjs`, `topic-channels.mjs`, `channel-analysis.mjs`: luồng nghiên cứu.
- `deep-*.mjs`, `deep-ui.js`: quy trình chuyên sâu và Ollama.
- `analysis.mjs`, `metrics.mjs`, `channel-stats.js`: tính toán và hiển thị.
- `vendor/tubelab-research/`: tài liệu/quy trình TubeLab đã pin phiên bản.
- `test/`: unit và integration tests.

Xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) cho nguồn và giấy phép của phần được tích hợp.
