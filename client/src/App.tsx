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

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={Auth} />
      <Route path="/introduction" component={Introduction} />
      <Route path="/self-study" component={SelfStudy} />
      <Route path="/study-together" component={StudyTogether} />
      <Route path="/exam-prep" component={ExamPrep} />
      <Route path="/experience" component={Experience} />
      <ProtectedRoute path="/profile" component={Profile} />
      <ProtectedRoute path="/" component={Home} />
      <ProtectedRoute path="/courses" component={Courses} />
      <ProtectedRoute path="/courses/:id" component={Course} />
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