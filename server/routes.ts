import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
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

  const httpServer = createServer(app);
  return httpServer;
}