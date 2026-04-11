import os
import time
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

class NaverNShopAnalyzer:
    def __init__(self):
        self.driver = None

    def setup_driver(self):
        if self.driver:
            return self.driver
            
        chrome_options = Options()
        chrome_options.add_argument("--start-maximized")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        # 드라이버 로그 최소화
        chrome_options.add_experimental_option("excludeSwitches", ["enable-logging"])
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        return self.driver

    def filter_url(self, url):
        """
        네이버 브랜드 커넥트/스토어 URL에서 공통 상품 ID 부분을 필터링합니다.
        """
        if not url: return ""
        # 1. 쿼리 스트링 제거
        clean_url = url.split('?')[0].strip()
        # 2. 마지막 슬래시 제거 (일관성)
        if clean_url.endswith('/'):
            clean_url = clean_url[:-1]
        print(f"필터링된 URL: {clean_url}")
        return clean_url

    def parse_product_html(self, html_content):
        """
        제공된 HTML 소스에서 필요한 정보를 추출합니다.
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # 1. 상품명 추출
        title_tag = soup.select_one('h3.DCVBehA8ZB._copyable')
        title = title_tag.get_text(strip=True) if title_tag else "상품명 없음"

        # 2. 가격 정보 추출
        # 할인 가격
        price_tag = soup.select_one('strong.Xu9MEKUuIo span.e1DMQNBPJ_')
        price = price_tag.get_text(strip=True) if price_tag else "0"
        
        # 원가 (할인 전)
        original_price_tag = soup.select_one('del.VaZJPclpdJ span.e1DMQNBPJ_')
        original_price = original_price_tag.get_text(strip=True) if original_price_tag else price

        # 할인율
        discount_tag = soup.select_one('.ZrsHt2mzIY span.blind')
        discount_rate = discount_tag.get_text(strip=True) if discount_tag else "0%"

        # 3. 평점 및 리뷰
        # 평점 (4.8 등)
        rating_tag = soup.select_one('.nI8wdMPKHV.AofCh70CRy strong.rIXQgoa8Xl')
        rating_text = rating_tag.get_text(strip=True) if rating_tag else "0.0"
        # "평점4.8" -> "4.8"
        rating = rating_text.replace("평점", "").strip()

        # 리뷰수
        review_count_tag = soup.select_one('a[href="#REVIEW"] strong.rIXQgoa8Xl')
        review_count = review_count_tag.get_text(strip=True) if review_count_tag else "0"

        # 4. 스토어/제조사 정보
        # splugin data-source-name에서 "브랜드스토어 > 스토어명" 형태로 존재함
        splugin = soup.select_one('.naver-splugin')
        store_full = splugin['data-source-name'] if splugin and splugin.has_attr('data-source-name') else "알 수 없음"
        store_name = store_full.split('>')[-1].strip() if '>' in store_full else store_full

        # 5. 리뷰 텍스트 추출 (최대 4개)
        reviews = []
        review_elements = soup.select('.vhlVUsCtw3 span.K0kwJOXP06')[:4]
        if not review_elements:
            # alternative selector if first one fails
            review_elements = soup.select('.vhlVUsCtw3')[:4]
            
        for rev in review_elements:
            text = rev.get_text(strip=True)
            if text:
                reviews.append(text)

        # 6. 상품 이미지 URL 리스트 추출
        image_urls = []
        # 대표 이미지 (고화질 유도)
        main_img = soup.select_one('img.TgO1N1wWTm')
        if main_img and main_img.has_attr('src'):
            src = main_img['src'].split('?')[0] + "?type=m1000_pd"
            image_urls.append(src)
            
        # 추가 이미지 (썸네일 리스트 전체)
        sub_imgs = soup.select('img.fxmqPhYp6y')
        for simg in sub_imgs:
            if simg.has_attr('src'):
                # 썸네일도 고화질로 유도
                src = simg['src'].split('?')[0] + "?type=m1000_pd"
                if src not in image_urls:
                    image_urls.append(src)

        results = {
            "상품명": title,
            "할인가": f"{price}원",
            "원가": f"{original_price}원",
            "할인율": discount_rate,
            "평점": rating,
            "리뷰수": review_count,
            "스토어": store_name,
            "리뷰": reviews,
            "이미지리스트": image_urls
        }
        return results

    def format_results(self, data, url):
        lines = []
        lines.append(f"=== 분석 결과 ===")
        lines.append(f"상품명: {data['상품명']}")
        lines.append(f"스토어: {data['스토어']}")
        lines.append(f"가격: {data['할인가']} (원가: {data['원가']} | 할인율: {data['할인율']})")
        lines.append(f"평점: {data['평점']} / 리뷰수: {data['리뷰수']}")
        
        if data.get('리뷰'):
            lines.append(f"\n[주요 리뷰 {len(data['리뷰'])}건]")
            for i, rev in enumerate(data['리뷰'], 1):
                lines.append(f"{i}. {rev}")
        
        lines.append(f"\n분석 일시: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"URL: {url}")
        return "\n".join(lines)

    def analyze_keyword(self, keyword, url, keep_open=False):
        """
        keyword: 분석 명칭
        url: 타겟 URL
        keep_open: True일 경우 드라이버를 닫지 않고 재사용 가능하도록 함
        """
        print(f"Starting analysis for keyword: {keyword} with URL: {url}")
        
        driver = self.setup_driver()

        try:
            target_url = self.filter_url(url)
            driver.get(target_url)
            time.sleep(4) 

            # 스크롤 최하단까지 이동하여 모든 요소를 로드 (필요시)
            # self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            # time.sleep(2)

            html_source = driver.page_source
            data = self.parse_product_html(html_source)
            
            output_content = self.format_results(data, url)
            self.save_to_txt(keyword, output_content)
            
            # 이미지 다운로드
            if data.get('이미지리스트'):
                self.download_images(keyword, data['이미지리스트'])
            
            return True, f"[{keyword}] 분석 및 이미지 저장 완료."
        except Exception as e:
            import traceback
            traceback.print_exc()
            return False, f"[{keyword}] 오류: {str(e)}"
        finally:
            if not keep_open:
                self.close_driver()

    def close_driver(self):
        if self.driver:
            self.driver.quit()
            self.driver = None

    def download_images(self, keyword, image_urls):
        """
        이미지 URL 리스트를 받아 파일로 저장합니다.
        '네이버/키워드명' 디렉토리에 저장합니다.
        """
        base_dir = "네이버"
        keyword_dir = keyword.strip()
        directory = os.path.join(base_dir, keyword_dir)
        
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        for i, url in enumerate(image_urls, 1):
            try:
                response = requests.get(url, headers=headers, timeout=15)
                if response.status_code == 200:
                    filename = f"{keyword}_{i}.jpg"
                    filepath = os.path.join(directory, filename)
                    with open(filepath, 'wb') as f:
                        f.write(response.content)
                    print(f"Image saved: {filepath}")
                else: # m1000_pd 실패 시 원본 시도
                    original_url = url.split('?')[0]
                    response = requests.get(original_url, headers=headers, timeout=15)
                    if response.status_code == 200:
                        filename = f"{keyword}_{i}.jpg"
                        filepath = os.path.join(directory, filename)
                        with open(filepath, 'wb') as f:
                            f.write(response.content)
            except Exception as e:
                print(f"Image download error ({url}): {e}")

    def save_to_txt(self, keyword, content):
        """
        '네이버/키워드명' 디렉토리를 생성하고, 그 안에 키워드명.txt 파일을 저장합니다.
        """
        # 디렉토리 생성
        base_dir = "네이버"
        keyword_dir = keyword.strip()
        directory = os.path.join(base_dir, keyword_dir)
        
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)
            print(f"Directory created: {directory}")
            
        # 파일 저장
        filename = os.path.join(directory, f"{keyword}.txt")
        with open(filename, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"File saved: {filename}")

if __name__ == "__main__":
    # Test logic with provided HTML (optional but ensures parsing works)
    pass
