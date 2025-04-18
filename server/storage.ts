import { 
  Course, Teacher, InsertCourse, InsertTeacher, PracticeExam, 
  Exercise, StudyTip, UserProgress, StudySession, User, 
  InsertUser, SupportTicket, ChatMessage, InsertChatMessage,
  Dictionary, InsertDictionary, UserAchievement, InsertUserAchievement
} from "@shared/schema";

export interface IStorage {
  // Courses
  getCourses(): Promise<Course[]>;
  getCourse(id: number): Promise<Course | undefined>;
  searchCourses(query: string): Promise<Course[]>;
  createCourse(course: InsertCourse): Promise<Course>;
  deleteCourse(id: number): Promise<void>;
  updateCourse(id: number, course: Partial<InsertCourse>): Promise<Course>;

  // Teachers
  getTeachers(): Promise<Teacher[]>;
  getTeacher(id: number): Promise<Teacher | undefined>;
  createTeacher(teacher: InsertTeacher): Promise<Teacher>;
  deleteTeacher(id: number): Promise<void>;
  updateTeacher(id: number, teacher: Partial<InsertTeacher>): Promise<Teacher>;

  // Practice Exams
  getPracticeExams(): Promise<PracticeExam[]>;
  getPracticeExam(id: number): Promise<PracticeExam | undefined>;
  searchPracticeExams(level: string): Promise<PracticeExam[]>;
  createPracticeExam(exam: any): Promise<PracticeExam>;
  deletePracticeExam(id: number): Promise<void>;

  // Exercises
  getExercises(): Promise<Exercise[]>;
  getExercise(id: number): Promise<Exercise | undefined>;
  searchExercises(type: string, level: string): Promise<Exercise[]>;
  createExercise(exercise: any): Promise<Exercise>;
  deleteExercise(id: number): Promise<void>;

  // Study Tips
  getStudyTips(): Promise<StudyTip[]>;
  getStudyTip(id: number): Promise<StudyTip | undefined>;
  createStudyTip(tip: Omit<StudyTip, 'id' | 'likes' | 'comments' | 'createdAt'>): Promise<StudyTip>;
  deleteStudyTip(id: number): Promise<void>;
  likeTip(id: number): Promise<StudyTip>;
  addComment(tipId: number, userId: number, content: string): Promise<StudyTip>;
  deleteComment(tipId: number, commentId: number): Promise<StudyTip>;
  searchStudyTips(category: string): Promise<StudyTip[]>;

  // User Progress
  getUserProgress(userId: number): Promise<UserProgress[]>;
  saveUserProgress(progress: UserProgress): Promise<void>;
  deleteUserProgress(id: number): Promise<void>;

  // Study Sessions
  getStudySessions(userId: number): Promise<StudySession[]>;
  startStudySession(userId: number, activityType: string, activityId: number): Promise<StudySession>;
  endStudySession(sessionId: number): Promise<void>;

  // User Authentication and Management
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  setUserRole(id: number, role: string): Promise<User>;
  upgradeToTeacher(id: number): Promise<User>;
  upgradeToManager(id: number): Promise<User>;
  upgradeToAdmin(id: number): Promise<User>;
  activateSubscription(id: number, durationDays: number): Promise<User>;
  deactivateSubscription(id: number): Promise<User>;
  
  // Support Tickets
  getSupportTickets(): Promise<SupportTicket[]>;
  getSupportTicket(id: number): Promise<SupportTicket | undefined>;
  createSupportTicket(ticket: any): Promise<SupportTicket>;
  updateSupportTicket(id: number, data: Partial<SupportTicket>): Promise<SupportTicket>;
  deleteSupportTicket(id: number): Promise<void>;

  // Chat System
  getChatMessages(userId: number, otherUserId: number): Promise<ChatMessage[]>;
  sendChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  markMessageAsRead(messageId: number): Promise<void>;
  getUnreadMessageCount(userId: number): Promise<number>;
  
  // Dictionary
  getDictionaryEntries(query?: string, level?: string, category?: string): Promise<Dictionary[]>;
  getDictionaryEntry(id: number): Promise<Dictionary | undefined>;
  createDictionaryEntry(entry: InsertDictionary): Promise<Dictionary>;
  updateDictionaryEntry(id: number, data: Partial<InsertDictionary>): Promise<Dictionary>;
  deleteDictionaryEntry(id: number): Promise<void>;
  
  // User Achievements
  getUserAchievements(userId: number): Promise<UserAchievement[]>;
  createUserAchievement(achievement: InsertUserAchievement): Promise<UserAchievement>;
  checkAndAwardAchievements(userId: number): Promise<UserAchievement[]>;
}

export class MemStorage implements IStorage {
  private courses: Map<number, Course>;
  private teachers: Map<number, Teacher>;
  private practiceExams: Map<number, PracticeExam>;
  private exercises: Map<number, Exercise>;
  private studyTips: Map<number, StudyTip>;
  private userProgress: Map<number, UserProgress[]>;
  private studySessions: Map<number, StudySession>;
  private users: Map<number, User>;
  private supportTickets: Map<number, SupportTicket>;
  private chatMessages: Map<number, ChatMessage>;
  private dictionaryEntries: Map<number, Dictionary>;
  private userAchievements: Map<number, UserAchievement>; 

  private courseId: number = 1;
  private teacherId: number = 1;
  private examId: number = 1;
  private exerciseId: number = 1;
  private tipId: number = 1;
  private sessionId: number = 1;
  private userId: number = 1;
  private ticketId: number = 1;
  private messageId: number = 1;
  private dictionaryId: number = 1;
  private achievementId: number = 1;
  private progressId: number = 1;

  constructor() {
    this.courses = new Map();
    this.teachers = new Map();
    this.practiceExams = new Map();
    this.exercises = new Map();
    this.studyTips = new Map();
    this.userProgress = new Map();
    this.studySessions = new Map();
    this.users = new Map();
    this.supportTickets = new Map();
    this.chatMessages = new Map();
    this.dictionaryEntries = new Map();
    this.userAchievements = new Map();
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

    // Create mock study tips
    const tips = [
      {
        title: "Cách học từ vựng hiệu quả",
        content: "1. Học từ vựng theo chủ đề\n2. Sử dụng flashcards\n3. Thực hành với native speaker\n4. Viết nhật ký bằng tiếng Hàn",
        authorId: 1,
        likes: 15,
        category: "vocabulary",
        imageUrl: null,
        comments: [],
        createdAt: new Date()
      },
      {
        title: "Kinh nghiệm thi TOPIK II",
        content: "Chia sẻ kinh nghiệm đạt điểm cao trong kỳ thi TOPIK II vừa qua:\n- Luyện nghe nhiều\n- Làm các đề thi thử\n- Học nhóm cùng bạn bè",
        authorId: 2,
        likes: 23,
        category: "exam",
        imageUrl: null,
        comments: [],
        createdAt: new Date()
      }
    ];

    tips.forEach(tip => {
      const id = this.tipId++;
      const newTip = { ...tip, id };
      this.studyTips.set(id, newTip);
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
  
  async deleteCourse(id: number): Promise<void> {
    if (!this.courses.has(id)) {
      throw new Error('Course not found');
    }
    this.courses.delete(id);
  }
  
  async updateCourse(id: number, course: Partial<InsertCourse>): Promise<Course> {
    const existingCourse = this.courses.get(id);
    if (!existingCourse) {
      throw new Error('Course not found');
    }
    
    const updatedCourse = {
      ...existingCourse,
      ...course,
      updatedAt: new Date()
    };
    
    this.courses.set(id, updatedCourse);
    return updatedCourse;
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
  
  async deleteTeacher(id: number): Promise<void> {
    if (!this.teachers.has(id)) {
      throw new Error('Teacher not found');
    }
    this.teachers.delete(id);
  }
  
  async updateTeacher(id: number, teacher: Partial<InsertTeacher>): Promise<Teacher> {
    const existingTeacher = this.teachers.get(id);
    if (!existingTeacher) {
      throw new Error('Teacher not found');
    }
    
    const updatedTeacher = {
      ...existingTeacher,
      ...teacher
    };
    
    this.teachers.set(id, updatedTeacher);
    return updatedTeacher;
  }


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
  
  async createPracticeExam(exam: any): Promise<PracticeExam> {
    const id = this.examId++;
    const newExam = {
      ...exam,
      id,
      createdAt: new Date()
    };
    this.practiceExams.set(id, newExam);
    return newExam;
  }
  
  async deletePracticeExam(id: number): Promise<void> {
    if (!this.practiceExams.has(id)) {
      throw new Error('Practice exam not found');
    }
    this.practiceExams.delete(id);
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
  
  async createExercise(exercise: any): Promise<Exercise> {
    const id = this.exerciseId++;
    const newExercise = {
      ...exercise,
      id,
      createdAt: new Date()
    };
    this.exercises.set(id, newExercise);
    return newExercise;
  }
  
  async deleteExercise(id: number): Promise<void> {
    if (!this.exercises.has(id)) {
      throw new Error('Exercise not found');
    }
    this.exercises.delete(id);
  }

  async getStudyTips(): Promise<StudyTip[]> {
    return Array.from(this.studyTips.values());
  }

  async getStudyTip(id: number): Promise<StudyTip | undefined> {
    return this.studyTips.get(id);
  }

  async createStudyTip(tip: Omit<StudyTip, 'id' | 'likes' | 'comments' | 'createdAt'>): Promise<StudyTip> {
    const id = this.tipId++;
    const newTip = {
      ...tip,
      id,
      likes: 0,
      comments: [],
      createdAt: new Date(),
    };
    this.studyTips.set(id, newTip);
    return newTip;
  }

  async likeTip(id: number): Promise<StudyTip> {
    const tip = this.studyTips.get(id);
    if (!tip) {
      throw new Error('Study tip not found');
    }
    const updatedTip = {
      ...tip,
      likes: tip.likes + 1,
    };
    this.studyTips.set(id, updatedTip);
    return updatedTip;
  }

  async addComment(tipId: number, userId: number, content: string): Promise<StudyTip> {
    const tip = this.studyTips.get(tipId);
    if (!tip) {
      throw new Error('Study tip not found');
    }
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }
    const comment = {
      id: Date.now(),
      userId,
      userName: user.name,
      content,
      createdAt: new Date(),
    };
    const updatedTip = {
      ...tip,
      comments: [...tip.comments, comment],
    };
    this.studyTips.set(tipId, updatedTip);
    return updatedTip;
  }

  async searchStudyTips(category: string): Promise<StudyTip[]> {
    const tips = Array.from(this.studyTips.values());
    return tips.filter(tip => tip.category === category);
  }
  
  async deleteStudyTip(id: number): Promise<void> {
    if (!this.studyTips.has(id)) {
      throw new Error('Study tip not found');
    }
    this.studyTips.delete(id);
  }
  
  async deleteComment(tipId: number, commentId: number): Promise<StudyTip> {
    const tip = this.studyTips.get(tipId);
    if (!tip) {
      throw new Error('Study tip not found');
    }
    
    const commentIndex = tip.comments.findIndex(c => c.id === commentId);
    if (commentIndex === -1) {
      throw new Error('Comment not found');
    }
    
    const updatedComments = [...tip.comments];
    updatedComments.splice(commentIndex, 1);
    
    const updatedTip = {
      ...tip,
      comments: updatedComments
    };
    
    this.studyTips.set(tipId, updatedTip);
    return updatedTip;
  }

  async getUserProgress(userId: number): Promise<UserProgress[]> {
    return this.userProgress.get(userId) || [];
  }

  async saveUserProgress(progress: UserProgress): Promise<void> {
    const userProgresses = this.userProgress.get(progress.userId) || [];
    userProgresses.push(progress);
    this.userProgress.set(progress.userId, userProgresses);
  }
  
  async deleteUserProgress(id: number): Promise<void> {
    // Since user progress is stored in a Map by user ID, we need to find the progress in each user's array
    for (const [userId, progresses] of this.userProgress.entries()) {
      const index = progresses.findIndex(p => p.id === id);
      if (index !== -1) {
        progresses.splice(index, 1);
        this.userProgress.set(userId, progresses);
        return;
      }
    }
    throw new Error('User progress not found');
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

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = this.userId++;
    const newUser = {
      ...user,
      id,
      enrolledCourses: [],
      learningStreak: 0,
      totalStudyTime: 0,
      createdAt: new Date(),
      imageUrl: user.imageUrl || null,
      role: user.role || 'user',
      isPaid: user.isPaid || false,
      subscriptionExpiryDate: user.subscriptionExpiryDate || null
    };
    this.users.set(id, newUser);
    return newUser;
  }
  
  async updateUser(id: number, data: Partial<User>): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    
    const updatedUser = {
      ...user,
      ...data
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async deleteUser(id: number): Promise<void> {
    if (!this.users.has(id)) {
      throw new Error('User not found');
    }
    this.users.delete(id);
  }
  
  async setUserRole(id: number, role: string): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    
    const updatedUser = {
      ...user,
      role
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async upgradeToTeacher(id: number): Promise<User> {
    return this.setUserRole(id, 'teacher');
  }
  
  async upgradeToManager(id: number): Promise<User> {
    return this.setUserRole(id, 'manager');
  }
  
  async upgradeToAdmin(id: number): Promise<User> {
    return this.setUserRole(id, 'admin');
  }
  
  async activateSubscription(id: number, durationDays: number): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);
    
    const updatedUser = {
      ...user,
      isPaid: true,
      role: user.role === 'user' ? 'paid_user' : user.role, // Update role if it was a regular user
      subscriptionExpiryDate: expiryDate
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async deactivateSubscription(id: number): Promise<User> {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    
    const updatedUser = {
      ...user,
      isPaid: false,
      role: user.role === 'paid_user' ? 'user' : user.role, // Downgrade role if it was a paid user
      subscriptionExpiryDate: null
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  // Support Tickets
  async getSupportTickets(): Promise<SupportTicket[]> {
    return Array.from(this.supportTickets.values());
  }
  
  async getSupportTicket(id: number): Promise<SupportTicket | undefined> {
    return this.supportTickets.get(id);
  }
  
  async createSupportTicket(ticket: any): Promise<SupportTicket> {
    const id = this.ticketId++;
    const newTicket = {
      ...ticket,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.supportTickets.set(id, newTicket);
    return newTicket;
  }
  
  async updateSupportTicket(id: number, data: Partial<SupportTicket>): Promise<SupportTicket> {
    const ticket = this.supportTickets.get(id);
    if (!ticket) {
      throw new Error('Support ticket not found');
    }
    
    const updatedTicket = {
      ...ticket,
      ...data,
      updatedAt: new Date()
    };
    
    this.supportTickets.set(id, updatedTicket);
    return updatedTicket;
  }
  
  async deleteSupportTicket(id: number): Promise<void> {
    if (!this.supportTickets.has(id)) {
      throw new Error('Support ticket not found');
    }
    this.supportTickets.delete(id);
  }
  
  // Chat System
  async getChatMessages(userId: number, otherUserId: number): Promise<ChatMessage[]> {
    return Array.from(this.chatMessages.values()).filter(
      msg => 
        (msg.senderId === userId && msg.receiverId === otherUserId) || 
        (msg.senderId === otherUserId && msg.receiverId === userId)
    ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  
  async sendChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const id = this.messageId++;
    const newMessage = {
      ...message,
      id,
      isRead: false,
      createdAt: new Date(),
      attachmentUrl: message.attachmentUrl || null
    };
    this.chatMessages.set(id, newMessage);
    return newMessage;
  }
  
  async markMessageAsRead(messageId: number): Promise<void> {
    const message = this.chatMessages.get(messageId);
    if (!message) {
      throw new Error('Message not found');
    }
    
    const updatedMessage = {
      ...message,
      isRead: true
    };
    
    this.chatMessages.set(messageId, updatedMessage);
  }
  
  async getUnreadMessageCount(userId: number): Promise<number> {
    return Array.from(this.chatMessages.values()).filter(
      msg => msg.receiverId === userId && !msg.isRead
    ).length;
  }
  
  // Dictionary
  async getDictionaryEntries(query?: string, level?: string, category?: string): Promise<Dictionary[]> {
    let entries = Array.from(this.dictionaryEntries.values());
    
    if (query) {
      entries = entries.filter(entry => 
        entry.korean.includes(query) || 
        entry.vietnamese.includes(query) || 
        (entry.english && entry.english.includes(query))
      );
    }
    
    if (level) {
      entries = entries.filter(entry => entry.level === level);
    }
    
    if (category) {
      entries = entries.filter(entry => entry.category === category);
    }
    
    return entries;
  }
  
  async getDictionaryEntry(id: number): Promise<Dictionary | undefined> {
    return this.dictionaryEntries.get(id);
  }
  
  async createDictionaryEntry(entry: InsertDictionary): Promise<Dictionary> {
    const id = this.dictionaryId++;
    const newEntry = {
      ...entry,
      id,
      createdAt: new Date(),
      english: entry.english || null,
      pronunciation: entry.pronunciation || null,
      exampleSentence: entry.exampleSentence || null
    };
    this.dictionaryEntries.set(id, newEntry);
    return newEntry;
  }
  
  async updateDictionaryEntry(id: number, data: Partial<InsertDictionary>): Promise<Dictionary> {
    const entry = this.dictionaryEntries.get(id);
    if (!entry) {
      throw new Error('Dictionary entry not found');
    }
    
    const updatedEntry = {
      ...entry,
      ...data
    };
    
    this.dictionaryEntries.set(id, updatedEntry);
    return updatedEntry;
  }
  
  async deleteDictionaryEntry(id: number): Promise<void> {
    if (!this.dictionaryEntries.has(id)) {
      throw new Error('Dictionary entry not found');
    }
    this.dictionaryEntries.delete(id);
  }
  
  // User Achievements
  async getUserAchievements(userId: number): Promise<UserAchievement[]> {
    return Array.from(this.userAchievements.values()).filter(
      achievement => achievement.userId === userId
    );
  }
  
  async createUserAchievement(achievement: InsertUserAchievement): Promise<UserAchievement> {
    const id = this.achievementId++;
    const newAchievement = {
      ...achievement,
      id,
      earnedAt: new Date()
    };
    this.userAchievements.set(id, newAchievement);
    return newAchievement;
  }
  
  async checkAndAwardAchievements(userId: number): Promise<UserAchievement[]> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const awardedAchievements: UserAchievement[] = [];
    const existingAchievements = await this.getUserAchievements(userId);
    
    // Check for streak achievements
    if (user.learningStreak >= 7) {
      const has7DayStreak = existingAchievements.some(
        a => a.achievementType === 'daily_streak' && a.achievementValue === 7
      );
      
      if (!has7DayStreak) {
        const achievement = await this.createUserAchievement({
          userId,
          achievementType: 'daily_streak',
          achievementValue: 7
        });
        awardedAchievements.push(achievement);
      }
    }
    
    if (user.learningStreak >= 30) {
      const has30DayStreak = existingAchievements.some(
        a => a.achievementType === 'daily_streak' && a.achievementValue === 30
      );
      
      if (!has30DayStreak) {
        const achievement = await this.createUserAchievement({
          userId,
          achievementType: 'daily_streak',
          achievementValue: 30
        });
        awardedAchievements.push(achievement);
      }
    }
    
    // Add more achievement checks here as needed
    
    return awardedAchievements;
  }
}

export const storage = new MemStorage();