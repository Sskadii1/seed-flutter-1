import { Link } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { i18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { user, logoutMutation, permissions } = useAuth();

  const NavLink = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <Link href={href}>
      <span className={cn("cursor-pointer", className)}>
        {children}
      </span>
    </Link>
  );

  const userRole = permissions?.role || 'guest';
  const isPaid = permissions?.isPaid || false;

  // Simplified permission checks
  const isTeacherOrAbove = userRole === 'teacher' || userRole === 'manager' || userRole === 'admin';
  const isManagerOrAbove = userRole === 'manager' || userRole === 'admin';
  const isAdmin = userRole === 'admin';
  const canAccessPaidContent = isPaid || isTeacherOrAbove;

  return (
    <nav className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <NavLink href="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="SEED-TOPIK Logo" className="h-8 w-auto" />
            <span className="font-bold text-xl text-primary">SEED-TOPIK</span>
          </NavLink>

          <div className="flex items-center gap-4">
            <div className="relative w-64 hidden md:block">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={i18n.common.search}
                className="pl-8"
              />
            </div>
            
            {/* Hiển thị thẻ vai trò nếu đã đăng nhập */}
            {user && userRole !== 'guest' && (
              <span className={cn(
                "px-2 py-1 text-xs rounded font-semibold",
                {
                  "bg-gray-200 text-gray-800": userRole === 'user',
                  "bg-green-200 text-green-800": userRole === 'paid_user',
                  "bg-blue-200 text-blue-800": userRole === 'teacher',
                  "bg-purple-200 text-purple-800": userRole === 'manager',
                  "bg-red-200 text-red-800": userRole === 'admin',
                }
              )}>
                {userRole.replace('_', ' ')}
              </span>
            )}
            
            {user ? (
              <Button 
                variant="outline" 
                className="font-medium"
                onClick={() => logoutMutation.mutate()}
              >
                Đăng xuất
              </Button>
            ) : (
              <Link href="/auth">
                <Button variant="outline" className="font-medium">
                  {i18n.common.login}
                </Button>
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-8 py-2 overflow-x-auto">
          {/* Các liên kết có thể truy cập cho tất cả người dùng */}
          <NavLink href="/introduction" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.introduction}
          </NavLink>
          <NavLink href="/self-study" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.selfStudy}
          </NavLink>
          <NavLink href="/experience" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.experience}
          </NavLink>
          
          {/* Các liên kết yêu cầu đăng nhập */}
          {user && (
            <>
              <NavLink href="/study-together" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
                {i18n.common.menu.studyTogether}
              </NavLink>
              <NavLink href="/profile" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
                {i18n.common.menu.profile}
              </NavLink>
            </>
          )}
          
          {/* Liên kết exam-prep chỉ cho người dùng trả phí */}
          {canAccessPaidContent && (
            <NavLink 
              href="/exam-prep" 
              className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap"
            >
              {i18n.common.menu.examPrep}
            </NavLink>
          )}
          
          {/* Liên kết dành cho admin quản lý người dùng */}
          {isAdmin && (
            <NavLink 
              href="/admin/users" 
              className="text-sm font-medium text-red-600 hover:text-red-500 transition-colors whitespace-nowrap"
            >
              Quản lý người dùng
            </NavLink>
          )}
          
          {/* Liên kết dành cho teacher tạo khoá học */}
          {isTeacherOrAbove && (
            <>
              <NavLink 
                href="/teacher/courses" 
                className="text-sm font-medium text-blue-600 hover:text-blue-500 transition-colors whitespace-nowrap"
              >
                Quản lý khoá học
              </NavLink>
              <NavLink 
                href="/lessons/manage" 
                className="text-sm font-medium text-blue-600 hover:text-blue-500 transition-colors whitespace-nowrap"
              >
                Quản lý bài học
              </NavLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}