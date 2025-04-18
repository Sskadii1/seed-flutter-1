import { NextFunction, Request, Response } from "express";

// Define user roles in order from least to most permissions
export type UserRole = 'guest' | 'user' | 'paid_user' | 'teacher' | 'manager' | 'admin';

// Define role hierarchy for permission checks
const roleHierarchy: Record<UserRole, number> = {
  'guest': 0,
  'user': 1,
  'paid_user': 2,
  'teacher': 3,
  'manager': 4,
  'admin': 5
};

// Check if a role has necessary permissions based on hierarchy
export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// Middleware to check if user has required role
export function requireRole(requiredRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Bạn cần đăng nhập để thực hiện thao tác này" });
    }

    const userRole = req.user.role as UserRole;
    
    if (!hasPermission(userRole, requiredRole)) {
      return res.status(403).json({ 
        message: "Bạn không có quyền thực hiện thao tác này",
        requiredRole: requiredRole
      });
    }

    next();
  };
}

// Special middleware for paid content
export function requirePaidUser() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Bạn cần đăng nhập để thực hiện thao tác này" });
    }

    const userRole = req.user.role as UserRole;
    const isPaid = req.user.isPaid;
    
    // Paid users, teachers, managers, and admins have access
    if (isPaid || hasPermission(userRole, 'teacher')) {
      return next();
    }

    return res.status(403).json({ 
      message: "Bạn cần nâng cấp tài khoản để truy cập nội dung này",
      requiredSubscription: true
    });
  };
}

// Check if subscription is active
export function hasActiveSubscription(user: Express.User): boolean {
  if (!user.isPaid) return false;
  
  const subscriptionExpiry = user.subscriptionExpiryDate;
  if (!subscriptionExpiry) return false;
  
  return new Date(subscriptionExpiry) > new Date();
}

// Feature-specific permission checks for business logic
export const permissions = {
  // Learning features
  canAccessFreeContent: (user: Express.User) => true,
  canAccessPaidContent: (user: Express.User) => user.isPaid || hasPermission(user.role as UserRole, 'teacher'),
  canTakePracticeExams: (user: Express.User) => user.isPaid || hasPermission(user.role as UserRole, 'teacher'),
  
  // Social features
  canCreateThread: (user: Express.User) => hasPermission(user.role as UserRole, 'user'),
  canModerateThreads: (user: Express.User) => hasPermission(user.role as UserRole, 'teacher'),
  canDeleteContent: (user: Express.User) => hasPermission(user.role as UserRole, 'manager'),
  
  // Dictionary features
  canAddToDictionary: (user: Express.User) => hasPermission(user.role as UserRole, 'teacher'),
  
  // Content management
  canCreateCourse: (user: Express.User) => hasPermission(user.role as UserRole, 'teacher'),
  canManageUsers: (user: Express.User) => hasPermission(user.role as UserRole, 'admin'),
  canApprovePayments: (user: Express.User) => hasPermission(user.role as UserRole, 'admin'),
  
  // User tracking 
  canViewUserProgress: (user: Express.User, targetUserId: number) => {
    // Users can view their own progress
    if (user.id === targetUserId) return true;
    // Teachers, managers, and admins can view any user's progress
    return hasPermission(user.role as UserRole, 'teacher');
  }
};