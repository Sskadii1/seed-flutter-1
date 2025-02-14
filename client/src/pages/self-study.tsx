import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Exercise } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SelfStudyPage() {
  const { data: exercises, isLoading } = useQuery<Exercise[]>({
    queryKey: ['/api/exercises']
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Tự ôn luyện</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ngữ pháp</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Luyện tập ngữ pháp tiếng Hàn theo từng cấp độ
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Từ vựng</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Học và ôn tập từ vựng theo chủ đề
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bài tập tổng hợp</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Luyện tập kết hợp ngữ pháp và từ vựng
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
