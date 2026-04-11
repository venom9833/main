import customtkinter as ctk
from Naver_nShop import NaverNShopAnalyzer
import threading
from tkinter import messagebox
import os

class BrandConnectApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("브랜드 커넥트 상품비교 v1.1")
        self.geometry("800x600")
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.analyzer = NaverNShopAnalyzer()
        self.row_items = [] # Store row components: (keyword_entry, url_entry, frame)

        self.setup_ui()
        self.add_row() # Start with one row

    def setup_ui(self):
        # Header
        self.header_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.header_frame.pack(fill="x", pady=20, padx=20)
        
        self.title_label = ctk.CTkLabel(self.header_frame, text="브랜드 커넥트 분석 도구", font=ctk.CTkFont(size=24, weight="bold"))
        self.title_label.pack(side="left")

        # Control Buttons
        self.add_row_button = ctk.CTkButton(self.header_frame, text="+ 행 추가", width=100, command=self.add_row, fg_color="#28a745", hover_color="#218838")
        self.add_row_button.pack(side="right", padx=(10, 0))

        # Main Content - Scrollable Frame
        self.scrollable_frame = ctk.CTkScrollableFrame(self, label_text="키워드 및 URL 리스트")
        self.scrollable_frame.pack(fill="both", expand=True, padx=20, pady=10)

        # Bottom Frame (Progress & Actions)
        self.bottom_frame = ctk.CTkFrame(self)
        self.bottom_frame.pack(fill="x", padx=20, pady=20)

        # Progress bar
        self.progress_bar = ctk.CTkProgressBar(self.bottom_frame)
        self.progress_bar.pack(fill="x", padx=10, pady=(10, 5))
        self.progress_bar.set(0)

        self.progress_status = ctk.CTkLabel(self.bottom_frame, text="준비됨", font=ctk.CTkFont(size=12))
        self.progress_status.pack(pady=5)

        self.run_button = ctk.CTkButton(self.bottom_frame, text="전체 작업 시작", height=40, font=ctk.CTkFont(size=16, weight="bold"), command=self.start_all_tasks)
        self.run_button.pack(fill="x", padx=10, pady=10)

    def add_row(self):
        row_frame = ctk.CTkFrame(self.scrollable_frame, fg_color="transparent")
        row_frame.pack(fill="x", pady=5)

        keyword_entry = ctk.CTkEntry(row_frame, width=150, placeholder_text="키워드")
        keyword_entry.pack(side="left", padx=5)

        url_entry = ctk.CTkEntry(row_frame, placeholder_text="분석할 URL 입력", width=450)
        url_entry.pack(side="left", padx=5, expand=True, fill="x")

        delete_btn = ctk.CTkButton(row_frame, text="X", width=30, fg_color="#dc3545", hover_color="#c82333", command=lambda f=row_frame: self.remove_row(f))
        delete_btn.pack(side="left", padx=5)

        self.row_items.append({
            "frame": row_frame,
            "keyword": keyword_entry,
            "url": url_entry
        })

    def remove_row(self, frame):
        if len(self.row_items) <= 1:
            messagebox.showwarning("주의", "최소 하나의 행은 있어야 합니다.")
            return

        for i, item in enumerate(self.row_items):
            if item["frame"] == frame:
                item["frame"].destroy()
                self.row_items.pop(i)
                break

    def start_all_tasks(self):
        # Validate tasks
        tasks = []
        for item in self.row_items:
            k = item["keyword"].get().strip()
            u = item["url"].get().strip()
            if k and u:
                tasks.append((k, u))

        if not tasks:
            messagebox.showwarning("입력 오류", "유효한 키워드와 URL을 입력해주세요.")
            return

        self.run_button.configure(state="disabled")
        self.add_row_button.configure(state="disabled")
        
        # Start threading
        thread = threading.Thread(target=self.process_tasks_thread, args=(tasks,))
        thread.daemon = True
        thread.start()

    def process_tasks_thread(self, tasks):
        total = len(tasks)
        for i, (keyword, url) in enumerate(tasks):
            # Update progress UI
            progress_val = (i) / total
            status_text = f"[{i+1}/{total}] '{keyword}' 분석 중..."
            self.after(0, lambda p=progress_val, s=status_text: self.update_progress(p, s))

            # Execute analysis (keep driver open until last task)
            keep_open = (i < total - 1)
            success, message = self.analyzer.analyze_keyword(keyword, url, keep_open=keep_open)
            
            # log for debugging
            print(f"Task result: {success}, {message}")

        # Final Update
        self.after(0, lambda: self.update_progress(1.0, f"총 {total} 건의 작업이 완료되었습니다."))
        self.after(0, self.finish_all_tasks)

    def update_progress(self, val, status):
        self.progress_bar.set(val)
        self.progress_status.configure(text=status)

    def finish_all_tasks(self):
        self.run_button.configure(state="normal")
        self.add_row_button.configure(state="normal")
        messagebox.showinfo("완료", "모든 작업이 완료되었습니다.")

if __name__ == "__main__":
    app = BrandConnectApp()
    app.mainloop()
