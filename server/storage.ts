import { Course, Teacher, InsertCourse, InsertTeacher, PracticeExam, Exercise, StudyTip, UserProgress, StudySession } from "@shared/schema";

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

  // Practice Exams
  getPracticeExams(): Promise<PracticeExam[]>;
  getPracticeExam(id: number): Promise<PracticeExam | undefined>;
  searchPracticeExams(level: string): Promise<PracticeExam[]>;

  // Exercises
  getExercises(): Promise<Exercise[]>;
  getExercise(id: number): Promise<Exercise | undefined>;
  searchExercises(type: string, level: string): Promise<Exercise[]>;

  // Study Tips
  getStudyTips(): Promise<StudyTip[]>;
  getStudyTip(id: number): Promise<StudyTip | undefined>;
  searchStudyTips(category: string): Promise<StudyTip[]>;

  // User Progress
  getUserProgress(userId: number): Promise<UserProgress[]>;
  saveUserProgress(progress: UserProgress): Promise<void>;

  // Study Sessions
  getStudySessions(userId: number): Promise<StudySession[]>;
  startStudySession(userId: number, activityType: string, activityId: number): Promise<StudySession>;
  endStudySession(sessionId: number): Promise<void>;
}

export class MemStorage implements IStorage {
  private courses: Map<number, Course>;
  private teachers: Map<number, Teacher>;
  private practiceExams: Map<number, PracticeExam>;
  private exercises: Map<number, Exercise>;
  private studyTips: Map<number, StudyTip>;
  private userProgress: Map<number, UserProgress[]>;
  private studySessions: Map<number, StudySession>;

  private courseId: number = 1;
  private teacherId: number = 1;
  private examId: number = 1;
  private exerciseId: number = 1;
  private tipId: number = 1;
  private sessionId: number = 1;

  constructor() {
    this.courses = new Map();
    this.teachers = new Map();
    this.practiceExams = new Map();
    this.exercises = new Map();
    this.studyTips = new Map();
    this.userProgress = new Map();
    this.studySessions = new Map();
    this.initializeData();
  }

  private initializeData() {
    // Create mock teachers
    const teachers = [
      {
        name: "Nguyễn Văn A",
        title: "Giảng viên TOPIK",
        imageUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7",
        bio: "Giảng viên với 10 năm kinh nghiệm giảng dạy tiếng Hàn",
        socialLinks: {},
        rating: 5,
        totalStudents: 1200
      },
      {
        name: "Trần Thị B",
        title: "Chuyên gia ngôn ngữ",
        imageUrl: "https://images.unsplash.com/photo-1577896851231-70ef18881754",
        bio: "Tốt nghiệp Đại học Seoul, 5 năm kinh nghiệm luyện thi TOPIK",
        socialLinks: {},
        rating: 5,
        totalStudents: 800
      },
    ];

    teachers.forEach(teacher => {
      const id = this.teacherId++;
      const newTeacher = { ...teacher, id };
      this.teachers.set(id, newTeacher);
    });

    // Create mock courses
    const courses = [
      {
        title: "TOPIK I - Sơ cấp",
        description: "Khóa học dành cho người mới bắt đầu",
        imageUrl: "https://images.unsplash.com/photo-1472289065668-ce650ac443d2",
        level: "beginner",
        duration: 30,
        price: 1500000,
        teacherId: 1,
        sections: [],
        isFeatured: true,
        videoUrl: null,
        updatedAt: new Date()
      },
      {
        title: "TOPIK II - Trung cấp",
        description: "Luyện thi chuyên sâu TOPIK cấp độ 3-4",
        imageUrl: "https://images.unsplash.com/photo-1493723843671-1d655e66ac1c",
        level: "intermediate", 
        duration: 45,
        price: 2500000,
        teacherId: 2,
        sections: [],
        isFeatured: true,
        videoUrl: null,
        updatedAt: new Date()
      },
    ];

    courses.forEach(course => {
      const id = this.courseId++;
      const newCourse = { ...course, id };
      this.courses.set(id, newCourse);
    });

    // Create mock practice exams
    const exams = [
      {
        title: "TOPIK I Reading Practice Test 1",
        description: "Practice test focusing on basic reading comprehension",
        level: "TOPIK I",
        type: "reading",
        timeLimit: 90,
        questions: [],
        totalPoints: 100,
        createdAt: new Date()
      },
      {
        title: "TOPIK II Listening Practice Test 1",
        description: "Advanced listening comprehension practice",
        level: "TOPIK II",
        type: "listening",
        timeLimit: 60,
        questions: [],
        totalPoints: 100,
        createdAt: new Date()
      }
    ];

    exams.forEach(exam => {
      const id = this.examId++;
      const newExam = { ...exam, id };
      this.practiceExams.set(id, newExam);
    });
  }

  // Implement existing methods
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
    const newCourse = { 
      ...course, 
      id, 
      sections: [],
      isFeatured: false,
      videoUrl: null,
      updatedAt: new Date()
    };
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
    const newTeacher = { 
      ...teacher, 
      id,
      socialLinks: {},
      rating: 5,
      totalStudents: 0
    };
    this.teachers.set(id, newTeacher);
    return newTeacher;
  }

  // Implement new methods
  async getPracticeExams(): Promise<PracticeExam[]> {
    return Array.from(this.practiceExams.values());
  }

  async getPracticeExam(id: number): Promise<PracticeExam | undefined> {
    return this.practiceExams.get(id);
  }

  async searchPracticeExams(level: string): Promise<PracticeExam[]> {
    const exams = Array.from(this.practiceExams.values());
    return exams.filter(exam => exam.level === level);
  }

  async getExercises(): Promise<Exercise[]> {
    return Array.from(this.exercises.values());
  }

  async getExercise(id: number): Promise<Exercise | undefined> {
    return this.exercises.get(id);
  }

  async searchExercises(type: string, level: string): Promise<Exercise[]> {
    const exercises = Array.from(this.exercises.values());
    return exercises.filter(ex => ex.type === type && ex.level === level);
  }

  async getStudyTips(): Promise<StudyTip[]> {
    return Array.from(this.studyTips.values());
  }

  async getStudyTip(id: number): Promise<StudyTip | undefined> {
    return this.studyTips.get(id);
  }

  async searchStudyTips(category: string): Promise<StudyTip[]> {
    const tips = Array.from(this.studyTips.values());
    return tips.filter(tip => tip.category === category);
  }

  async getUserProgress(userId: number): Promise<UserProgress[]> {
    return this.userProgress.get(userId) || [];
  }

  async saveUserProgress(progress: UserProgress): Promise<void> {
    const userProgresses = this.userProgress.get(progress.userId) || [];
    userProgresses.push(progress);
    this.userProgress.set(progress.userId, userProgresses);
  }

  async getStudySessions(userId: number): Promise<StudySession[]> {
    return Array.from(this.studySessions.values())
      .filter(session => session.userId === userId);
  }

  async startStudySession(userId: number, activityType: string, activityId: number): Promise<StudySession> {
    const id = this.sessionId++;
    const session: StudySession = {
      id,
      userId,
      startTime: new Date(),
      endTime: null,
      duration: null,
      activityType,
      activityId
    };
    this.studySessions.set(id, session);
    return session;
  }

  async endStudySession(sessionId: number): Promise<void> {
    const session = this.studySessions.get(sessionId);
    if (session) {
      const endTime = new Date();
      const duration = Math.floor((endTime.getTime() - session.startTime.getTime()) / 60000); // Convert to minutes
      this.studySessions.set(sessionId, {
        ...session,
        endTime,
        duration
      });
    }
  }
}

export const storage = new MemStorage();