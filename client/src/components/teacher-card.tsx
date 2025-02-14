import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Teacher } from "@shared/schema";

interface TeacherCardProps {
  teacher: Teacher;
}

export function TeacherCard({ teacher }: TeacherCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center">
          <Avatar className="w-24 h-24 mx-auto mb-4">
            <AvatarImage src={teacher.imageUrl} alt={teacher.name} />
          </Avatar>
          <h3 className="font-semibold text-lg mb-1">{teacher.name}</h3>
          <p className="text-sm text-muted-foreground mb-4">{teacher.title}</p>
          <p className="text-sm">{teacher.bio}</p>
        </div>
      </CardContent>
    </Card>
  );
}
