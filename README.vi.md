# NTL6 Learning Kit — học tập có bằng chứng, bảo vệ dữ liệu trẻ em

[English](README.md) · [Tính năng đầy đủ](docs/FEATURES.md) · [Hướng dẫn sử dụng tiếng Việt](docs/HUONG_DAN_SU_DUNG.vi.md) · [Hướng dẫn English](docs/USER_GUIDE.md)

NTL6 là dự án thử nghiệm giáo dục có phụ huynh tham gia: ghi nhận kết quả học tập một cách thận trọng, phân biệt trẻ tự làm và được hỗ trợ, phát hiện phần cần học lại và gợi ý luyện tập/kiểm tra tiếp. Mục tiêu dài hạn là giúp trẻ chủ động học tập, **chưa phải lời khẳng định về hiệu quả học tập suốt đời đã được khoa học chứng minh**.

## Các phần đã công khai

- Core evidence, concept state, trend, diagnosis, strategy, workload.
- Mô hình ledger và hợp đồng dữ liệu có khả năng giải thích.
- Trình chạy demo không cần API key với **dữ liệu giả lập hoàn toàn**.
- Báo cáo HTML cục bộ cho phụ huynh và nguyên mẫu Parent Console.
- Ba Skill: hướng dẫn bài học, tạo bài đánh giá, tổng kết cho phụ huynh.
- Privacy gate để cảnh báo một số mẫu dữ liệu/đường dẫn nhạy cảm.

## Dùng thử

Yêu cầu Node.js 20+. Clone repo rồi chạy:

```powershell
npm run privacy
npm test
npm run demo
```

Mở file được terminal in ra tại `PARENT_VIEW`. Không dùng dữ liệu trẻ thật trong repo, issue hay ví dụ đăng công khai.

## Giới hạn

Các tính năng cần kho bài học, nội dung từ sách giáo khoa, tài khoản trường học hoặc dữ liệu riêng không được phân phối trong bản public. Parent Console chỉ nên dùng trên localhost, chưa đủ điều kiện public Internet. Đưa dữ liệu vào AI cloud vẫn có thể truyền nội dung ra ngoài máy; đừng nhầm GitHub công khai sạch với chế độ AI offline hoàn toàn.

Tài liệu sử dụng và tính năng được trình bày chi tiết tại [docs/](docs/).

**HungLab** · https://hunglab.xyz · founder@hunglab.xyz
