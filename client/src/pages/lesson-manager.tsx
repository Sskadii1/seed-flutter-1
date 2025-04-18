import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash, CheckCircle, XCircle, FileText } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

// Schema cho bài học mới
const lessonSchema = z.object({
  title: z.string().min(3, "Tiêu đề phải có ít nhất 3 ký tự"),
  description: z.string().min(10, "Mô tả phải có ít nhất 10 ký tự"),
  type: z.enum(["vocabulary", "grammar", "quiz", "listening", "video"], {
    required_error: "Vui lòng chọn loại bài học"
  }),
  level: z.enum(["beginner", "intermediate", "advanced"], {
    required_error: "Vui lòng chọn cấp độ"
  }),
  isFreemium: z.boolean().default(true),
  content: z.any().optional(), // Sẽ được xử lý dựa trên loại bài học
  mediaUrl: z.string().optional(),
});

type LessonFormValues = z.infer<typeof lessonSchema>;

export default function LessonManager() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedLesson, setSelectedLesson] = useState<any>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [contentJson, setContentJson] = useState("{}");

  // Form cho bài học
  const form = useForm<LessonFormValues>({
    resolver: zodResolver(lessonSchema),
    defaultValues: {
      title: "",
      description: "",
      type: "vocabulary",
      level: "beginner",
      isFreemium: true,
      content: {},
      mediaUrl: "",
    },
  });
  
  // Lấy danh sách tất cả bài học của user
  const { data: myLessons, isLoading } = useQuery({
    queryKey: ["/api/users", user?.id, "lessons"],
    queryFn: async () => {
      if (!user) return [];
      const res = await apiRequest("GET", `/api/users/${user.id}/lessons`);
      return await res.json();
    },
    enabled: !!user
  });

  // Lấy danh sách bài học chờ duyệt (nếu là manager trở lên)
  const { data: pendingLessons, isLoading: isPendingLoading } = useQuery({
    queryKey: ["/api/lessons/pending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/lessons/pending");
      return await res.json();
    },
    enabled: user?.role === "manager" || user?.role === "admin"
  });

  // Tạo bài học mới
  const createLessonMutation = useMutation({
    mutationFn: async (data: LessonFormValues) => {
      // Parse nội dung từ JSON string sang object
      let parsedContent;
      try {
        parsedContent = JSON.parse(contentJson);
      } catch (error) {
        throw new Error("Nội dung không phải là JSON hợp lệ");
      }
      
      // Thêm nội dung vào dữ liệu
      const lessonData = {
        ...data,
        content: parsedContent
      };
      
      const res = await apiRequest("POST", "/api/lessons", lessonData);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Không thể tạo bài học");
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Tạo bài học thành công",
        description: "Bài học của bạn đã được tạo và đang chờ phê duyệt",
      });
      setIsCreateDialogOpen(false);
      form.reset();
      setContentJson("{}");
      // Cập nhật danh sách
      queryClient.invalidateQueries({ queryKey: ["/api/users", user?.id, "lessons"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Lỗi khi tạo bài học",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Phê duyệt bài học
  const approveLessonMutation = useMutation({
    mutationFn: async ({ id, reviewNote }: { id: number, reviewNote?: string }) => {
      const res = await apiRequest("POST", `/api/lessons/${id}/approve`, { reviewNote });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Không thể phê duyệt bài học");
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Phê duyệt thành công",
        description: "Bài học đã được phê duyệt và đã được xuất bản",
      });
      // Cập nhật danh sách
      queryClient.invalidateQueries({ queryKey: ["/api/lessons/pending"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Lỗi khi phê duyệt",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Từ chối bài học
  const rejectLessonMutation = useMutation({
    mutationFn: async ({ id, reviewNote }: { id: number, reviewNote: string }) => {
      const res = await apiRequest("POST", `/api/lessons/${id}/reject`, { reviewNote });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Không thể từ chối bài học");
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Từ chối thành công",
        description: "Bài học đã bị từ chối và sẽ được thông báo đến tác giả",
      });
      // Cập nhật danh sách
      queryClient.invalidateQueries({ queryKey: ["/api/lessons/pending"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Lỗi khi từ chối",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Xử lý tạo bài học
  const onSubmit = (data: LessonFormValues) => {
    createLessonMutation.mutate(data);
  };

  // Hỗ trợ tạo nội dung dựa trên loại bài học
  const getContentTemplate = (type: string) => {
    switch (type) {
      case "vocabulary":
        return JSON.stringify({
          words: [
            { korean: "안녕하세요", vietnamese: "Xin chào", example: "안녕하세요, 저는 민수입니다." },
            // Thêm các từ khác
          ]
        }, null, 2);
      case "grammar":
        return JSON.stringify({
          rules: [
            { 
              pattern: "N + 이/가 있어요/없어요", 
              explanation: "Cấu trúc diễn tả sự có hoặc không có", 
              examples: ["책이 있어요. (Có sách)", "시간이 없어요. (Không có thời gian)"] 
            },
            // Thêm các quy tắc khác
          ]
        }, null, 2);
      case "quiz":
        return JSON.stringify({
          questions: [
            { 
              text: "안녕하세요의 뜻이 무엇입니까?", 
              options: ["Xin chào", "Tạm biệt", "Cảm ơn", "Xin lỗi"],
              correctAnswer: 0,
              explanation: "안녕하세요 nghĩa là Xin chào trong tiếng Việt" 
            },
            // Thêm các câu hỏi khác
          ]
        }, null, 2);
      case "listening":
        return JSON.stringify({
          transcript: "대화 내용을 여기에 작성하세요.",
          questions: [
            { 
              text: "Người nói đang nói về gì?", 
              options: ["Thời tiết", "Gia đình", "Công việc", "Du lịch"],
              correctAnswer: 0
            },
            // Thêm các câu hỏi khác
          ]
        }, null, 2);
      case "video":
        return JSON.stringify({
          description: "Mô tả nội dung video",
          transcript: "내용을 여기에 작성하세요.",
          questions: [
            { 
              text: "Video này đang giải thích gì?", 
              options: ["Ngữ pháp cơ bản", "Từ vựng", "Văn hóa Hàn Quốc", "Cách phát âm"],
              correctAnswer: 0
            },
            // Thêm các câu hỏi khác
          ]
        }, null, 2);
      default:
        return "{}";
    }
  };

  // Cập nhật mẫu nội dung dựa trên loại bài học được chọn
  const updateContentTemplate = (type: string) => {
    setContentJson(getContentTemplate(type));
  };

  if (!user) {
    return (
      <div className="container mx-auto py-10 text-center">
        <h1 className="text-2xl font-bold mb-4">Vui lòng đăng nhập</h1>
        <p>Bạn cần đăng nhập để truy cập trang này.</p>
        <Button className="mt-4" onClick={() => navigate("/auth")}>
          Đăng nhập
        </Button>
      </div>
    );
  }

  if (user.role !== "teacher" && user.role !== "manager" && user.role !== "admin") {
    return (
      <div className="container mx-auto py-10 text-center">
        <h1 className="text-2xl font-bold mb-4">Không có quyền truy cập</h1>
        <p>Bạn cần quyền giáo viên trở lên để truy cập trang này.</p>
        <Button className="mt-4" onClick={() => navigate("/")}>
          Về trang chủ
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Quản lý bài học</h1>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Tạo bài học mới
        </Button>
      </div>

      <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">Tất cả bài học của tôi</TabsTrigger>
          <TabsTrigger value="pending">Bài học đang chờ duyệt</TabsTrigger>
          {(user.role === "manager" || user.role === "admin") && (
            <TabsTrigger value="review">Bài học cần phê duyệt</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="all">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : myLessons?.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myLessons.map((lesson: any) => (
                <Card key={lesson.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{lesson.title}</CardTitle>
                        <CardDescription>
                          {lesson.type === "vocabulary" && "Từ vựng"}
                          {lesson.type === "grammar" && "Ngữ pháp"}
                          {lesson.type === "quiz" && "Bài tập trắc nghiệm"}
                          {lesson.type === "listening" && "Bài nghe"}
                          {lesson.type === "video" && "Bài học video"}
                          {" - "}
                          {lesson.level === "beginner" && "Sơ cấp"}
                          {lesson.level === "intermediate" && "Trung cấp"}
                          {lesson.level === "advanced" && "Cao cấp"}
                        </CardDescription>
                      </div>
                      <div className="flex items-center">
                        {lesson.status === "pending" && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Chờ duyệt</span>
                        )}
                        {lesson.status === "approved" && (
                          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">Đã duyệt</span>
                        )}
                        {lesson.status === "rejected" && (
                          <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">Từ chối</span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600 line-clamp-3">{lesson.description}</p>
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <div>
                      {lesson.isFreemium ? (
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Miễn phí</span>
                      ) : (
                        <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">Premium</span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4 mr-1" /> Sửa
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-500">
                        <Trash className="h-4 w-4 mr-1" /> Xóa
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Chưa có bài học nào</h3>
              <p className="text-gray-500 mb-4">Bạn chưa tạo bài học nào. Hãy tạo bài học đầu tiên của bạn.</p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Tạo bài học mới
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : myLessons?.filter((l: any) => l.status === "pending").length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {myLessons.filter((l: any) => l.status === "pending").map((lesson: any) => (
                <Card key={lesson.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>{lesson.title}</CardTitle>
                        <CardDescription>
                          {lesson.type === "vocabulary" && "Từ vựng"}
                          {lesson.type === "grammar" && "Ngữ pháp"}
                          {lesson.type === "quiz" && "Bài tập trắc nghiệm"}
                          {lesson.type === "listening" && "Bài nghe"}
                          {lesson.type === "video" && "Bài học video"}
                          {" - "}
                          {lesson.level === "beginner" && "Sơ cấp"}
                          {lesson.level === "intermediate" && "Trung cấp"}
                          {lesson.level === "advanced" && "Cao cấp"}
                        </CardDescription>
                      </div>
                      <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Chờ duyệt</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600 line-clamp-3">{lesson.description}</p>
                  </CardContent>
                  <CardFooter className="flex justify-between">
                    <div>
                      {lesson.isFreemium ? (
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Miễn phí</span>
                      ) : (
                        <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">Premium</span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4 mr-1" /> Sửa
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Không có bài học đang chờ duyệt</h3>
              <p className="text-gray-500">Tất cả bài học của bạn đã được duyệt hoặc bạn chưa tạo bài học nào.</p>
            </div>
          )}
        </TabsContent>

        {(user.role === "manager" || user.role === "admin") && (
          <TabsContent value="review">
            {isPendingLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : pendingLessons?.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingLessons.map((lesson: any) => (
                  <Card key={lesson.id}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>{lesson.title}</CardTitle>
                          <CardDescription>
                            {lesson.type === "vocabulary" && "Từ vựng"}
                            {lesson.type === "grammar" && "Ngữ pháp"}
                            {lesson.type === "quiz" && "Bài tập trắc nghiệm"}
                            {lesson.type === "listening" && "Bài nghe"}
                            {lesson.type === "video" && "Bài học video"}
                            {" - "}
                            {lesson.level === "beginner" && "Sơ cấp"}
                            {lesson.level === "intermediate" && "Trung cấp"}
                            {lesson.level === "advanced" && "Cao cấp"}
                          </CardDescription>
                        </div>
                        <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">Chờ duyệt</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-gray-600 line-clamp-3">{lesson.description}</p>
                      <div className="mt-2">
                        <p className="text-sm font-semibold">Tác giả: </p>
                        {/* Hiển thị thông tin tác giả nếu có */}
                      </div>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                      <div>
                        {lesson.isFreemium ? (
                          <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">Miễn phí</span>
                        ) : (
                          <span className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded">Premium</span>
                        )}
                      </div>
                      <div className="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-green-500"
                          onClick={() => approveLessonMutation.mutate({ id: lesson.id })}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" /> Duyệt
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-red-500"
                          onClick={() => {
                            const reviewNote = prompt("Nhập lý do từ chối:");
                            if (reviewNote) {
                              rejectLessonMutation.mutate({ id: lesson.id, reviewNote });
                            }
                          }}
                        >
                          <XCircle className="h-4 w-4 mr-1" /> Từ chối
                        </Button>
                      </div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold mb-2">Không có bài học cần phê duyệt</h3>
                <p className="text-gray-500">Tất cả bài học đã được duyệt hoặc từ chối.</p>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Dialog tạo bài học mới */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tạo bài học mới</DialogTitle>
            <DialogDescription>
              Điền thông tin bài học của bạn. Bài học sẽ được gửi đến quản lý để phê duyệt.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tiêu đề</FormLabel>
                      <FormControl>
                        <Input placeholder="Nhập tiêu đề bài học" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loại bài học</FormLabel>
                      <Select 
                        onValueChange={(value) => {
                          field.onChange(value);
                          updateContentTemplate(value);
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Chọn loại bài học" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="vocabulary">Từ vựng</SelectItem>
                          <SelectItem value="grammar">Ngữ pháp</SelectItem>
                          <SelectItem value="quiz">Bài tập trắc nghiệm</SelectItem>
                          <SelectItem value="listening">Bài nghe</SelectItem>
                          <SelectItem value="video">Bài học video</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="level"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cấp độ</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Chọn cấp độ" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="beginner">Sơ cấp</SelectItem>
                          <SelectItem value="intermediate">Trung cấp</SelectItem>
                          <SelectItem value="advanced">Cao cấp</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isFreemium"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Miễn phí</FormLabel>
                        <FormDescription>
                          Bài học này sẽ {field.value ? "có thể truy cập miễn phí" : "chỉ dành cho người dùng Premium"}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mô tả</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Nhập mô tả chi tiết về bài học"
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <FormLabel>Nội dung (JSON)</FormLabel>
                <FormDescription>
                  Điền nội dung bài học dưới dạng JSON theo mẫu dựa trên loại bài học bạn đã chọn.
                </FormDescription>
                <Textarea
                  value={contentJson}
                  onChange={(e) => setContentJson(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                />
              </div>

              {(form.watch("type") === "listening" || form.watch("type") === "video") && (
                <FormField
                  control={form.control}
                  name="mediaUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {form.watch("type") === "listening" ? "URL audio" : "URL video"}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            form.watch("type") === "listening"
                              ? "Nhập URL file âm thanh (MP3, WAV,...)"
                              : "Nhập URL video (YouTube, Vimeo,...)"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Bạn có thể sử dụng các dịch vụ lưu trữ media như Google Drive, YouTube, SoundCloud,...
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Hủy
                </Button>
                <Button type="submit" disabled={createLessonMutation.isPending}>
                  {createLessonMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Tạo bài học
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}