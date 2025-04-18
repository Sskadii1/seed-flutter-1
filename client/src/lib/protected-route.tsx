import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

type UserRole = 'guest' | 'user' | 'paid_user' | 'teacher' | 'manager' | 'admin';

interface ProtectedRouteProps {
  path: string;
  component: () => React.JSX.Element;
  requireRole?: UserRole;
  requirePaid?: boolean;
}

export function ProtectedRoute({
  path,
  component: Component,
  requireRole = 'user',
  requirePaid = false,
}: ProtectedRouteProps) {
  const { user, isLoading, permissions, permissionsLoading } = useAuth();

  if (isLoading || permissionsLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  // Nếu chưa đăng nhập, chuyển đến trang đăng nhập
  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }
  
  // Kiểm tra quyền truy cập dựa trên role
  if (permissions && permissions.role) {
    const roleHierarchy = {
      'guest': 0,
      'user': 1,
      'paid_user': 2,
      'teacher': 3,
      'manager': 4,
      'admin': 5
    };
    
    // Kiểm tra nếu role hiện tại không đủ
    if (roleHierarchy[permissions.role] < roleHierarchy[requireRole]) {
      return (
        <Route path={path}>
          <div className="container max-w-3xl mx-auto p-6">
            <Alert variant="destructive" className="my-8">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Không có quyền truy cập</AlertTitle>
              <AlertDescription>
                Bạn cần có quyền {requireRole} để truy cập trang này.
              </AlertDescription>
            </Alert>
          </div>
        </Route>
      );
    }
    
    // Kiểm tra nếu cần subscription nhưng chưa có
    if (requirePaid && !permissions.isPaid) {
      return (
        <Route path={path}>
          <div className="container max-w-3xl mx-auto p-6">
            <Alert variant="destructive" className="my-8">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cần nâng cấp tài khoản</AlertTitle>
              <AlertDescription>
                Tính năng này yêu cầu tài khoản trả phí. Vui lòng nâng cấp tài khoản của bạn để tiếp tục.
              </AlertDescription>
            </Alert>
          </div>
        </Route>
      );
    }
  }

  return <Route path={path} component={Component} />;
}
