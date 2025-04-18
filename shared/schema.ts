import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  level: text("level").notNull(), // beginner, intermediate, advanced
  duration: integer("duration").notNull(), // in hours
  price: integer("price").notNull(), // in VND
  teacherId: integer("teacher_id").notNull(),
  sections: jsonb("sections").notNull().default([]), // Array of course sections
  isFeatured: boolean("is_featured").notNull().default(false),
  videoUrl: text("video_url"), // Optional preview video
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(),
  bio: text("bio").notNull(),
  socialLinks: jsonb("social_links").notNull().default({}),
  rating: integer("rating").notNull().default(5),
  totalStudents: integer("total_students").notNull().default(0),
});

// Update users table to include auth fields and role-based access
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  // Role-based access control: "guest", "user", "paid_user", "teacher", "manager", "admin"
  role: text("role").notNull().default("user"),
  isPaid: boolean("is_paid").notNull().default(false), // Whether the user has a paid subscription
  enrolledCourses: jsonb("enrolled_courses").notNull().default([]),
  learningStreak: integer("learning_streak").notNull().default(0),
  totalStudyTime: integer("total_study_time").notNull().default(0), // in minutes
  createdAt: timestamp("created_at").notNull().defaultNow(),
  subscriptionExpiryDate: timestamp("subscription_expiry_date"), // When the paid subscription expires
});

export const practiceExams = pgTable("practice_exams", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  level: text("level").notNull(), // TOPIK I, TOPIK II
  type: text("type").notNull(), // reading, listening, writing
  timeLimit: integer("time_limit").notNull(), // in minutes
  questions: jsonb("questions").notNull(), // Array of questions
  totalPoints: integer("total_points").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const exercises = pgTable("exercises", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // grammar, vocabulary
  level: text("level").notNull(),
  content: jsonb("content").notNull(), // Exercise content and answers
  points: integer("points").notNull().default(10),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Update the studyTips table definition to include more social features
export const studyTips = pgTable("study_tips", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: integer("author_id").notNull(), // References users
  likes: integer("likes").notNull().default(0),
  category: text("category").notNull(), // general, grammar, vocabulary, etc.
  imageUrl: text("image_url"), // Optional image for the post
  comments: jsonb("comments").$type<{
    id: number;
    userId: number;
    userName: string;
    content: string;
    createdAt: Date;
  }[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userProgress = pgTable("user_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  examId: integer("exam_id"), // Optional, for exam progress
  exerciseId: integer("exercise_id"), // Optional, for exercise progress
  score: integer("score").notNull(),
  timeSpent: integer("time_spent").notNull(), // in minutes
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

export const studySessions = pgTable("study_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // in minutes
  activityType: text("activity_type").notNull(), // exam, exercise, course
  activityId: integer("activity_id").notNull(), // References the specific activity
});

// Create insert schema for users
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  learningStreak: true,
  totalStudyTime: true,
}).extend({
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
  email: z.string().email("Email không hợp lệ"),
  username: z.string().min(3, "Tên đăng nhập phải có ít nhất 3 ký tự"),
});

export const insertCourseSchema = createInsertSchema(courses).omit({
  id: true,
  updatedAt: true,
});

export const insertTeacherSchema = createInsertSchema(teachers).omit({
  id: true,
  totalStudents: true,
});

export const insertPracticeExamSchema = createInsertSchema(practiceExams).omit({
  id: true,
  createdAt: true,
});

export const insertExerciseSchema = createInsertSchema(exercises).omit({
  id: true,
  createdAt: true,
});

// Update insertStudyTipSchema to include new fields
export const insertStudyTipSchema = createInsertSchema(studyTips).omit({
  id: true,
  createdAt: true,
  likes: true,
});

export const insertUserProgressSchema = createInsertSchema(userProgress).omit({
  id: true,
  completedAt: true,
});

export const insertStudySessionSchema = createInsertSchema(studySessions).omit({
  id: true,
  endTime: true,
  duration: true,
});

export type Course = typeof courses.$inferSelect;
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Teacher = typeof teachers.$inferSelect;
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type PracticeExam = typeof practiceExams.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type StudyTip = typeof studyTips.$inferSelect;
export type UserProgress = typeof userProgress.$inferSelect;
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull(), // open, in-progress, resolved
  adminResponse: text("admin_response"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Add chat messages table
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  receiverId: integer("receiver_id").notNull(),
  content: text("content").notNull(),
  attachmentUrl: text("attachment_url"), // For images, files, etc.
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Add dictionary table for vocabulary
export const dictionary = pgTable("dictionary", {
  id: serial("id").primaryKey(),
  korean: text("korean").notNull(),
  vietnamese: text("vietnamese").notNull(),
  english: text("english"),
  pronunciation: text("pronunciation"),
  level: text("level").notNull(), // beginner, intermediate, advanced
  exampleSentence: text("example_sentence"),
  category: text("category").notNull(), // grammar, vocabulary, etc.
  addedBy: integer("added_by").notNull(), // References user id who added the word
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Add user achievements and badges
export const userAchievements = pgTable("user_achievements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  achievementType: text("achievement_type").notNull(), // daily_streak, completion, etc.
  achievementValue: integer("achievement_value").notNull(), // e.g., 7 for 7-day streak
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
});

// Insert schemas for new tables
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
  isRead: true,
});

export const insertDictionarySchema = createInsertSchema(dictionary).omit({
  id: true,
  createdAt: true,
});

export const insertUserAchievementSchema = createInsertSchema(userAchievements).omit({
  id: true,
  earnedAt: true,
});

export type StudySession = typeof studySessions.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type Dictionary = typeof dictionary.$inferSelect;
export type InsertDictionary = z.infer<typeof insertDictionarySchema>;
export type UserAchievement = typeof userAchievements.$inferSelect;
export type InsertUserAchievement = z.infer<typeof insertUserAchievementSchema>;