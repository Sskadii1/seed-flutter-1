
import React from 'react';
import { GraduationCap, BookOpen, Users, Award } from 'lucide-react';

export default function IntroductionPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
          Giới thiệu về SEED-TOPIK
        </h1>
        <p className="text-xl text-center text-gray-600 max-w-3xl mx-auto mb-12">
          SEED-TOPIK là nền tảng ôn luyện thi TOPIK trực tuyến hàng đầu Việt Nam, cung cấp các khóa học và tài liệu chất lượng cao để giúp học viên đạt được mục tiêu trong kỳ thi TOPIK.
        </p>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <GraduationCap className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Giáo trình chuyên sâu</h3>
            <p className="text-gray-600">Tài liệu học tập được biên soạn kỹ lưỡng theo chuẩn TOPIK mới nhất</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <BookOpen className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Đề thi thử</h3>
            <p className="text-gray-600">Ngân hàng đề thi phong phú, cập nhật liên tục theo format mới nhất</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <Users className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Học nhóm hiệu quả</h3>
            <p className="text-gray-600">Môi trường học tập tương tác, khuyến khích giao lưu và hỗ trợ lẫn nhau</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <Award className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Chứng chỉ giá trị</h3>
            <p className="text-gray-600">Hỗ trợ đạt điểm cao trong kỳ thi TOPIK chính thức</p>
          </div>
        </div>

        {/* TOPIK Information */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-16">
          <h2 className="text-3xl font-bold mb-6 text-center">Về kỳ thi TOPIK</h2>
          <p className="text-lg text-gray-600 mb-8 text-center">
            TOPIK (Test of Proficiency in Korean) là kỳ thi đánh giá năng lực tiếng Hàn được tổ chức bởi National Institute for International Education (NIIED) của Hàn Quốc.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-blue-50 p-6 rounded-xl">
              <h3 className="text-xl font-bold mb-4 text-primary">TOPIK I (Sơ cấp)</h3>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Cấp độ 1 và 2
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Dành cho người mới bắt đầu học tiếng Hàn
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Kiểm tra kỹ năng giao tiếp cơ bản
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 p-6 rounded-xl">
              <h3 className="text-xl font-bold mb-4 text-primary">TOPIK II (Trung - Cao cấp)</h3>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Cấp độ 3 đến 6
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Dành cho người đã có nền tảng tiếng Hàn
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  Kiểm tra khả năng sử dụng tiếng Hàn trong học tập và công việc
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
