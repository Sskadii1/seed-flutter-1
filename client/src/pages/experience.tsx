import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StudyTip } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ExperiencePage() {
  const { data: tips, isLoading } = useQuery<StudyTip[]>({
    queryKey: ['/api/study-tips']
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Kinh nghiệm</h1>

      <div className="prose max-w-none">
        <p className="text-lg mb-4">
          Chia sẻ kinh nghiệm và phương pháp học thi hiệu quả từ những người đã thành công.
        </p>
      </div>
    </div>
  );
}
