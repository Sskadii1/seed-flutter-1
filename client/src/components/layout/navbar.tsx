import { Link } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { i18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  const NavLink = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <Link href={href}>
      <span className={cn("cursor-pointer", className)}>
        {children}
      </span>
    </Link>
  );

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
          <NavLink href="/introduction" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.introduction}
          </NavLink>
          <NavLink href="/self-study" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.selfStudy}
          </NavLink>
          <NavLink href="/study-together" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.studyTogether}
          </NavLink>
          <NavLink href="/exam-prep" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.examPrep}
          </NavLink>
          <NavLink href="/experience" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
            {i18n.common.menu.experience}
          </NavLink>
          {user && (
            <NavLink href="/profile" className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.profile}
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}