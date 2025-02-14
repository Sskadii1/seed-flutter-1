const vi = {
  common: {
    search: "Tìm kiếm",
    courses: "Khóa học",
    teachers: "Giảng viên",
    login: "Đăng nhập",
    price: "Học phí",
    duration: "Thời lượng",
    hours: "giờ",
    level: {
      beginner: "Sơ cấp",
      intermediate: "Trung cấp",
      advanced: "Cao cấp"
    },
    menu: {
      introduction: "GIỚI THIỆU",
      selfStudy: "TỰ ÔN LUYỆN",
      studyTogether: "CÙNG ÔN LUYỆN",
      examPrep: "ÔN THI",
      experience: "KINH NGHIỆM",
      profile: "TRANG CÁ NHÂN"
    }
  },
  home: {
    hero: {
      title: "Luyện thi TOPIK Online",
      subtitle: "Khóa học trực tuyến với giảng viên hàng đầu"
    }
  }
};

export type I18n = typeof vi;
export const i18n = vi;