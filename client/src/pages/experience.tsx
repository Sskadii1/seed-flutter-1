import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { StudyTip } from '@shared/schema';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useForm } from 'react-hook-form';
import { ThumbsUp, MessageSquare, Share2 } from 'lucide-react';
import { format } from 'date-fns';

type TipFormData = {
  title: string;
  content: string;
  category: string;
};

export default function ExperiencePage() {
  const { user } = useAuth();
  const { data: tips, isLoading } = useQuery<StudyTip[]>({
    queryKey: ['/api/study-tips']
  });

  const form = useForm<TipFormData>({
    defaultValues: {
      title: '',
      content: '',
      category: 'general'
    }
  });

  const onSubmit = (data: TipFormData) => {
    // TODO: Implement post creation
    console.log(data);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Kinh nghiệm</h1>

      {user && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Chia sẻ kinh nghiệm của bạn</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Input 
                placeholder="Tiêu đề bài viết"
                {...form.register('title')}
              />
              <Textarea 
                placeholder="Chia sẻ kinh nghiệm học và thi TOPIK của bạn..."
                className="min-h-[120px]"
                {...form.register('content')}
              />
              <select 
                className="w-full p-2 border rounded-md"
                {...form.register('category')}
              >
                <option value="general">Chung</option>
                <option value="grammar">Ngữ pháp</option>
                <option value="vocabulary">Từ vựng</option>
                <option value="exam">Kinh nghiệm thi</option>
              </select>
              <Button type="submit" className="w-full">
                Đăng bài
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6">
        {tips?.map(tip => (
          <Card key={tip.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="mb-2">{tip.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(tip.createdAt), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
                <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-sm">
                  {tip.category}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap">{tip.content}</p>
              {tip.imageUrl && (
                <img 
                  src={tip.imageUrl} 
                  alt="" 
                  className="mt-4 rounded-lg max-h-96 w-full object-cover"
                />
              )}
            </CardContent>
            <CardFooter className="flex gap-4 text-muted-foreground">
              <Button variant="ghost" size="sm" className="flex gap-2">
                <ThumbsUp className="h-4 w-4" />
                <span>{tip.likes}</span>
              </Button>
              <Button variant="ghost" size="sm" className="flex gap-2">
                <MessageSquare className="h-4 w-4" />
                <span>{(tip.comments || []).length}</span>
              </Button>
              <Button variant="ghost" size="sm" className="flex gap-2">
                <Share2 className="h-4 w-4" />
                <span>Chia sẻ</span>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}