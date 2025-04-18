import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { Loader2, ShieldCheck, Shield, ShieldAlert, Briefcase, UserCheck, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminUsers() {
  const { permissions } = useAuth();
  
  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Không thể tải danh sách người dùng");
      return res.json();
    },
    enabled: permissions?.permissions.canManageUsers || false,
  });
  
  const getRoleBadge = (role: string) => {
    let icon;
    let className;
    
    switch (role) {
      case 'admin':
        icon = <ShieldAlert className="h-4 w-4 mr-1" />;
        className = "bg-red-100 text-red-800 hover:bg-red-200";
        break;
      case 'manager':
        icon = <Shield className="h-4 w-4 mr-1" />;
        className = "bg-purple-100 text-purple-800 hover:bg-purple-200";
        break;
      case 'teacher':
        icon = <Briefcase className="h-4 w-4 mr-1" />;
        className = "bg-blue-100 text-blue-800 hover:bg-blue-200";
        break;
      case 'paid_user':
        icon = <ShieldCheck className="h-4 w-4 mr-1" />;
        className = "bg-green-100 text-green-800 hover:bg-green-200";
        break;
      default:
        icon = <UserIcon className="h-4 w-4 mr-1" />;
        className = "bg-gray-100 text-gray-800 hover:bg-gray-200";
    }
    
    return (
      <Badge variant="outline" className={cn("flex items-center py-1", className)}>
        {icon}
        {role.replace('_', ' ')}
      </Badge>
    );
  };
  
  if (!permissions?.permissions.canManageUsers) {
    return (
      <div className="container max-w-4xl mx-auto p-6">
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Quyền truy cập bị từ chối</CardTitle>
            <CardDescription>
              Bạn không có quyền truy cập vào trang quản lý người dùng.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  return (
    <div className="container max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader className="bg-gray-50/50">
          <CardTitle className="text-2xl">Quản lý người dùng</CardTitle>
          <CardDescription>
            Quản lý tài khoản và phân quyền người dùng trong hệ thống.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Danh sách người dùng</h3>
              <Button variant="outline" size="sm">Thêm người dùng</Button>
            </div>
            
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Tên người dùng
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vai trò
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Thành viên trả phí
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users && users.length > 0 ? (
                    users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap font-medium">
                          {user.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getRoleBadge(user.role)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {user.isPaid ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Có
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                              Không
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex space-x-2">
                            <Button variant="outline" size="sm">Sửa</Button>
                            <Button variant="destructive" size="sm">Xóa</Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                        Không có dữ liệu người dùng
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}