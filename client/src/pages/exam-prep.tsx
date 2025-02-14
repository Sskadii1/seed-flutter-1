import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PracticeExam } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExamPrepPage() {
  const { data: exams, isLoading } = useQuery<PracticeExam[]>({
    queryKey: ['/api/practice-exams']
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Ôn thi</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Đề thi TOPIK I</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Thi thử TOPIK cấp độ sơ cấp (Level 1-2)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Đề thi TOPIK II</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Thi thử TOPIK cấp độ trung - cao cấp (Level 3-6)
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
