import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { Navbar } from "@/components/layout/navbar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Courses from "@/pages/courses";
import Course from "@/pages/course";
import Auth from "@/pages/auth";
import Introduction from "@/pages/introduction";
import SelfStudy from "@/pages/self-study";
import StudyTogether from "@/pages/study-together";
import ExamPrep from "@/pages/exam-prep";
import Experience from "@/pages/experience";
import Profile from "@/pages/profile";
import AdminUsers from "@/pages/admin-users";

function Router() {
  // Hàm tạo component mà chỉ trả về JSX Element
  const createComponent = (Component: React.ComponentType<any>) => {
    return () => <Component />;
  };
  
  return (
    <Switch>
      {/* Trang không cần đăng nhập */}
      <Route path="/auth" component={Auth} />
      <Route path="/introduction" component={Introduction} />
      
      {/* Trang xem được với role dưới mức user */}
      <Route path="/self-study" component={SelfStudy} />
      <Route path="/experience" component={Experience} />
      
      {/* Trang cơ bản cần đăng nhập */}
      <ProtectedRoute path="/profile" component={createComponent(Profile)} requireRole="user" />
      <ProtectedRoute path="/" component={createComponent(Home)} requireRole="user" />
      <ProtectedRoute path="/courses" component={createComponent(Courses)} requireRole="user" />
      <ProtectedRoute path="/courses/:id" component={createComponent(Course)} requireRole="user" />
      
      {/* Trang học chung cần role user hoặc cao hơn */}
      <ProtectedRoute path="/study-together" component={createComponent(StudyTogether)} requireRole="user" />
      
      {/* Trang luyện thi TOPIK - chỉ cho paid user và cao hơn */}
      <ProtectedRoute 
        path="/exam-prep" 
        component={createComponent(ExamPrep)} 
        requireRole="paid_user" 
        requirePaid={true} 
      />
      
      {/* Trang quản lý người dùng - chỉ dành cho admin */}
      <ProtectedRoute
        path="/admin/users"
        component={createComponent(AdminUsers)}
        requireRole="admin"
      />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Navbar />
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;