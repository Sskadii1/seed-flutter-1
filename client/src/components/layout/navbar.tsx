import { Link } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { i18n } from "@/lib/i18n";

export function Navbar() {
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/">
            <a className="font-bold text-xl text-primary">TOPIK Online</a>
          </Link>

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
          <Link href="/introduction">
            <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.introduction}
            </a>
          </Link>
          <Link href="/self-study">
            <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.selfStudy}
            </a>
          </Link>
          <Link href="/study-together">
            <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.studyTogether}
            </a>
          </Link>
          <Link href="/exam-prep">
            <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.examPrep}
            </a>
          </Link>
          <Link href="/experience">
            <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
              {i18n.common.menu.experience}
            </a>
          </Link>
          {user && (
            <Link href="/profile">
              <a className="text-sm font-medium hover:text-primary transition-colors whitespace-nowrap">
                {i18n.common.menu.profile}
              </a>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}