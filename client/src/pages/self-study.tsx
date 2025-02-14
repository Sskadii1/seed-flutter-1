import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Exercise } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Book, BookOpen, GraduationCap } from 'lucide-react';
import { Link } from 'wouter';

export default function SelfStudyPage() {
  const { data: exercises, isLoading } = useQuery<Exercise[]>({
    queryKey: ['/api/exercises']
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Tự ôn luyện</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Book className="h-5 w-5 text-primary" />
              <CardTitle>Ngữ pháp</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Luyện tập ngữ pháp tiếng Hàn theo từng cấp độ
            </p>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                Ngữ pháp TOPIK I
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Ngữ pháp TOPIK II
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <CardTitle>Từ vựng</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Học và ôn tập từ vựng theo chủ đề
            </p>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                Từ vựng cơ bản
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Từ vựng nâng cao
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <CardTitle>Bài tập tổng hợp</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Luyện tập kết hợp ngữ pháp và từ vựng
            </p>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                Bài tập TOPIK I
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Bài tập TOPIK II
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-6">Bài tập mới nhất</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exercises?.map(exercise => (
            <Card key={exercise.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>{exercise.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">{exercise.description}</p>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">
                    {exercise.type === 'grammar' ? 'Ngữ pháp' : 'Từ vựng'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {exercise.points} điểm
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}