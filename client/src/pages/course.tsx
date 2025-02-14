import { useQuery } from "@tanstack/react-query";
import { Course, Teacher } from "@shared/schema";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { TeacherCard } from "@/components/teacher-card";
import { Badge } from "@/components/ui/badge";
import { i18n } from "@/lib/i18n";

export default function CoursePage() {
  const [, params] = useRoute("/courses/:id");
  const id = params?.id;

  const { data: course, isLoading: courseLoading } = useQuery<Course>({
    queryKey: [`/api/courses/${id}`],
    enabled: !!id
  });

  const { data: teacher, isLoading: teacherLoading } = useQuery<Teacher>({
    queryKey: [`/api/teachers/${course?.teacherId}`],
    enabled: !!course
  });

  if (courseLoading || teacherLoading) {
    return (
      <div className="container mx-auto px-4 py-8 animate-pulse">
        <div className="h-96 bg-muted rounded-lg mb-8" />
        <div className="h-8 bg-muted rounded w-1/3 mb-4" />
        <div className="h-4 bg-muted rounded w-2/3" />
      </div>
    );
  }

  if (!course || !teacher) {
    return <div>Course not found</div>;
  }

  return (
    <div className="min-h-screen">
      <div className="bg-primary/5 py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row gap-8">
            <div className="md:w-2/3">
              <img
                src={course.imageUrl}
                alt={course.title}
                className="w-full h-[400px] object-cover rounded-lg"
              />
            </div>
            <div className="md:w-1/3">
              <h1 className="text-3xl font-bold mb-4">{course.title}</h1>
              <Badge className="mb-4">
                {i18n.common.level[course.level as keyof typeof i18n.common.level]}
              </Badge>
              <p className="text-lg mb-6">{course.description}</p>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">
                    {i18n.common.duration}
                  </div>
                  <div className="font-medium">
                    {course.duration} {i18n.common.hours}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">
                    {i18n.common.price}
                  </div>
                  <div className="font-medium">
                    {new Intl.NumberFormat("vi-VN", {
                      style: "currency",
                      currency: "VND"
                    }).format(course.price)}
                  </div>
                </div>
              </div>
              <Button className="w-full">Đăng ký ngay</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-6">{i18n.common.teachers}</h2>
        <div className="max-w-sm">
          <TeacherCard teacher={teacher} />
        </div>
      </div>
    </div>
  );
}
