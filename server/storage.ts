import { Course, Teacher, InsertCourse, InsertTeacher } from "@shared/schema";

export interface IStorage {
  // Courses
  getCourses(): Promise<Course[]>;
  getCourse(id: number): Promise<Course | undefined>;
  searchCourses(query: string): Promise<Course[]>;
  createCourse(course: InsertCourse): Promise<Course>;
  
  // Teachers
  getTeachers(): Promise<Teacher[]>;
  getTeacher(id: number): Promise<Teacher | undefined>;
  createTeacher(teacher: InsertTeacher): Promise<Teacher>;
}

export class MemStorage implements IStorage {
  private courses: Map<number, Course>;
  private teachers: Map<number, Teacher>;
  private courseId: number = 1;
  private teacherId: number = 1;

  constructor() {
    this.courses = new Map();
    this.teachers = new Map();
    this.initializeData();
  }

  private initializeData() {
    // Create mock teachers
    const teachers: InsertTeacher[] = [
      {
        name: "Nguyễn Văn A",
        title: "Giảng viên TOPIK",
        imageUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7",
        bio: "Giảng viên với 10 năm kinh nghiệm giảng dạy tiếng Hàn",
      },
      {
        name: "Trần Thị B",
        title: "Chuyên gia ngôn ngữ",
        imageUrl: "https://images.unsplash.com/photo-1577896851231-70ef18881754",
        bio: "Tốt nghiệp Đại học Seoul, 5 năm kinh nghiệm luyện thi TOPIK",
      },
    ];

    teachers.forEach(teacher => this.createTeacher(teacher));

    // Create mock courses
    const courses: InsertCourse[] = [
      {
        title: "TOPIK I - Sơ cấp",
        description: "Khóa học dành cho người mới bắt đầu",
        imageUrl: "https://images.unsplash.com/photo-1472289065668-ce650ac443d2",
        level: "beginner",
        duration: 30,
        price: 1500000,
        teacherId: 1,
      },
      {
        title: "TOPIK II - Trung cấp",
        description: "Luyện thi chuyên sâu TOPIK cấp độ 3-4",
        imageUrl: "https://images.unsplash.com/photo-1493723843671-1d655e66ac1c",
        level: "intermediate", 
        duration: 45,
        price: 2500000,
        teacherId: 2,
      },
    ];

    courses.forEach(course => this.createCourse(course));
  }

  async getCourses(): Promise<Course[]> {
    return Array.from(this.courses.values());
  }

  async getCourse(id: number): Promise<Course | undefined> {
    return this.courses.get(id);
  }

  async searchCourses(query: string): Promise<Course[]> {
    const courses = Array.from(this.courses.values());
    return courses.filter(course => 
      course.title.toLowerCase().includes(query.toLowerCase()) ||
      course.description.toLowerCase().includes(query.toLowerCase())
    );
  }

  async createCourse(course: InsertCourse): Promise<Course> {
    const id = this.courseId++;
    const newCourse = { ...course, id };
    this.courses.set(id, newCourse);
    return newCourse;
  }

  async getTeachers(): Promise<Teacher[]> {
    return Array.from(this.teachers.values());
  }

  async getTeacher(id: number): Promise<Teacher | undefined> {
    return this.teachers.get(id);
  }

  async createTeacher(teacher: InsertTeacher): Promise<Teacher> {
    const id = this.teacherId++;
    const newTeacher = { ...teacher, id };
    this.teachers.set(id, newTeacher);
    return newTeacher;
  }
}

export const storage = new MemStorage();
