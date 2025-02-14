import { useQuery } from "@tanstack/react-query";
import { Course } from "@shared/schema";
import { CourseCard } from "@/components/course-card";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { i18n } from "@/lib/i18n";

export default function Courses() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses/search", debouncedSearch],
    queryFn: () => 
      fetch(`/api/courses/search?q=${encodeURIComponent(debouncedSearch)}`)
        .then(res => res.json())
  });

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-xl mx-auto mb-8">
        <Input
          placeholder={i18n.common.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-[400px] bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {courses?.map(course => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
