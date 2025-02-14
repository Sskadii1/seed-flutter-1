
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/hooks/use-auth';
import { SupportTicket } from '@shared/schema';

export default function SupportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const form = useForm();

  const { data: tickets } = useQuery<SupportTicket[]>({
    queryKey: ['/api/support-tickets'],
    enabled: user?.isAdmin
  });

  const createTicket = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/support-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support-tickets'] });
      form.reset();
    }
  });

  const onSubmit = (data: any) => {
    createTicket.mutate(data);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Hỗ trợ học viên</h1>

      {!user?.isAdmin && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Gửi yêu cầu hỗ trợ</CardTitle>
            <CardDescription>Chúng tôi sẽ phản hồi trong thời gian sớm nhất</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <Input placeholder="Tiêu đề" {...form.register('title')} />
              <Textarea 
                placeholder="Nội dung yêu cầu..." 
                className="min-h-[120px]"
                {...form.register('content')}
              />
              <Button type="submit">Gửi yêu cầu</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {user?.isAdmin && tickets?.map(ticket => (
        <Card key={ticket.id} className="mb-4">
          <CardHeader>
            <CardTitle>{ticket.title}</CardTitle>
            <CardDescription>
              Trạng thái: {ticket.status === 'open' ? 'Đang chờ' : 
                          ticket.status === 'in-progress' ? 'Đang xử lý' : 'Đã giải quyết'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4">{ticket.content}</p>
            {ticket.adminResponse && (
              <div className="bg-muted p-4 rounded-lg">
                <p className="font-semibold">Phản hồi:</p>
                <p>{ticket.adminResponse}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
