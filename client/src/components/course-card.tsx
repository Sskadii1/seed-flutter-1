import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Course } from "@shared/schema";
import { i18n } from "@/lib/i18n";
import { Link } from "wouter";

interface CourseCardProps {
  course: Course;
}

export function CourseCard({ course }: CourseCardProps) {
  return (
    <Link href={`/courses/${course.id}`}>
      <a className="block">
        <Card className="overflow-hidden hover:shadow-lg transition-shadow">
          <img
            src={course.imageUrl}
            alt={course.title}
            className="w-full h-48 object-cover"
          />
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <h3 className="font-semibold text-lg">{course.title}</h3>
              <Badge variant="secondary">
                {i18n.common.level[course.level as keyof typeof i18n.common.level]}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
              {course.description}
            </p>
            <div className="flex justify-between text-sm">
              <span>{course.duration} {i18n.common.hours}</span>
              <span className="font-medium">
                {new Intl.NumberFormat("vi-VN", {
                  style: "currency",
                  currency: "VND"
                }).format(course.price)}
              </span>
            </div>
          </CardContent>
        </Card>
      </a>
    </Link>
  );
}
