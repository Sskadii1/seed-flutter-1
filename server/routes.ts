import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from 'ws';
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { requireRole, hasPermission, requirePaidUser } from "./permissions";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up authentication routes and middleware
  setupAuth(app);

  // Course routes
  app.get("/api/courses", async (_req, res) => {
    const courses = await storage.getCourses();
    res.json(courses);
  });

  app.get("/api/courses/search", async (req, res) => {
    const { q } = req.query;
    if (typeof q !== "string") {
      return res.status(400).json({ message: "Query parameter required" });
    }
    const courses = await storage.searchCourses(q);
    res.json(courses);
  });

  app.get("/api/courses/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const course = await storage.getCourse(id);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.json(course);
  });

  // Teacher routes
  app.get("/api/teachers", async (_req, res) => {
    const teachers = await storage.getTeachers();
    res.json(teachers);
  });

  app.get("/api/teachers/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const teacher = await storage.getTeacher(id);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }
    res.json(teacher);
  });

  // Practice exam routes
  app.get("/api/practice-exams", async (_req, res) => {
    const exams = await storage.getPracticeExams();
    res.json(exams);
  });

  app.get("/api/practice-exams/search", async (req, res) => {
    const { level } = req.query;
    if (typeof level !== "string") {
      return res.status(400).json({ message: "Level parameter required" });
    }
    const exams = await storage.searchPracticeExams(level);
    res.json(exams);
  });

  app.get("/api/practice-exams/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const exam = await storage.getPracticeExam(id);
    if (!exam) {
      return res.status(404).json({ message: "Practice exam not found" });
    }
    res.json(exam);
  });

  // Exercise routes
  app.get("/api/exercises", async (_req, res) => {
    const exercises = await storage.getExercises();
    res.json(exercises);
  });

  app.get("/api/exercises/search", async (req, res) => {
    const { type, level } = req.query;
    if (typeof type !== "string" || typeof level !== "string") {
      return res.status(400).json({ message: "Type and level parameters required" });
    }
    const exercises = await storage.searchExercises(type, level);
    res.json(exercises);
  });

  app.get("/api/exercises/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const exercise = await storage.getExercise(id);
    if (!exercise) {
      return res.status(404).json({ message: "Exercise not found" });
    }
    res.json(exercise);
  });

  // Study tips routes
  app.get("/api/study-tips", async (_req, res) => {
    const tips = await storage.getStudyTips();
    res.json(tips);
  });

  app.get("/api/study-tips/search", async (req, res) => {
    const { category } = req.query;
    if (typeof category !== "string") {
      return res.status(400).json({ message: "Category parameter required" });
    }
    const tips = await storage.searchStudyTips(category);
    res.json(tips);
  });

  app.get("/api/study-tips/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const tip = await storage.getStudyTip(id);
    if (!tip) {
      return res.status(404).json({ message: "Study tip not found" });
    }
    res.json(tip);
  });

  app.post("/api/study-tips", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const tip = await storage.createStudyTip({
      ...req.body,
      authorId: req.user.id,
    });
    res.status(201).json(tip);
  });

  app.post("/api/study-tips/:id/like", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    const tip = await storage.likeTip(id);
    res.json(tip);
  });

  app.post("/api/study-tips/:id/comment", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = parseInt(req.params.id);
    const { content } = req.body;
    const tip = await storage.addComment(id, req.user.id, content);
    res.json(tip);
  });

  app.delete("/api/study-tips/:id", requireRole('manager'), async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteStudyTip(id);
    res.status(204).send();
  });

  // Admin routes for managing courses
  app.post("/api/courses", requireRole('teacher'), async (req, res) => {
    const course = await storage.createCourse(req.body);
    res.status(201).json(course);
  });

  app.delete("/api/courses/:id", requireRole('admin'), async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteCourse(id);
    res.status(204).send();
  });

  // Support ticket routes
  app.post("/api/support-tickets", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const ticket = await storage.createSupportTicket({
      ...req.body,
      userId: req.user.id,
      status: 'open'
    });
    res.status(201).json(ticket);
  });

  app.get("/api/support-tickets", requireRole('manager'), async (req, res) => {
    const tickets = await storage.getSupportTickets();
    res.json(tickets);
  });


  // User progress routes
  app.get("/api/users/:userId/progress", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const progress = await storage.getUserProgress(userId);
    res.json(progress);
  });

  // Study session routes
  app.get("/api/users/:userId/study-sessions", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const sessions = await storage.getStudySessions(userId);
    res.json(sessions);
  });

  app.post("/api/users/:userId/study-sessions", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const { activityType, activityId } = req.body;
    if (typeof activityType !== "string" || typeof activityId !== "number") {
      return res.status(400).json({ message: "Activity type and ID required" });
    }
    const session = await storage.startStudySession(userId, activityType, activityId);
    res.json(session);
  });

  app.post("/api/study-sessions/:sessionId/end", async (req, res) => {
    const sessionId = parseInt(req.params.sessionId);
    await storage.endStudySession(sessionId);
    res.json({ message: "Study session ended" });
  });
  
  // Dictionary routes
  app.get("/api/dictionary", async (req, res) => {
    const { query, level, category } = req.query;
    const entries = await storage.getDictionaryEntries(
      typeof query === 'string' ? query : undefined,
      typeof level === 'string' ? level : undefined,
      typeof category === 'string' ? category : undefined
    );
    res.json(entries);
  });
  
  app.get("/api/dictionary/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const entry = await storage.getDictionaryEntry(id);
    if (!entry) {
      return res.status(404).json({ message: "Dictionary entry not found" });
    }
    res.json(entry);
  });
  
  app.post("/api/dictionary", requireRole('teacher'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const entry = await storage.createDictionaryEntry({
      ...req.body,
      addedBy: req.user.id
    });
    res.status(201).json(entry);
  });
  
  app.put("/api/dictionary/:id", requireRole('teacher'), async (req, res) => {
    const id = parseInt(req.params.id);
    const entry = await storage.updateDictionaryEntry(id, req.body);
    res.json(entry);
  });
  
  app.delete("/api/dictionary/:id", requireRole('admin'), async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteDictionaryEntry(id);
    res.status(204).send();
  });
  
  // User achievement routes
  app.get("/api/users/:userId/achievements", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const achievements = await storage.getUserAchievements(userId);
    res.json(achievements);
  });
  
  app.post("/api/users/:userId/check-achievements", async (req, res) => {
    const userId = parseInt(req.params.userId);
    const awardedAchievements = await storage.checkAndAwardAchievements(userId);
    res.json(awardedAchievements);
  });
  
  // Chat routes
  app.get("/api/chat/:userId", requireRole('user'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = parseInt(req.params.userId);
    const otherUserId = req.user.id;
    
    const messages = await storage.getChatMessages(otherUserId, userId);
    res.json(messages);
  });
  
  app.post("/api/chat/:userId", requireRole('user'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const receiverId = parseInt(req.params.userId);
    const senderId = req.user.id;
    
    const message = await storage.sendChatMessage({
      ...req.body,
      senderId,
      receiverId
    });
    res.status(201).json(message);
  });
  
  app.post("/api/chat/messages/:messageId/read", requireRole('user'), async (req, res) => {
    const messageId = parseInt(req.params.messageId);
    await storage.markMessageAsRead(messageId);
    res.status(204).send();
  });
  
  app.get("/api/chat/unread-count", requireRole('user'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const count = await storage.getUnreadMessageCount(req.user.id);
    res.json({ count });
  });
  
  // Lesson management routes - Dành cho giáo viên trở lên
  app.get("/api/lessons", async (req, res) => {
    const { type, level, isFreemium } = req.query;
    const lessons = await storage.searchLessons(
      typeof type === 'string' ? type : undefined,
      typeof level === 'string' ? level : undefined,
      isFreemium === 'true' ? true : (isFreemium === 'false' ? false : undefined)
    );
    res.json(lessons);
  });
  
  app.get("/api/lessons/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const lesson = await storage.getLesson(id);
    if (!lesson) {
      return res.status(404).json({ message: "Bài học không tồn tại" });
    }
    res.json(lesson);
  });
  
  app.post("/api/lessons", requireRole('teacher'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const lesson = await storage.createLesson({
      ...req.body,
      authorId: req.user.id,
    });
    res.status(201).json(lesson);
  });
  
  app.put("/api/lessons/:id", requireRole('teacher'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const id = parseInt(req.params.id);
    const lesson = await storage.getLesson(id);
    
    if (!lesson) {
      return res.status(404).json({ message: "Bài học không tồn tại" });
    }
    
    // Chỉ tác giả hoặc admin mới có thể chỉnh sửa
    if (lesson.authorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Bạn không có quyền chỉnh sửa bài học này" });
    }
    
    const updatedLesson = await storage.updateLesson(id, req.body);
    res.json(updatedLesson);
  });
  
  app.delete("/api/lessons/:id", requireRole('teacher'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const id = parseInt(req.params.id);
    const lesson = await storage.getLesson(id);
    
    if (!lesson) {
      return res.status(404).json({ message: "Bài học không tồn tại" });
    }
    
    // Chỉ tác giả hoặc admin mới có thể xóa
    if (lesson.authorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Bạn không có quyền xóa bài học này" });
    }
    
    await storage.deleteLesson(id);
    res.status(204).send();
  });
  
  // Route cho quản lý duyệt bài học (manager/admin)
  app.get("/api/lessons/pending", requireRole('manager'), async (req, res) => {
    const lessons = await storage.getPendingLessons();
    res.json(lessons);
  });
  
  app.post("/api/lessons/:id/approve", requireRole('manager'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const id = parseInt(req.params.id);
    const { reviewNote } = req.body;
    
    const updatedLesson = await storage.approveLesson(id, req.user.id, reviewNote);
    res.json(updatedLesson);
  });
  
  app.post("/api/lessons/:id/reject", requireRole('manager'), async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const id = parseInt(req.params.id);
    const { reviewNote } = req.body;
    
    if (!reviewNote) {
      return res.status(400).json({ message: "Vui lòng cung cấp lý do từ chối" });
    }
    
    const updatedLesson = await storage.rejectLesson(id, req.user.id, reviewNote);
    res.json(updatedLesson);
  });
  
  // Lấy danh sách bài học theo tác giả
  app.get("/api/users/:userId/lessons", requireRole('teacher'), async (req, res) => {
    const userId = parseInt(req.params.userId);
    const lessons = await storage.getLessonsByAuthor(userId);
    res.json(lessons);
  });
  
  // Admin route to get all users
  app.get("/api/admin/users", requireRole('admin'), async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Không thể lấy danh sách người dùng" });
    }
  });

  const httpServer = createServer(app);
  
  // Thiết lập WebSocket server cho chat học chung
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Lưu trữ các kết nối
  const connections = new Map();
  
  wss.on('connection', (ws, req) => {
    // Tạo ID cho kết nối
    const connectionId = Date.now();
    connections.set(connectionId, { ws, userId: null });
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Xử lý các loại tin nhắn
        if (data.type === 'auth') {
          // Xác thực và lưu userId
          connections.set(connectionId, { ws, userId: data.userId });
          
          // Gửi xác nhận kết nối
          ws.send(JSON.stringify({ 
            type: 'auth_success', 
            message: 'Kết nối thành công' 
          }));
        } 
        else if (data.type === 'chat') {
          // Lấy thông tin người dùng hiện tại
          const conn = connections.get(connectionId);
          
          if (!conn || !conn.userId) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              message: 'Bạn chưa xác thực' 
            }));
            return;
          }
          
          // Lưu tin nhắn vào storage (nếu cần)
          
          // Gửi tin nhắn tới tất cả người dùng đã xác thực
          connections.forEach((connection) => {
            if (connection.userId && connection.ws.readyState === WebSocket.OPEN) {
              connection.ws.send(JSON.stringify({
                type: 'chat',
                userId: conn.userId,
                message: data.message,
                timestamp: new Date()
              }));
            }
          });
        }
      } catch (error) {
        console.error('WebSocket error:', error);
      }
    });
    
    ws.on('close', () => {
      // Xóa kết nối khi đóng
      connections.delete(connectionId);
    });
  });
  
  return httpServer;
}