# SEED — Cơ sở khoa học & Phương pháp Sư phạm Tiếng Hàn cho Người Việt

> **Mục tiêu tài liệu:** Chuyển hóa các phát hiện thực nghiệm từ Tâm lý học nhận thức (Cognitive Psychology), Thụ đắc ngôn ngữ thứ hai (SLA), Ngữ âm học thực nghiệm và Phân tích lỗi Việt–Hàn thành **quy tắc thiết kế sản phẩm** cụ thể, nhằm khắc phục triệt để tình trạng *"bấm chọn đáp án xong là quên"* của các ứng dụng game hóa thuần túy.

---

## 1. Vì sao mô hình "Bấm nút nhận diện" thất bại trong ghi nhớ dài hạn?

### 1.1 Bằng chứng từ nghiên cứu độc lập về Duolingo
* **Trích dẫn:** Loewen, S., Crowther, D., Isbell, D. R., Kim, K. M., Maloney, J., Miller, Z. F., & Rawal, H. (2019). *Mobile-assisted language learning: A Duolingo case study*. **ReCALL**, 31(3), 293–311.
* **Phát hiện chính:** Nghiên cứu theo dõi người trưởng thành tự học một ngôn ngữ mới (tiếng Thổ Nhĩ Kỳ) qua Duolingo trong 1 học kỳ cho thấy: người học có tiến bộ ở kỹ năng đọc và nhận diện từ vựng/ngữ pháp cơ bản (tương quan thuận mức trung bình với thời gian học), nhưng **rất yếu ở kỹ năng sản sinh ngôn ngữ (nói/viết tự do)**, nản lòng vì **thiếu giải thích ngữ pháp tường minh**, gặp nhiều câu tách rời ngữ cảnh thực tế, và **động lực nội tại suy giảm** khi tính mới lạ của điểm thưởng qua đi.
* **Hệ quả thiết kế cho SEED:** Không biến app thành trò chơi chọn thẻ trắc nghiệm lặp đi lặp lại. Phải có giải thích ngữ pháp ngắn gọn, bài tập sản sinh (gõ/nói/đặt câu), và câu chuyện ngắn theo ngữ cảnh.

### 1.2 Hiệu ứng kiểm tra chủ động (Retrieval Practice) và "Ảo giác thông thạo"
* **Trích dẫn 1:** Karpicke, J. D., & Roediger, H. L. III (2008). *The critical importance of retrieval for learning*. **Science**, 319(5865), 966–968.
  * **Thực nghiệm:** Sinh viên học cặp từ vựng ngoại ngữ (Swahili–Anh) theo 4 điều kiện sau khi đã nhớ đúng lần đầu: tiếp tục học lại + kiểm tra (`ST`), chỉ học lại không kiểm tra (`SN`), bỏ học lại chỉ kiểm tra lặp lại (`TS`), hoặc bỏ cả hai (`TN`).
  * **Phát hiện gây chấn động:** Sau 1 tuần, nhóm chỉ xem/đọc lại (`SN`) có kết quả nhớ **không khác gì nhóm bỏ hẳn (`TN`)**, trong khi hai nhóm phải **tự truy xuất từ trí nhớ (`TS`, `ST`) đạt tỉ lệ nhớ vượt trội**. Đặc biệt, khi được hỏi dự đoán điểm, sinh viên lại tin rằng nhóm đọc lại (`SN`) sẽ nhớ tốt nhất — một sai lệch siêu nhận thức (metacognitive illusion) vì việc nhìn lại mang lại cảm giác "quen mắt, dễ dàng".
* **Trích dẫn 2:** Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). *Improving students' learning with effective learning techniques: Promising directions from cognitive and educational psychology*. **Psychological Science in the Public Interest**, 14(1), 4–58.
  * **Phát hiện chính:** Trong 10 kỹ thuật học phổ biến được đánh giá, chỉ có **2 kỹ thuật** đạt mức **High Utility (Hiệu quả cao và tổng quát hóa tốt)**: (1) **Practice Testing** (tự truy xuất kiến thức) và (2) **Distributed Practice** (học giãn cách). Đọc lại, gạch chân, tóm tắt đều bị xếp mức hiệu quả thấp.
* **Quy tắc SEED:**
  1. Cấm học kiểu lướt xem thụ động. Mọi từ mới phải đi qua **truy xuất chủ động** (tự nhớ nghĩa và tự gõ/tái tạo từ tiếng Hàn).
  2. Xây dựng màn hình **Retention Truth Dashboard** (*"Tỉ lệ từ bạn còn nhớ thật hôm nay: 86%"*) để chống lại ảo giác thành tích từ điểm XP.

---

## 2. Lặp lại ngắt quãng & Mô hình hóa đường cong quên (Spaced Repetition + FSRS)

* **Trích dẫn 1 (Meta-analysis nền tảng):** Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). *Distributed practice in verbal recall tasks: A review and quantitative synthesis*. **Psychological Bulletin**, 132(3), 354–380.
  * **Phát hiện:** Tổng hợp **184 bài báo (317 thí nghiệm)** chứng minh khoảng cách giữa các lần ôn (ISI) và thời điểm kiểm tra cuối (Retention Interval) tương tác phi tuyến: muốn nhớ dài hạn hàng tháng, khoảng cách ôn phải giãn rộng dần theo khả năng nhớ; ôn quá sát vừa lãng phí công sức, vừa không củng cố trí nhớ bền vững.
* **Trích dẫn 2 (Half-Life Regression):** Settles, B., & Meeder, B. (2016). *A trainable spaced repetition model for language learning*. **Proceedings of ACL 2016**, 1848–1858.
  * **Phát hiện:** Mô hình hóa "chu kỳ bán rã" ($h$) của từ vựng ($p = 2^{-\Delta / h}$) trên hàng chục triệu lượt học tại Duolingo giúp giảm >45% sai số dự đoán quên và tăng 12% mức độ quay lại học hằng ngày.
* **Trích dẫn 3 (FSRS — Thuật toán tối ưu hiện đại):** Ye, J., Su, J., & Cao, Y. (2022). *A stochastic shortest path algorithm for optimizing spaced repetition scheduling*. **Proceedings of the 28th ACM SIGKDD Conference (KDD '22)**, 4381–4390.
  * **Phát hiện & Benchmark:** Xây dựng mô hình trí nhớ **DSR** (**D**ifficulty – độ khó, **S**tability – độ bền trí nhớ tính bằng ngày, **R**etrievability – xác suất nhớ tại thời điểm hiện tại) từ hơn 220 triệu log ôn tập. So sánh trên hàng nghìn bộ sưu tập Anki cho thấy **FSRS dự đoán chính xác hơn thuật toán SM-2 cổ điển ở ~99,6% bộ dữ liệu**, loại bỏ hiện tượng "ease hell" (thẻ sai bị kẹt chu kỳ ngắn mãi mãi) và **giảm 20–30% số thẻ phải ôn mỗi ngày** ở cùng mức mục tiêu ghi nhớ 90%.
* **Quy tắc SEED:** Dùng **FSRS-4.5** làm trái tim của bộ điều phối buổi học. Mỗi phiên học luôn xử lý thẻ đến hạn có $R < 0.90$ **trước** khi mở khóa từ mới.

---

## 3. Chiều sâu từ vựng: Thang 4 nấc & Mức độ tham gia nhận thức

### 3.1 Phân biệt Nhận diện (Recognition) vs. Truy xuất Sản sinh (Productive Recall)
* **Trích dẫn:**
  * Nakata, T. (2008). *English vocabulary learning with word lists, word cards and computers*. **ReCALL**, 20(1), 3–20.
  * Nakata, T. (2011). *Computer-assisted second language vocabulary learning in a paired-associate paradigm*. **Computer Assisted Language Learning**, 24(1), 17–38.
  * Nakata, T. (2019). *Learning words with flash cards and word cards*. In **The Routledge Handbook of Vocabulary Studies**.
  * Kaitsu, T., & Nakata, T. (2025/2026). *Analysis of smartphone-based flashcard apps for second language vocabulary acquisition*. **Computer Assisted Language Learning**, 39(5–6).
* **Phát hiện:** Hoạt động luyện từ vựng chia theo ma trận 2×2: **(Thụ động Receptive vs. Chủ động Productive)** × **(Nhận diện Recognition vs. Tự nhớ Recall)**. Dạng bài trắc nghiệm 4 lựa chọn (*nhìn chữ Hàn → chọn nghĩa Việt*) chỉ tạo ra **kiến thức thụ động để hiểu**; nó **không đủ** để người học tự viết đúng chính tả (orthography) hay tự bật ra từ khi nói. Chỉ **Productive Recall** (*nhìn nghĩa/ngữ cảnh → tự gõ hoặc nói từ tiếng Hàn từ trí nhớ*) mới tạo thành thạo chủ động.
* **Quy tắc SEED:** Thiết kế **Thang 4 nấc thành thạo (4-Stage Mastery Ladder)** cho từng từ vựng. Một từ **chỉ được tính là "Thuộc thật"** khi người học vượt qua Stage 4 (Productive Recall) sau khoảng giãn cách ổn định.

### 3.2 Giả thuyết Tải lượng Tham gia (Involvement Load Hypothesis)
* **Trích dẫn:**
  * Laufer, B., & Hulstijn, J. (2001). *Incidental vocabulary acquisition in a second language: The construct of task-induced involvement*. **Applied Linguistics**, 22(1), 1–26.
  * Yanagisawa, A., & Webb, S. (2021/2022). *Involvement Load Hypothesis Plus: Creating an improved predictive model of incidental vocabulary learning*. **Studies in Second Language Acquisition**.
* **Phát hiện:** Mức độ nhớ từ tỷ lệ thuận với **Need** (nhu cầu giao tiếp) + **Search** (tra cứu/truy tìm) + **Evaluation** (đánh giá ngữ nghĩa để đặt từ vào ngữ cảnh mới). Các phân tích tổng hợp xác nhận **Evaluation** — đặc biệt là tự đặt câu gốc với từ vừa học — mang trọng số tác động lớn nhất lên khả năng ghi nhớ cả thụ động lẫn chủ động.
* **Quy tắc SEED:** Cuối mỗi Unit, yêu cầu người học hoàn thành 1–2 bài tập **cá nhân hóa có khung mẫu** (ví dụ: điền và biến đổi câu giới thiệu nghề nghiệp/sở thích của chính bản thân).

---

## 4. Thụ đắc Ngữ pháp: Giải thích tường minh, Trộn lẫn & Sửa lỗi gợi mở

### 4.1 Dạy ngữ pháp tường minh (Explicit Instruction)
* **Trích dẫn:** Spada, N., & Tomita, Y. (2010). *Interactions between type of instruction and type of language feature: A meta-analysis*. **Language Learning**, 60(2), 263–308.
* **Phát hiện:** Phân tích tổng hợp 41 nghiên cứu cho thấy hướng dẫn tường minh (giải thích quy tắc và cấu trúc) vượt trội hơn hẳn việc chỉ cho tiếp xúc ngầm (implicit exposure) trên cả cấu trúc đơn giản ($d \approx 0.73$) lẫn phức tạp ($d \approx 0.88$).
* **Quy tắc SEED:** Mỗi điểm ngữ pháp mở đầu bằng thẻ quy tắc tối đa 3–4 dòng tiếng Việt dễ hiểu, kèm **trực quan hóa quy tắc patchim (có/không phụ âm cuối)** ngay trên chữ Hangul trước khi vào bài tập.

### 4.2 Luyện tập trộn lẫn (Interleaved Practice)
* **Trích dẫn:** Nakata, T., & Suzuki, Y. (2019). *Mixing grammar exercises facilitates long-term retention: Effects of blocking, interleaving, and increasing practice*. **The Modern Language Journal**, 103(3), 629–647.
* **Phát hiện:** So sánh 3 nhóm luyện 5 cấu trúc ngữ pháp dễ nhầm: làm dồn từng loại (*blocked*), trộn lẫn ngay (*interleaved*), và làm dồn rồi trộn dần (*increasing*). Dù nhóm trộn lẫn **làm sai nhiều hơn trong lúc luyện tập**, nhưng ở bài kiểm tra sau 1 tuần họ đạt điểm **cao hơn đáng kể** nhóm làm dồn — đặc biệt hữu ích cho người học mới bắt đầu (điểm đầu vào thấp). Đây là hiệu ứng *"khó khăn có ích" (desirable difficulty)*.
* **Quy tắc SEED:** Giai đoạn giới thiệu cho phép luyện tách từng trợ từ, nhưng **bắt buộc chuyển sang trộn lẫn (Interleaved Contrast Drill)** giữa các cặp dễ nhầm (`은/는` vs. `이/가`, `에` vs. `에서`, `안` vs. `못`) trong cùng một phiên.

### 4.3 Sửa lỗi bằng gợi mở (Prompts over Recasts)
* **Trích dẫn:**
  * Li, S. (2010). *The effectiveness of corrective feedback in SLA: A meta-analysis*. **Language Learning**, 60(2), 309–365. (Hiệu ứng tổng hợp $d = 0.64$).
  * Lyster, R., & Saito, K. (2010). *Oral feedback in classroom SLA: A meta-analysis*. **Studies in Second Language Acquisition**, 32(2), 265–302.
* **Phát hiện:** Phản hồi sửa lỗi mang lại hiệu quả bền vững, trong đó **Prompts** (gợi ý manh mối để người học tự phát hiện và tự sửa lỗi) tạo hiệu ứng **lớn hơn rõ rệt** so với **Recasts** (chỉ đưa ngay câu trả lời đúng).
* **Quy tắc SEED:** Áp dụng **Cơ chế sửa lỗi 2 bước (Prompt-First Corrective Feedback)**:
  * *Sai lần 1:* Không hiện đáp án. Hiện gợi ý siêu ngôn ngữ (`promptHint`, ví dụ: *"Từ '선생님' kết thúc bằng phụ âm cuối ㅁ. Ta cần chọn trợ từ bắt đầu bằng nguyên âm hay phụ âm?"*) để người học tự sửa.
  * *Sai lần 2:* Mới hiện đáp án kèm giải thích tường minh và cặp đối chiếu.

---

## 5. Ngữ âm, Nghe hiểu & Đầu vào vừa sức (HVPT, Shadowing, Extensive Input)

### 5.1 Huấn luyện ngữ âm đa biến thiên (HVPT) cho hệ phụ âm 3 bậc tiếng Hàn
* **Trích dẫn:**
  * Thomson, R. I. (2018). *High variability [pronunciation] training (HVPT): A proven technique about which every language teacher and learner ought to know*. **Journal of Second Language Pronunciation**, 4(2), 242–264.
  * Uchihara, T., Karas, M., & Thomson, R. I. (2025). *High variability phonetic training: A meta-analysis*. **Studies in Second Language Acquisition**. (Tổng hợp 79 nghiên cứu: hiệu ứng $g = 0.67$ ở so sánh nhóm đối chứng và $g = 0.92$ từ trước-tới-sau; giữ được lâu dài và chuyển hóa sang phát âm thật).
  * Lee, J., & Park, H. (2025). *The role of speaking rates in High Variability Phonetic Training*. **Phonetics and Speech Sciences**.
* **Cơ sở tiếng Hàn:** Tiếng Hàn có hệ thống phụ âm tắc 3 bậc hiếm gặp: âm thường/nhẹ (**lax/lenis**: ㄱ, ㄷ, ㅂ, ㅈ), âm căng (**tense/fortis**: ㄲ, ㄸ, ㅃ, ㅉ) và âm bật hơi (**aspirated**: ㅋ, ㅌ, ㅍ, ㅊ). Sự phân biệt này không chỉ dựa vào thời gian bật hơi (VOT) mà còn dựa vào cao độ $f_0$ của nguyên âm đi sau. Lee & Park (2025) chứng minh việc dùng **nhiều người nói (nam/nữ)** kết hợp **nhiều tốc độ nói (chậm, bình thường, nhanh)** trong bài tập nhận diện cặp tối thiểu (minimal pairs) giúp người học tổng quát hóa được ranh giới âm vị ngay cả với giọng người lạ.
* **Quy tắc SEED:** Trong Unit 0 và rải đều các unit sau, mọi bài luyện nghe âm dễ nhầm (`달/딸/탈`, `불/뿔/풀`, `자다/짜다/차다`, `안/알`) đều phải phát âm thanh từ **ít nhất 3–4 profile giọng** và **2 tốc độ** trước khi người học chọn đáp án.

### 5.2 Shadowing & Đọc/Nghe mở rộng (Comprehensible Input)
* **Trích dẫn 1:** Hamada, Y. (2016). *Shadowing: Who benefits and how? Uncovering a booming EFL teaching technique for listening comprehension*. **Language Teaching Research**, 20(1), 35–52.
  * **Phát hiện:** Shadowing (nghe và nhại lại gần như tức thời) cải thiện mạnh kỹ năng xử lý âm thanh từ dưới lên (bottom-up listening) và trí nhớ làm việc âm vị, từ đó thúc đẩy phát âm trôi chảy khi có hướng dẫn theo dõi ngữ nghĩa.
* **Trích dẫn 2:** Jeon, E.-Y., & Day, R. R. (2016). *The effectiveness of ER on reading proficiency: A meta-analysis*. **Reading in a Foreign Language**, 28(2), 246–265. (Tổng hợp 49 nghiên cứu, $N = 5.919$: đọc mở rộng ở mức dễ hiểu tạo hiệu quả ổn định, đặc biệt mạnh ở người lớn học ngoại ngữ trên nền tảng web khi tích hợp trực tiếp vào giáo trình).
* **Quy tắc SEED:** Cuối mỗi unit có **Truyện ngắn phân cấp (Graded Micro-Story)** có audio đi kèm, kiểm soát chặt sao cho $\ge 95\%$ từ vựng trong truyện là từ người học đã gặp ở các unit trước hoặc hiện tại, kèm chế độ nghe-nhại (shadowing).

---

## 6. Nghiên cứu đặc thù cho Người Việt học Tiếng Hàn (L1 Vietnamese → L2 Korean)

### 6.1 Đòn bẩy Từ vựng Hán–Việt (한자어 / Sino-Korean) và Bẫy "Bạn giả"
* **Trích dẫn:**
  * 류투안 (Lu Tuan) (2011). *베트남 한국어 학습자를 위한 한국 한자어 어휘력 향상 방안 모색 — 한자음을 중심으로 하여* (Nghiên cứu nâng cao vốn từ Hán-Hàn cho người Việt học tiếng Hàn — tập trung vào âm Hán tự). **언어사실과 관점 (Language Facts and Perspectives)**, Viện Nghiên cứu Ngôn ngữ ĐH Yonsei.
  * Nguyen, T. H. S. (응웬 티 후옹 센) (2014). *베트남인 한국어 학습자의 한자어 오류 양상 연구* (Nghiên cứu lỗi từ Hán-Hàn của người Việt học tiếng Hàn). Luận văn / KCI.
  * Son, Y.-J. (손유진), & Jang, H.-J. (장혜진) (2021). *한국어와 베트남어의 한자어 대응 분석을 통한 베트남인 한국어 학습자의 한자어 교육 방안 연구*. **국어교육연구 (The Journal of Korean Language Education)**.
* **Phát hiện:**
  1. Từ gốc Hán chiếm tỷ lệ rất lớn (~50–60% tổng từ vựng tiếng Hàn và tới ~70% ở văn bản học thuật/tin tức), tương ứng có hệ thống với **từ Hán–Việt** nhờ quy luật biến âm lịch sử (ví dụ: âm đầu Việt `H-/V-` thường ứng với `ㄱ/ㅇ` như *Học* → `학`, *Viên* → `원`; vần `-t` thường ứng với patchim `ㄹ` như *Phát* → `발`, *Bất* → `불`).
  2. Tuy nhiên, Nguyen (2014) cảnh báo người Việt hay mắc lỗi dịch ngược từng chữ, dùng sai từ loại, hoặc rơi vào **từ đồng hình dị nghĩa / lệch nghĩa (false friends)** (ví dụ: `인간` *nhân gian* = con người, không chỉ cõi trần; `약속` *ước thúc* = lời hứa/cuộc hẹn).
* **Quy tắc SEED:** Gắn thẻ **Hán–Việt + Họ từ (Word Family)** (ví dụ: gốc `학 學 (Học)` mở ra `학생` học sinh, `학교` trường học, `대학` đại học) kèm cảnh báo riêng nếu từ có sắc thái khác nghĩa Hán–Việt.

### 6.2 Các lỗi phát âm và trợ từ đặc trưng của người Việt
* **Trích dẫn:**
  * Kim, J. (2007). *A Study on Errors in Korean Composition of Vietnamese Students*. **Journal of Korean Language Education**.
  * Im, S.-J. (임소정) (2019). *베트남인 학습자의 한국어 음운현상 발음 오류 분석 연구* (Phân tích lỗi phát âm hiện tượng âm vị tiếng Hàn của người học Việt Nam). ĐH Ngoại ngữ Hankuk (HUFS).
  * DTU Research Team (2024). *Research on Korean pronunciation teaching methods to Vietnamese learners: A focus on the final consonants ㄴ, ㄹ*. **DTU Journal of Science and Technology**, No. 5(66).
  * Phan, T. M. T., & Nguyen, T. H. (2026). *An Error Analysis in the Use of Korean and Japanese Subject Markers by Vietnamese Students*. **Hong Bang International University Journal of Science**.
  * Culture Convergence (2026). *A Study on Particle Error Patterns in the Translation Writing of Vietnamese Learners of Korean in Relation to Structural Differences between Vietnamese and Korean*. **문화융복합 (Culture Convergence)**.
* **Bản đồ lỗi L1 → L2 bắt buộc đưa vào bài tập mục tiêu của SEED:**

| Nhóm lỗi đặc trưng | Nguyên nhân giao thoa tiếng Việt (L1 Interference) | Cách SEED can thiệp trực tiếp |
|---|---|---|
| **Nhầm lẫn 3 bậc phụ âm tắc** (`ㄱ/ㄲ/ㅋ`, `ㄷ/ㄸ/ㅌ`, `ㅂ/ㅃ/ㅍ`, `ㅈ/ㅉ/ㅊ`) | Tiếng Việt không có đối lập 3 bậc vô thanh dựa trên VOT + $f_0$. | Bài tập nghe HVPT đa giọng & đa tốc độ trên cặp tối thiểu ngay từ Unit 0. |
| **Gộp nguyên âm `ㅐ` / `ㅔ` và lệch `ㅗ` / `ㅓ`, `ㅡ` / `ㅜ`** | Sự thiếu tương đương trực tiếp trên không gian nguyên âm F1/F2. | Minh họa khẩu hình + cặp nghe đối chiếu `오/어`, `으/우`, và giải thích rõ `ㅐ/ㅔ` trong giao tiếp hiện đại gần như đồng âm nhưng chính tả bắt buộc phân biệt. |
| **Patchim cuối `ㄴ` vs. `ㄹ` và Patchim kép (겹받침)** | Tiếng Việt có cấu trúc âm tiết đóng đơn giản, không có âm cuối uốn lưỡi kiểu `ㄹ` hoặc phụ âm kép. | Cặp nghe tối thiểu `안/알`, `문/물`, `신/실` + quy tắc nối âm `연음` (ví dụ `한국어` → `[한구거]`). |
| **Bỏ quên tân ngữ `을/를`** | Tiếng Việt là ngôn ngữ đơn lập (*ăn cơm* không cần trợ từ sau *cơm*). | Bài tập lắp ghép câu không cho sẵn trợ từ đính kèm; trừ điểm nhẹ và gợi mở tự sửa khi bỏ sót `을/를`. |
| **Nhầm chủ đề `은/는` và chủ ngữ `이/가`** | Dịch thẳng từ cấu trúc đề–thuyết tiếng Việt. | Phiên luyện trộn lẫn đối chiếu ngữ cảnh (giới thiệu/so sánh dùng `은/는` vs. thông tin mới/tồn tại `이/가 있어요`). |
| **Nhầm vị trí `에` và `에서`** | Tiếng Việt dùng chung giới từ *"ở"* cho cả tồn tại và hành động. | Quy tắc đối chiếu trực quan: *Đứng yên / Đích đến → `에`* vs. *Hành động diễn ra tại nơi → `에서`*. |

---

## 7. Game hóa có chủ đích (Gamification as a Mediator)

* **Trích dẫn:** Sailer, M., & Homner, L. (2020). *The gamification of learning: A meta-analysis*. **Educational Psychology Review**, 32(1), 77–112.
* **Phát hiện:** Game hóa tác động tích cực mức trung bình lên kết quả nhận thức ($g = 0.49$) và động lực ($g = 0.36$), nhưng chỉ bền vững khi kết hợp **phản hồi năng lực, câu chuyện/mục tiêu rõ ràng** và tránh cơ chế trừng phạt vô nghĩa.
* **Quy tắc SEED:**
  * **Bỏ cơ chế "Mất tim" (No Heart Penalty) khi làm sai bài tập:** Sai khi tự nhớ là tín hiệu cần thiết để FSRS điều chỉnh khoảng cách ôn, không phải hành vi đáng phạt.
  * **XP thưởng theo độ bền trí nhớ (Memory-Weighted XP):** Nhớ đúng một từ sau 14 ngày nhận XP cao gấp nhiều lần việc bấm đúng một từ vừa học 30 giây trước.
