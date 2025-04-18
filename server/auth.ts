import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { requireRole, UserRole, hasPermission, requirePaidUser } from "./permissions";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "seed-topik-session-secret-9821hn298h92", // Sử dụng biến môi trường hoặc khóa mặc định an toàn hơn
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      const user = await storage.getUserByUsername(username);
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    const user = await storage.getUser(id);
    done(null, user);
  });

  app.post("/api/register", async (req, res, next) => {
    const existingUser = await storage.getUserByUsername(req.body.username);
    if (existingUser) {
      return res.status(400).json({ message: "Tên đăng nhập đã tồn tại" });
    }

    // Set appropriate role based on registration
    let role: UserRole = 'user';
    
    // Special roles based on predefined credentials
    if (req.body.email === "admin@seed-topik.com" && req.body.username === "admin") {
      role = 'admin';
    } else if (req.body.email === "teacher@seed-topik.com" && req.body.username.startsWith("teacher")) {
      role = 'teacher';
    } else if (req.body.email === "manager@seed-topik.com" && req.body.username.startsWith("manager")) {
      role = 'manager';
    }
    
    const user = await storage.createUser({
      ...req.body,
      role,
      isPaid: false,
      password: await hashPassword(req.body.password),
    });

    req.login(user, (err) => {
      if (err) return next(err);
      res.status(201).json(user);
    });
  });

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.status(200).json(req.user);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });
  
  // User role management routes (admin only)
  app.post("/api/users/:id/role", requireRole('admin'), async (req, res) => {
    const { role } = req.body;
    if (!role || !['user', 'paid_user', 'teacher', 'manager', 'admin'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    
    const userId = parseInt(req.params.id);
    try {
      const updatedUser = await storage.setUserRole(userId, role);
      res.json(updatedUser);
    } catch (error) {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  // Subscription management
  app.post("/api/users/:id/subscription", requireRole('admin'), async (req, res) => {
    const userId = parseInt(req.params.id);
    const { durationDays } = req.body;
    
    if (!durationDays || typeof durationDays !== 'number' || durationDays <= 0) {
      return res.status(400).json({ message: "Valid duration in days is required" });
    }
    
    try {
      const updatedUser = await storage.activateSubscription(userId, durationDays);
      res.json(updatedUser);
    } catch (error) {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  // Subscription cancellation
  app.delete("/api/users/:id/subscription", requireRole('admin'), async (req, res) => {
    const userId = parseInt(req.params.id);
    try {
      const updatedUser = await storage.deactivateSubscription(userId);
      res.json(updatedUser);
    } catch (error) {
      res.status(404).json({ message: "User not found" });
    }
  });
  
  // Get authenticated user's permissions
  app.get("/api/user/permissions", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.json({
        role: 'guest',
        isPaid: false,
        permissions: {
          canAccessFreeContent: true,
          canAccessPaidContent: false,
          canTakePracticeExams: false,
          canCreateThread: false,
          canModerateThreads: false,
          canDeleteContent: false,
          canAddToDictionary: false,
          canCreateCourse: false,
          canManageUsers: false,
          canApprovePayments: false
        }
      });
    }
    
    const userRole = req.user.role as UserRole;
    
    res.json({
      role: userRole,
      isPaid: req.user.isPaid,
      permissions: {
        canAccessFreeContent: true,
        canAccessPaidContent: req.user.isPaid || hasPermission(userRole, 'teacher'),
        canTakePracticeExams: req.user.isPaid || hasPermission(userRole, 'teacher'),
        canCreateThread: hasPermission(userRole, 'user'),
        canModerateThreads: hasPermission(userRole, 'teacher'),
        canDeleteContent: hasPermission(userRole, 'manager'),
        canAddToDictionary: hasPermission(userRole, 'teacher'),
        canCreateCourse: hasPermission(userRole, 'teacher'),
        canManageUsers: hasPermission(userRole, 'admin'),
        canApprovePayments: hasPermission(userRole, 'admin')
      }
    });
  });
}
