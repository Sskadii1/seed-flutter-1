import { Link } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { i18n } from "@/lib/i18n";

export function Navbar() {
  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/">
            <a className="font-bold text-xl text-primary">TOPIK Online</a>
          </Link>
          <div className="hidden md:flex items-center gap-6">
            <Link href="/courses">
              <a className="text-sm font-medium">{i18n.common.courses}</a>
            </Link>
            <Link href="/teachers">
              <a className="text-sm font-medium">{i18n.common.teachers}</a>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative w-64 hidden md:block">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={i18n.common.search}
              className="pl-8"
            />
          </div>
          <Button variant="outline">Đăng nhập</Button>
        </div>
      </div>
    </nav>
  );
}
