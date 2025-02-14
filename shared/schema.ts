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
  socialLinks: jsonb("social_links").notNull().default({}), // Social media links
  rating: integer("rating").notNull().default(5),
  totalStudents: integer("total_students").notNull().default(0),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  enrolledCourses: jsonb("enrolled_courses").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCourseSchema = createInsertSchema(courses).omit({ 
  id: true,
  updatedAt: true
});
export const insertTeacherSchema = createInsertSchema(teachers).omit({ 
  id: true,
  totalStudents: true
});
export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true,
  createdAt: true
});

export type Course = typeof courses.$inferSelect;
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Teacher = typeof teachers.$inferSelect;
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;