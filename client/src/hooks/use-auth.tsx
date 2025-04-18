import { createContext, ReactNode, useContext } from "react";
import {
  useQuery,
  useMutation,
} from "@tanstack/react-query";
import { InsertUser, User } from "@shared/schema";
import { apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type LoginData = {
  username: string;
  password: string;
};

type UserRole = 'guest' | 'user' | 'paid_user' | 'teacher' | 'manager' | 'admin';

type UserPermissions = {
  canAccessFreeContent: boolean;
  canAccessPaidContent: boolean;
  canTakePracticeExams: boolean;
  canCreateThread: boolean;
  canModerateThreads: boolean;
  canDeleteContent: boolean;
  canAddToDictionary: boolean;
  canCreateCourse: boolean;
  canManageUsers: boolean;
  canApprovePayments: boolean;
};

type PermissionsData = {
  role: UserRole;
  isPaid: boolean;
  permissions: UserPermissions;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: ReturnType<typeof useLoginMutation>;
  logoutMutation: ReturnType<typeof useLogoutMutation>;
  registerMutation: ReturnType<typeof useRegisterMutation>;
  permissions: PermissionsData | null;
  permissionsLoading: boolean;
};

function useLoginMutation() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (user: User) => {
      queryClient.setQueryData(["/api/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/user/permissions"] });
      toast({
        title: "Đăng nhập thành công",
        description: `Chào mừng ${user.name}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Đăng nhập thất bại",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

function useRegisterMutation() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertUser) => {
      const res = await apiRequest("POST", "/api/register", data);
      return await res.json();
    },
    onSuccess: (user: User) => {
      queryClient.setQueryData(["/api/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/user/permissions"] });
      toast({
        title: "Đăng ký thành công",
        description: `Chào mừng ${user.name}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Đăng ký thất bại",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

function useLogoutMutation() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/user"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/user/permissions"] });
      toast({
        title: "Đăng xuất thành công",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Đăng xuất thất bại",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<User | null>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/user");
        if (res.status === 401) return null;
        return res.json();
      } catch (error) {
        return null;
      }
    },
  });
  
  const {
    data: permissionsData,
    isLoading: permissionsLoading,
  } = useQuery<PermissionsData>({
    queryKey: ["/api/user/permissions"],
    queryFn: async () => {
      const res = await fetch("/api/user/permissions");
      return res.json();
    },
  });

  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();
  const logoutMutation = useLogoutMutation();

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error: error ?? null,
        loginMutation,
        logoutMutation,
        registerMutation,
        permissions: permissionsData ?? null,
        permissionsLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
