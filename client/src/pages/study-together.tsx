import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Course } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Calendar, Clock } from 'lucide-react';

export default function StudyTogetherPage() {
  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ['/api/courses']
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Cùng ôn luyện</h1>

      <div className="prose max-w-none mb-8">
        <p className="text-lg mb-4">
          Tham gia các khóa học trực tuyến cùng giảng viên và học viên khác. 
          Học nhóm giúp bạn duy trì động lực và tiến bộ nhanh hơn.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle>Lớp học trực tuyến</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Tham gia lớp học với giảng viên và bạn học từ khắp nơi
            </p>
            <Button className="w-full">Xem lịch học</Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <CardTitle>Lịch ôn tập</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Đăng ký lịch ôn tập phù hợp với thời gian của bạn
            </p>
            <Button className="w-full">Đăng ký ngay</Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle>Học thử miễn phí</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Tham gia buổi học thử để trải nghiệm phương pháp giảng dạy
            </p>
            <Button className="w-full">Đăng ký học thử</Button>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-2xl font-bold mb-6">Khóa học sắp khai giảng</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses?.filter(course => course.isFeatured).map(course => (
          <Card key={course.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle>{course.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">{course.description}</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Thời lượng:</span>
                  <span>{course.duration} giờ</span>
                </div>
                <div className="flex justify-between">
                  <span>Học phí:</span>
                  <span>{course.price.toLocaleString()} VNĐ</span>
                </div>
              </div>
              <Button className="w-full mt-4">Đăng ký ngay</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}