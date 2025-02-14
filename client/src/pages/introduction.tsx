import React from 'react';

export default function IntroductionPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Giới thiệu về TOPIK Online</h1>
      <div className="prose max-w-none">
        <p className="text-lg mb-4">
          TOPIK Online là nền tảng ôn luyện thi TOPIK trực tuyến hàng đầu Việt Nam, cung cấp các khóa học và tài liệu chất lượng cao để giúp học viên đạt được mục tiêu trong kỳ thi TOPIK.
        </p>
        <h2 className="text-2xl font-bold mt-8 mb-4">Các tính năng chính</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>Đề thi thử TOPIK các cấp độ</li>
          <li>Bài tập ngữ pháp và từ vựng</li>
          <li>Lộ trình học tập được cá nhân hóa</li>
          <li>Công cụ theo dõi tiến độ học tập</li>
          <li>Chia sẻ kinh nghiệm từ người đã thành công</li>
          <li>Công cụ quản lý thời gian học tập</li>
        </ul>
      </div>
    </div>
  );
}
