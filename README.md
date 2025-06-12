# 브랜드 홈페이지 수집기

네이버 검색 API를 활용한 한국 패션 브랜드 홈페이지 수집기 (재시작 기능 포함)

## 🚀 주요 기능

### ⭐ 핵심 특징
- **영문명 기반 도메인 추측** - 96% 높은 성공률
- **재시작 기능** - 중단된 작업을 이어서 진행
- **배치별 저장** - 안전한 중간 저장 시스템
- **API 효율성** - 도메인 추측으로 85% API 절약
- **한국 브랜드 특화** - .co.kr 도메인 우선 탐지

### 🔧 작동 방식
1. **1단계**: 영문 브랜드명으로 도메인 추측 (couronne.co.kr 등)
2. **2단계**: 실패 시 네이버 검색 API로 보완
3. **점수 시스템**: 도메인 매치(+100점), 공식 키워드(+40점) 등
4. **자동 재시작**: 이전 작업 파일 자동 감지 및 이어서 진행

## 📦 설치 및 설정

### 1. 프로젝트 클론
```bash
git clone https://github.com/DevJihwan/brand-website-collector.git
cd brand-website-collector
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 네이버 API 키 설정

#### 방법 1: 환경변수 설정 (권장)
```bash
export NAVER_CLIENT_ID="your_actual_client_id"
export NAVER_CLIENT_SECRET="your_actual_client_secret"
```

#### 방법 2: 코드에서 직접 설정
`naver-brand-website-collector.js` 파일의 main() 함수에서:
```javascript
const clientId = 'your_actual_client_id';
const clientSecret = 'your_actual_client_secret';
```

### 4. 브랜드 데이터 파일 준비
`musinsa_brands_merged.json` 파일을 프로젝트 루트에 배치하거나,
코드에서 파일 경로를 수정하세요.

## 🎯 사용법

### 기본 실행
```bash
npm start
```

### 재시작 기능
- 프로그램이 중단되었을 때 다시 실행하면 **자동으로 이전 작업을 감지**
- 이미 처리된 브랜드는 건너뛰고 **101번째 브랜드부터 이어서 진행**
- 중간 저장 파일을 자동으로 찾아 상태를 복원

### 출력 파일
- `naver_brand_batch_N_timestamp.json` - 배치별 결과
- `naver_brand_intermediate_batchN_timestamp.json` - 중간 저장 파일
- `naver_brand_final_results_timestamp.json` - 최종 결과 (JSON)
- `naver_brand_websites_timestamp.csv` - 최종 결과 (CSV)

## 📊 성능 지표

### 테스트 결과 (100개 브랜드)
- **성공률**: 96%
- **API 사용량**: 36/25,000 (0.1%)
- **처리 시간**: 926초
- **도메인 추측 성공**: 85% (API 절약)

### 전체 8,200개 브랜드 예상
- **예상 성공률**: 90-95%
- **예상 API 사용량**: ~3,000건 (12%)
- **예상 처리 시간**: 6-8시간
- **API 절약**: 85% (도메인 추측 덕분)

## 🔍 도메인 추측 패턴

### 우선순위 순서
1. `brandname.co.kr` ← 한국 브랜드 1순위
2. `www.brandname.co.kr`
3. `brandname.kr`
4. `brandname.com` ← 글로벌 브랜드
5. `shop.brandname.com` ← 쇼핑몰 패턴
6. 기타 패턴들...

### 예시
- 쿠론 (COURONNE) → `couronne.co.kr` ✅
- 레스포색 (LESPORTSAC) → `lesportsac.com` ✅
- 마스마룰즈 (MASMARULEZ) → `masmarulez.com` ✅

## 📈 점수 시스템

### 가산점
- **도메인 매치**: +100점 (가장 높음)
- **공식 키워드**: +40점
- **.co.kr 도메인**: +25점
- **브랜드 키워드**: +30점
- **홈페이지 키워드**: +20점

### 감점
- **쇼핑몰 키워드**: -10점
- **소셜미디어/블로그**: -20점

## 🛠️ 설정 옵션

### 배치 크기 조정
```javascript
const batchSize = 50; // 기본값, 필요에 따라 조정
```

### API 요청 속도 제한
```javascript
this.requestsPerSecond = 8; // 안전하게 8건으로 제한
```

### 제외 도메인 추가
```javascript
this.excludeDomains = [
    'musinsa.com', 'ably.co.kr', '29cm.co.kr',
    // 추가 도메인...
];
```

## 🚨 주의사항

### API 제한
- **일일 한도**: 25,000건
- **초당 제한**: 10건 (안전하게 8건으로 설정)
- **도메인 추측**: API 사용량 85% 절약

### 파일 관리
- 중간 저장 파일들이 많이 생성될 수 있음
- 정기적으로 불필요한 파일 정리 권장
- 최종 결과 파일만 보관하면 됨

## 🔧 문제 해결

### 네이버 API 오류
```
❌ API 오류 429: Too Many Requests
```
→ 잠시 대기 후 자동으로 재시도됩니다.

### 브랜드 파일 오류
```
❌ 브랜드 파일을 찾을 수 없습니다
```
→ 파일 경로와 파일명을 확인하세요.

### 재시작 문제
```
⚠️ 이전 작업 파일 로드 실패
```
→ 새로운 작업으로 시작됩니다. 정상적인 동작입니다.

## 📝 데이터 형식

### 입력 파일 (JSON)
```json
{
  "allBrands": [
    {
      "brand": "couronne",
      "brandName": "쿠론",
      "brandNameEnglish": "COURONNE",
      "isBest": false,
      "sourceCategory": "가방"
    }
  ]
}
```

### 출력 파일 (CSV)
```csv
Brand Name,English Name,Category,Primary Website,Search Method,Status
쿠론,COURONNE,가방,https://couronne.co.kr,domain_guessed,found
```

## 🤝 기여하기

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 라이센스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 👨‍💻 개발자

**DevJihwan**
- GitHub: [@DevJihwan](https://github.com/DevJihwan)

---

## 📚 추가 정보

### 관련 프로젝트
- [네이버 쇼핑 API 테스트](https://github.com/DevJihwan/naver-shopping-api-test)
- [공유오피스 찾기](https://github.com/DevJihwan/shared-office-finder)

### 버전 히스토리
- **v1.0.0**: 초기 릴리즈 (재시작 기능 포함)
- 영문명 기반 도메인 추측 알고리즘
- 96% 성공률 달성
- 배치별 저장 시스템

---

**🎯 목표**: 한국 패션 브랜드의 공식 홈페이지를 효율적으로 수집하여 브랜드 분석 및 마케팅에 활용할 수 있는 데이터를 제공합니다.