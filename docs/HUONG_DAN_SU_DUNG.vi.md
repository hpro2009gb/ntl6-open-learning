# NTL6 Learning Kit — Hướng dẫn sử dụng chi tiết

[README](../README.md) · [Toàn bộ tính năng](FEATURES.md) · [English guide](USER_GUIDE.md) · [Quy định riêng tư](../PRIVACY.md)

## 1. Đối tượng và phạm vi

NTL6 Public là **bản kỹ thuật thử nghiệm** của hệ hỗ trợ học tập có phụ huynh tham gia. Mục tiêu là thu thập bằng chứng học tập, phân biệt trẻ làm độc lập hay được giúp, phát hiện chủ đề cần ôn, đề xuất bước tiếp và tạo báo cáo dễ đọc cho phụ huynh.

Đây **chưa phải sản phẩm tự dạy mọi lớp/độ tuổi** và chưa có bằng chứng khẳng định hiệu quả học tập suốt đời. Không dùng báo cáo máy tính như một kết luận sư phạm, chẩn đoán tâm lý hay quyết định thay giáo viên.

## 2. Yêu cầu máy và cài đặt

- Máy có Node.js **20+** (đã thử với Node 24 tại môi trường phát triển).
- Git để clone repository; hoặc tải ZIP mã nguồn.
- Trình duyệt để xem file báo cáo HTML / giao diện Parent Console.
- Bộ demo thủ công **không cần API key, không cần đăng nhập dịch vụ AI**.

Ví dụ dòng lệnh:

```powershell
git clone https://github.com/hpro2009gb/ntl6-open-learning.git
cd ntl6-open-learning
npm run privacy
npm test
npm run demo
```

Bộ `npm run privacy` kiểm tra những đường dẫn/tín hiệu nhạy cảm trong file được Git quản lý; `npm test` chạy Node Test Runner; `npm run demo` dùng dữ liệu **synthetic** trong `examples/manual-pack/`.

Nếu chưa cài Git, tải ZIP source qua GitHub và giải nén; chạy các lệnh trong thư mục gốc.

## 3. Xem demo không có dữ liệu trẻ thật

Sau khi chạy:

```powershell
npm run demo
```

Terminal in ra `RUN_ID`, `OUTPUT_DIR`, `PARENT_VIEW`, `ANALYSIS`. Mở đường dẫn `PARENT_VIEW` trong trình duyệt. Kết quả nằm tại `runtime-data/manual-runs/<run-id>/`, gồm:

- `parent-view.html`: giao diện cho phụ huynh xem đề xuất học.
- `analysis.json`: quyết định, trạng thái, hạn chế và ngữ cảnh xử lý.
- `normalized-evidence.jsonl`: các bản ghi bằng chứng đã chuẩn hóa.

Dữ liệu `learner-demo` là **giả lập**, không phải một trẻ thật. Không đưa nó vào sổ kết quả cá nhân để suy luận tiến bộ thật.

## 4. Chuẩn bị một evidence pack hợp lệ

Mẫu tại `examples/manual-pack/`. Một pack tối thiểu cần:

```text
my-pack/
  manifest.json
  evidence.jsonl
```

`manifest.json` mô tả `pack_id`, `learner_id`, `as_of`, `policy_version`, danh sách `concepts[]`, phạm vi năng lực và `workload`. Mỗi dòng của `evidence.jsonl` là một bản ghi `EVIDENCE_OPPORTUNITY/1.0`.

Để chạy pack **tổng hợp mới**, tự tạo hồ sơ giả không trùng với người thật, rồi gọi:

```powershell
node tools/manual-mode/run.mjs path/to/my-pack
```

**Không đặt hồ sơ của trẻ thật trong repository.** Nếu thử nghiệm với dữ liệu thật ở môi trường cá nhân, chỉ dùng đường dẫn cục bộ ngoài Git, tách khỏi thư mục sync hoặc chia sẻ và cân nhắc rủi ro gửi dữ liệu lên dịch vụ AI. Bản public không có cơ chế bảo đảm mọi tích hợp luôn chạy hoàn toàn offline.

## 5. Đọc báo cáo đúng nghĩa

Khi xem kết quả, phân biệt ba nhóm:

1. **Quan sát độc lập đã có bằng chứng:** trẻ làm và giải thích được trong điều kiện ghi nhận rõ.
2. **Làm được nhưng có trợ giúp:** giá trị hướng dẫn thực hành, chưa đủ để nâng mức thông thạo độc lập.
3. **Chưa rõ/mâu thuẫn:** phải tìm thêm bằng chứng, không suy diễn điểm số hoặc nguyên nhân.

Hành động gợi ý như `DIAGNOSE`, `RETEACH`, `REPAIR`, `RECHECK`, `MAINTAIN`, `ADVANCE` đều phải qua đánh giá của phụ huynh/giáo viên. Không tự coi dự đoán của AI là quyết định chính thức.

## 6. Chạy Parent Console trên máy cá nhân

Giao diện thử nghiệm có sẵn mã nguồn và server Node. Để mở trên **localhost**:

```powershell
node tools/parent-console/server.mjs --port 17661 --open
```

Truy cập `http://127.0.0.1:17661/`. Tham số `--open` gọi mở trình duyệt trên Windows; nếu dùng hệ điều hành khác, bỏ tham số này rồi mở địa chỉ thủ công. Dùng Ctrl+C để dừng.

Giao diện có các nhóm dashboard, tiến độ, nguồn tài liệu, lịch sử đánh giá và câu hỏi. **Nhiều chức năng nâng cao cần kho nguồn/curriculum và cấu hình riêng không có trong phiên bản phát hành.** Trống dữ liệu hoặc thiếu nguồn không có nghĩa chương trình đã xác minh toàn bộ khả năng đó.

Server ràng buộc địa chỉ `127.0.0.1`; **không được mở port ra Internet hay public qua tunnel** khi chưa có kiểm thử bảo mật, cơ chế xác thực, phân quyền và quản trị dữ liệu.

## 7. Dùng 3 ChatGPT Skill giáo dục đi kèm

Thư mục `skills/` gồm ba Skill công khai, mỗi Skill có `SKILL.md` và metadata:

- `ntl6-lesson-guide`: giải thích từ lý thuyết, hỏi gợi mở và phân biệt phần trẻ tự làm.
- `ntl6-assessment-coach`: đề đánh giá ngắn, bản học sinh tách đáp án/rubric của người lớn.
- `ntl6-parent-review`: tổng hợp tín hiệu tiến bộ ở cấp chủ đề và đề xuất kế hoạch ôn hợp lý.

Có thể đóng gói từng thư mục Skill riêng theo hướng dẫn ChatGPT Skills; đây không phải hệ tích hợp tự đồng bộ dữ liệu trẻ vào Parent Console. Khi trò chuyện với AI cloud, chỉ dùng dữ liệu giả hoặc ẩn danh an toàn và có sự chấp thuận phù hợp của phụ huynh.

## 8. Nếu muốn đóng góp hoặc xây dựng bản mở rộng

- Phát triển module mới trong nhánh riêng và tạo test cho hành vi quan trọng.
- Chạy `npm run privacy`, `npm test`, sau đó soát **tất cả file staged** bằng `git diff --cached --name-only` và `git diff --cached`.
- Không chỉ dựa vào `.gitignore`: file từng commit có thể còn nằm trong lịch sử Git.
- Không đưa dữ liệu trẻ, hồ sơ lớp/trường, source giáo trình có bản quyền, token, cookie hoặc thư mục memory/orchestration nội bộ.
- Nếu phát hiện thông tin nhạy cảm bị công bố, tạm khóa quyền xem repo, đánh giá lịch sử Git và xóa bản công khai qua quy trình xử lý sự cố; chỉ sửa commit mới không xóa được lịch sử cũ.

## 9. Lỗi thường gặp

| Dấu hiệu | Hướng kiểm tra |
|---|---|
| `node` không nhận diện | Cài Node.js 20+ và mở lại terminal |
| Demo báo thiếu `manifest.json` hoặc `evidence.jsonl` | Dùng đúng folder chứa cả hai file hợp lệ |
| `PARENT_VIEW` không mở được | Mở đường dẫn tuyệt đối in trong terminal, kiểm tra file được tạo |
| `PARENT_CONSOLE_ALREADY_RUNNING` hoặc cổng bận | Dùng cửa sổ đang chạy, Ctrl+C phiên cũ hoặc đổi `--port` |
| Trang tài liệu/câu hỏi trống | Bản public không mang theo kho nguồn dữ liệu cá nhân |
| Privacy gate FAIL | Dừng push, xem loại lỗi và kiểm tra dữ liệu cẩn thận; không tắt guard để vượt qua |
| “Mastery” không thay đổi dù làm đúng có giúp | Đây là hành vi bảo thủ có chủ đích; cần chứng cứ độc lập và quyền duyệt |

**Giới hạn cuối cùng:** PASS bài test chứng minh một tập hành vi phần mềm ở môi trường kiểm thử, không chứng minh tính đúng đắn của mọi nội dung dạy học hoặc tác dụng đối với trẻ thật.
