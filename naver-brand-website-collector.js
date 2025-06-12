const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/**
 * 네이버 검색 API를 활용한 한국 패션 브랜드 홈페이지 수집기 (재시작 기능 포함)
 */
class NaverBrandWebsiteCollector {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.baseUrl = 'https://openapi.naver.com/v1/search/webkr.json';
        
        this.results = [];
        this.failed = [];
        this.cache = new Map();
        
        // 네이버 API 제한: 일일 25,000건, 초당 10건
        this.dailyLimit = 25000;
        this.requestsPerSecond = 8; // 안전하게 8건으로 제한
        this.delay = Math.ceil(1000 / this.requestsPerSecond); // 125ms
        
        this.requestCount = 0;
        this.startTime = Date.now();
        
        // 한국 도메인 패턴
        this.koreanDomains = ['.co.kr', '.com', '.kr', '.net'];
        
        // 제외할 도메인들 (쇼핑몰, 포털 등)
        this.excludeDomains = [
            'naver.com', 'daum.net', 'google.com', 'youtube.com',
            'instagram.com', 'facebook.com', 'twitter.com',
            'musinsa.com', 'ably.co.kr', '29cm.co.kr', 'zigzag.kr',
            'brandi.co.kr', 'styleshare.kr', 'wconcept.co.kr'
        ];
    }

    /**
     * 브랜드 파일에서 브랜드 목록 로드
     */
    loadBrandsFromFile(filePath) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            let brands = [];
            if (data.allBrands && Array.isArray(data.allBrands)) {
                brands = data.allBrands;
            } else if (Array.isArray(data)) {
                brands = data;
            }
            
            this.brands = brands.map(brand => ({
                brandName: brand.brandName || brand.name,
                brandNameEnglish: brand.brandNameEnglish || brand.englishName,
                brand: brand.brand || brand.id,
                category: brand.sourceCategory || brand.category || 'unknown',
                isBest: brand.isBest || false,
                original: brand
            })).filter(brand => brand.brandName); // 브랜드명이 있는 것만
            
            console.log(`📁 브랜드 로드 완료: ${this.brands.length}개`);
            return this.brands;
            
        } catch (error) {
            console.error('❌ 브랜드 파일 읽기 실패:', error.message);
            throw error;
        }
    }

    /**
     * 이전 작업에서 이어서 시작 (재시작 기능)
     */
    loadIntermediateResults() {
        try {
            // 가장 최근의 중간 저장 파일 찾기
            const files = fs.readdirSync(__dirname);
            const intermediateFiles = files
                .filter(file => file.startsWith('naver_brand_intermediate_') || file.startsWith('naver_brand_final_results_'))
                .sort()
                .reverse(); // 최신 파일 우선
            
            if (intermediateFiles.length === 0) {
                console.log('💡 새로운 작업을 시작합니다.');
                return null;
            }
            
            const latestFile = intermediateFiles[0];
            console.log(`🔄 이전 작업 파일 발견: ${latestFile}`);
            
            const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
            
            // 기존 결과 복원
            this.results = data.successResults || [];
            this.failed = data.failedResults || [];
            this.requestCount = data.requestCount || 0;
            
            console.log(`📋 이전 작업 상태 복원:`);
            console.log(`   성공: ${this.results.length}개`);
            console.log(`   실패: ${this.failed.length}개`);
            console.log(`   총 처리: ${this.results.length + this.failed.length}개`);
            console.log(`   API 사용량: ${this.requestCount}/${this.dailyLimit}`);
            
            return data;
            
        } catch (error) {
            console.log('⚠️ 이전 작업 파일 로드 실패, 새로운 작업을 시작합니다.');
            console.log(`   오류: ${error.message}`);
            return null;
        }
    }

    /**
     * 이미 처리된 브랜드 제외
     */
    filterUnprocessedBrands(brands, processedResults) {
        if (!processedResults) return brands;
        
        const processedBrandNames = new Set();
        
        // 성공/실패한 브랜드명 수집
        [...(processedResults.successResults || []), ...(processedResults.failedResults || [])]
            .forEach(result => {
                if (result.brandName) {
                    processedBrandNames.add(result.brandName.toLowerCase().trim());
                }
            });
        
        const unprocessedBrands = brands.filter(brand => 
            !processedBrandNames.has(brand.brandName.toLowerCase().trim())
        );
        
        console.log(`🔄 필터링 결과:`);
        console.log(`   전체 브랜드: ${brands.length}개`);
        console.log(`   이미 처리됨: ${brands.length - unprocessedBrands.length}개`);
        console.log(`   남은 브랜드: ${unprocessedBrands.length}개`);
        
        return unprocessedBrands;
    }

    /**
     * 네이버 검색 API 호출
     */
    async searchNaver(query, display = 10) {
        try {
            this.requestCount++;
            
            // API 제한 확인
            if (this.requestCount > this.dailyLimit) {
                throw new Error('일일 API 요청 제한 초과');
            }
            
            const params = {
                query: query,
                display: display, // 검색 결과 개수 (최대 100)
                start: 1,
                sort: 'sim' // sim(유사도순), date(날짜순)
            };
            
            const headers = {
                'X-Naver-Client-Id': this.clientId,
                'X-Naver-Client-Secret': this.clientSecret,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };
            
            console.log(`🔍 네이버 검색: "${query}"`);
            
            const response = await axios.get(this.baseUrl, {
                params: params,
                headers: headers,
                timeout: 10000
            });
            
            if (response.status === 200) {
                const data = response.data;
                console.log(`   ✅ ${data.items?.length || 0}개 결과 반환`);
                return data.items || [];
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
            
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const errorMsg = error.response.data?.errorMessage || error.message;
                
                if (status === 429) {
                    console.log('   ⚠️ API 요청 제한 - 대기 중...');
                    await this.sleep(5000); // 5초 대기
                    throw new Error('API 요청 제한');
                } else if (status === 400) {
                    throw new Error(`잘못된 검색어: ${errorMsg}`);
                } else {
                    throw new Error(`API 오류 ${status}: ${errorMsg}`);
                }
            } else {
                throw new Error(`네트워크 오류: ${error.message}`);
            }
        }
    }

    /**
     * 브랜드의 공식 홈페이지 찾기
     */
    async findBrandWebsite(brand) {
        const brandName = brand.brandName;
        const brandNameEnglish = brand.brandNameEnglish;
        
        console.log(`\n🎯 [${this.results.length + this.failed.length + 1}] ${brandName} ${brandNameEnglish ? `(${brandNameEnglish})` : ''}`);
        
        // 캐시 확인
        const cacheKey = brandName.toLowerCase();
        if (this.cache.has(cacheKey)) {
            console.log('   📋 캐시에서 발견');
            return { ...this.cache.get(cacheKey), fromCache: true };
        }
        
        const result = {
            brandName,
            brandNameEnglish,
            category: brand.category,
            isBest: brand.isBest,
            websites: [],
            searchQueries: [],
            guessedDomains: [],
            searchMethod: null,
            status: 'searching'
        };
        
        try {
            // 1단계: 영문 브랜드명으로 도메인 추측 (가장 확률 높음)
            if (brandNameEnglish) {
                console.log(`   🔮 영문명으로 도메인 추측: ${brandNameEnglish}`);
                const guessedWebsite = await this.guessBrandDomainFromEnglishName(brandNameEnglish);
                
                if (guessedWebsite) {
                    result.websites.push(guessedWebsite.url);
                    result.guessedDomains.push(guessedWebsite);
                    result.searchMethod = 'domain_guessed';
                    console.log(`   ✅ 도메인 추측 성공: ${guessedWebsite.url}`);
                    
                    // 추측 성공 시 바로 반환 (가장 정확할 가능성 높음)
                    result.status = 'found';
                    result.primaryWebsite = guessedWebsite.url;
                    this.cache.set(cacheKey, result);
                    return result;
                }
            }
            
            // 2단계: 네이버 검색으로 보완
            console.log(`   🔍 네이버 검색으로 보완 중...`);
            const searchQueries = this.generateSearchQueries(brandName, brandNameEnglish);
            
            for (const query of searchQueries) {
                try {
                    result.searchQueries.push(query);
                    
                    const searchResults = await this.searchNaver(query, 20);
                    const websites = this.extractOfficialWebsites(searchResults, brandName, brandNameEnglish);
                    
                    if (websites.length > 0) {
                        result.websites.push(...websites);
                        result.searchMethod = result.searchMethod || 'naver_search';
                        console.log(`   ✅ "${query}"로 ${websites.length}개 웹사이트 발견`);
                        break; // 첫 번째 성공한 검색어로 충분
                    } else {
                        console.log(`   ❌ "${query}" 결과 없음`);
                    }
                    
                    await this.sleep(this.delay);
                    
                } catch (error) {
                    console.log(`   ❌ "${query}" 검색 실패: ${error.message}`);
                    
                    if (error.message.includes('API 요청 제한')) {
                        await this.sleep(5000);
                        continue;
                    }
                }
            }
            
            // 결과 정리
            result.websites = [...new Set(result.websites)]; // 중복 제거
            result.status = result.websites.length > 0 ? 'found' : 'not_found';
            
            if (result.websites.length > 0) {
                result.primaryWebsite = result.websites[0];
                console.log(`   🎯 최종 결과: ${result.primaryWebsite} (${result.searchMethod})`);
            } else {
                console.log(`   ❌ 웹사이트를 찾을 수 없습니다`);
            }
            
            // 캐시에 저장
            this.cache.set(cacheKey, result);
            
            return result;
            
        } catch (error) {
            console.log(`   ❌ 검색 중 오류: ${error.message}`);
            result.status = 'error';
            result.error = error.message;
            return result;
        }
    }

    /**
     * 영문 브랜드명으로 도메인 추측 (가장 정확한 방법)
     */
    async guessBrandDomainFromEnglishName(brandNameEnglish) {
        if (!brandNameEnglish) return null;
        
        // 영문명 정리 (특수문자 제거, 소문자 변환, 공백 제거)
        const cleanName = brandNameEnglish
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '') // 특수문자 제거
            .replace(/\s+/g, ''); // 공백 제거
        
        if (cleanName.length < 2) return null;
        
        // 한국 패션 브랜드에 일반적인 도메인 패턴들 (우선순위 순)
        const domainPatterns = [
            // 한국 도메인 우선
            `${cleanName}.co.kr`,
            `www.${cleanName}.co.kr`,
            `${cleanName}.kr`,
            
            // 글로벌 도메인
            `${cleanName}.com`,
            `www.${cleanName}.com`,
            
            // 쇼핑몰/스토어 패턴
            `shop.${cleanName}.com`,
            `store.${cleanName}.com`,
            `${cleanName}shop.co.kr`,
            `${cleanName}store.co.kr`,
            
            // 기타 패턴
            `${cleanName}.net`,
            `${cleanName}korea.com`,
            `${cleanName}.co.kr`,
            
            // 브랜드명에 하이픈이 포함될 수 있는 경우 대비
            ...(brandNameEnglish.includes(' ') ? [
                `${brandNameEnglish.toLowerCase().replace(/\s+/g, '-')}.com`,
                `${brandNameEnglish.toLowerCase().replace(/\s+/g, '-')}.co.kr`
            ] : [])
        ];
        
        console.log(`     도메인 패턴 ${domainPatterns.length}개 확인 중...`);
        
        // 각 도메인 패턴을 순서대로 확인
        for (let i = 0; i < domainPatterns.length; i++) {
            const domain = domainPatterns[i];
            
            try {
                const result = await this.checkDomainExists(domain);
                
                if (result.exists) {
                    console.log(`     ✅ [${i + 1}/${domainPatterns.length}] ${result.finalUrl} 발견!`);
                    return {
                        originalDomain: domain,
                        url: result.finalUrl,
                        statusCode: result.statusCode,
                        redirected: result.redirected,
                        score: this.calculateDomainScore(domain, brandNameEnglish, i)
                    };
                } else {
                    console.log(`     ❌ [${i + 1}/${domainPatterns.length}] ${domain} 없음`);
                }
                
                // 도메인 확인 간 짧은 대기 (너무 빠른 요청 방지)
                await this.sleep(200);
                
            } catch (error) {
                console.log(`     ⚠️ [${i + 1}/${domainPatterns.length}] ${domain} 확인 실패: ${error.message}`);
            }
        }
        
        return null;
    }

    /**
     * 도메인 존재 여부 확인 (개선된 버전)
     */
    async checkDomainExists(domain) {
        const protocols = ['https://', 'http://'];
        
        for (const protocol of protocols) {
            try {
                const url = protocol + domain;
                
                const response = await axios.head(url, {
                    timeout: 5000,
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500; // 4xx도 존재하는 것으로 간주
                    },
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                // 성공적인 응답이거나 인증/권한 오류인 경우
                if (response.status >= 200 && response.status < 400) {
                    return {
                        exists: true,
                        finalUrl: response.request.res.responseUrl || url,
                        statusCode: response.status,
                        redirected: response.request.res.responseUrl !== url
                    };
                } else if (response.status === 401 || response.status === 403) {
                    // 인증 오류 = 사이트는 존재하지만 접근 제한
                    return {
                        exists: true,
                        finalUrl: url,
                        statusCode: response.status,
                        redirected: false
                    };
                }
                
            } catch (error) {
                // HTTPS 실패 시 HTTP 시도, HTTP도 실패하면 다음으로
                if (protocol === 'http://') {
                    // 두 프로토콜 모두 실패
                    break;
                }
                continue;
            }
        }
        
        return { exists: false, domain };
    }

    /**
     * 도메인 점수 계산 (우선순위 반영)
     */
    calculateDomainScore(domain, brandNameEnglish, patternIndex) {
        let score = 100 - patternIndex; // 패턴 우선순위 (앞선 패턴일수록 높은 점수)
        
        // 한국 도메인 보너스
        if (domain.includes('.co.kr')) {
            score += 30;
        } else if (domain.includes('.kr')) {
            score += 20;
        } else if (domain.includes('.com')) {
            score += 10;
        }
        
        // www 없는 도메인 선호
        if (!domain.startsWith('www.')) {
            score += 5;
        }
        
        // 브랜드명과 정확히 일치하는 경우
        const cleanBrandName = brandNameEnglish.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (domain.startsWith(cleanBrandName + '.') || domain.includes('.' + cleanBrandName + '.')) {
            score += 50;
        }
        
        return score;
    }

    generateSearchQueries(brandName, brandNameEnglish) {
        const queries = [];
        
        // 1. 한글 브랜드명 + "공식홈페이지"
        queries.push(`${brandName} 공식홈페이지`);
        
        // 2. 한글 브랜드명 + "브랜드" + "홈페이지"
        queries.push(`${brandName} 브랜드 홈페이지`);
        
        // 3. 영문 브랜드명이 있으면 추가
        if (brandNameEnglish && brandNameEnglish !== brandName) {
            queries.push(`${brandNameEnglish} 공식홈페이지`);
            queries.push(`${brandNameEnglish} brand homepage`);
        }
        
        // 4. 한글 + 영문 조합
        if (brandNameEnglish && brandNameEnglish !== brandName) {
            queries.push(`${brandName} ${brandNameEnglish} 홈페이지`);
        }
        
        // 5. 간단한 브랜드명만
        queries.push(brandName);
        
        return queries;
    }

    /**
     * 검색 결과에서 공식 웹사이트 추출 (영문명 기반 강화)
     */
    extractOfficialWebsites(searchResults, brandName, brandNameEnglish) {
        const websites = [];
        const brandKeywords = [
            brandName.toLowerCase(),
            brandNameEnglish?.toLowerCase()
        ].filter(Boolean);
        
        // 영문 브랜드명 정리 (도메인 매칭용)
        const cleanEnglishName = brandNameEnglish 
            ? brandNameEnglish.toLowerCase().replace(/[^a-z0-9]/g, '') 
            : null;
        
        for (const item of searchResults) {
            const url = item.link;
            const title = this.cleanText(item.title);
            const description = this.cleanText(item.description);
            
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                
                // 제외할 도메인인지 확인
                if (this.excludeDomains.some(domain => hostname.includes(domain))) {
                    continue;
                }
                
                // 영문 브랜드명이 도메인에 포함되어 있는지 우선 확인 (가장 중요)
                let isDomainMatch = false;
                if (cleanEnglishName) {
                    isDomainMatch = hostname.includes(cleanEnglishName) || 
                                   hostname.startsWith(cleanEnglishName + '.') ||
                                   hostname.includes('.' + cleanEnglishName + '.') ||
                                   hostname.endsWith('.' + cleanEnglishName);
                }
                
                // 공식 웹사이트인지 판단
                const isOfficial = isDomainMatch || 
                    this.isLikelyOfficialWebsite(url, hostname, title, description, brandKeywords);
                
                if (isOfficial) {
                    const score = this.calculateWebsiteScore(
                        hostname, title, description, brandKeywords, cleanEnglishName, isDomainMatch
                    );
                    
                    websites.push({
                        url: url,
                        title: title,
                        description: description,
                        hostname: hostname,
                        isDomainMatch: isDomainMatch,
                        score: score
                    });
                    
                    console.log(`     🔍 후보: ${hostname} (점수: ${score}${isDomainMatch ? ', 도메인 매치' : ''})`);
                }
                
            } catch (error) {
                // 잘못된 URL 무시
                continue;
            }
        }
        
        // 점수순으로 정렬 (도메인 매치 > 높은 점수 > 한국 도메인 순)
        websites.sort((a, b) => {
            // 도메인 매치 우선
            if (a.isDomainMatch && !b.isDomainMatch) return -1;
            if (!a.isDomainMatch && b.isDomainMatch) return 1;
            
            // 같은 도메인 매치 상태면 점수로 비교
            if (b.score !== a.score) return b.score - a.score;
            
            // 점수도 같으면 한국 도메인 우선
            const aIsKorean = a.hostname.includes('.co.kr') || a.hostname.includes('.kr');
            const bIsKorean = b.hostname.includes('.co.kr') || b.hostname.includes('.kr');
            if (aIsKorean && !bIsKorean) return -1;
            if (!aIsKorean && bIsKorean) return 1;
            
            return 0;
        });
        
        // 상위 3개 결과만 반환 (너무 많은 결과 방지)
        return websites.slice(0, 3).map(w => w.url);
    }

    /**
     * 공식 웹사이트인지 판단
     */
    isLikelyOfficialWebsite(url, hostname, title, description, brandKeywords) {
        // 1. 도메인에 브랜드명이 포함되어 있으면 높은 점수
        for (const keyword of brandKeywords) {
            if (hostname.includes(keyword.replace(/\s+/g, ''))) {
                return true;
            }
        }
        
        // 2. 제목이나 설명에 "공식", "브랜드", "홈페이지" 등이 포함
        const officialKeywords = ['공식', '브랜드', '홈페이지', 'official', 'brand', 'homepage'];
        const textContent = (title + ' ' + description).toLowerCase();
        
        const hasOfficialKeyword = officialKeywords.some(keyword => 
            textContent.includes(keyword)
        );
        
        const hasBrandKeyword = brandKeywords.some(keyword =>
            textContent.includes(keyword)
        );
        
        // 3. 한국 도메인 우선 (.co.kr, .com)
        const isKoreanDomain = this.koreanDomains.some(suffix => hostname.endsWith(suffix));
        
        return hasOfficialKeyword && hasBrandKeyword && isKoreanDomain;
    }

    /**
     * 웹사이트 점수 계산 (영문명 도메인 매치 강화)
     */
    calculateWebsiteScore(hostname, title, description, brandKeywords, cleanEnglishName, isDomainMatch) {
        let score = 0;
        const textContent = (title + ' ' + description).toLowerCase();
        
        // 🏆 영문 브랜드명이 도메인에 포함 (+100점) - 가장 높은 점수
        if (isDomainMatch) {
            score += 100;
            console.log(`         +100점: 도메인 매치 (${hostname})`);
        }
        
        // 도메인에 브랜드명 포함 (한글 브랜드명으로)
        for (const keyword of brandKeywords) {
            const cleanKeyword = keyword.replace(/\s+/g, '');
            if (hostname.includes(cleanKeyword)) {
                score += 60;
                console.log(`         +60점: 도메인에 브랜드명 포함 (${cleanKeyword})`);
                break; // 중복 점수 방지
            }
        }
        
        // 공식 키워드 (+40점)
        if (textContent.includes('공식') || textContent.includes('official')) {
            score += 40;
            console.log(`         +40점: 공식 키워드`);
        }
        
        // 브랜드 키워드 (+30점)
        if (textContent.includes('브랜드') || textContent.includes('brand')) {
            score += 30;
            console.log(`         +30점: 브랜드 키워드`);
        }
        
        // 한국 도메인 보너스 (+25점)
        if (hostname.endsWith('.co.kr')) {
            score += 25;
            console.log(`         +25점: .co.kr 도메인`);
        } else if (hostname.endsWith('.kr')) {
            score += 20;
            console.log(`         +20점: .kr 도메인`);
        } else if (hostname.endsWith('.com')) {
            score += 10;
            console.log(`         +10점: .com 도메인`);
        }
        
        // 홈페이지/메인페이지 키워드 (+20점)
        if (textContent.includes('홈페이지') || textContent.includes('homepage') || 
            textContent.includes('메인') || textContent.includes('main')) {
            score += 20;
            console.log(`         +20점: 홈페이지 키워드`);
        }
        
        // 쇼핑몰 키워드 감점 (-10점)
        if (textContent.includes('쇼핑몰') || textContent.includes('쇼핑') || 
            textContent.includes('shop') || textContent.includes('store') ||
            hostname.includes('shop') || hostname.includes('store')) {
            score -= 10;
            console.log(`         -10점: 쇼핑몰 키워드`);
        }
        
        // 소셜미디어/블로그 감점 (-20점)
        if (hostname.includes('blog') || hostname.includes('instagram') || 
            hostname.includes('facebook') || hostname.includes('naver.com') ||
            textContent.includes('블로그') || textContent.includes('인스타')) {
            score -= 20;
            console.log(`         -20점: 소셜미디어/블로그`);
        }
        
        // www 없는 도메인 선호 (+5점)
        if (!hostname.startsWith('www.')) {
            score += 5;
            console.log(`         +5점: www 없는 깔끔한 도메인`);
        }
        
        return Math.max(0, score); // 최소 0점
    }

    /**
     * HTML 태그 제거 및 텍스트 정리
     */
    cleanText(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]*>/g, '') // HTML 태그 제거
            .replace(/&[^;]+;/g, ' ') // HTML 엔티티 제거
            .replace(/\s+/g, ' ') // 연속 공백 제거
            .trim();
    }

    /**
     * 배치 처리로 브랜드 검색 (개선된 전체 처리 버전)
     */
    async processBrandsBatch(brands, batchSize = 50) {
        console.log(`\n🚀 ${brands.length}개 브랜드 배치 처리 시작 (배치 크기: ${batchSize})`);
        
        const batches = this.chunkArray(brands, batchSize);
        const allResults = [];
        const startTime = Date.now();
        
        console.log(`📊 처리 계획:`);
        console.log(`   - 총 배치 수: ${batches.length}개`);
        console.log(`   - 예상 소요 시간: ${Math.ceil(batches.length * 2)}분`);
        console.log(`   - 예상 API 사용량: ${Math.ceil(brands.length * 0.15)}건`);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchStartTime = Date.now();
            
            console.log(`\n📦 ========== 배치 ${i + 1}/${batches.length} ==========`);
            console.log(`처리 중: ${batch.length}개 브랜드`);
            console.log(`전체 진행률: ${(i / batches.length * 100).toFixed(1)}%`);
            
            const batchResults = [];
            let batchSuccessCount = 0;
            let batchDomainGuessCount = 0;
            let batchApiUsageCount = 0;
            
            for (let j = 0; j < batch.length; j++) {
                const brand = batch[j];
                const brandStartTime = Date.now();
                const currentApiUsage = this.requestCount;
                
                try {
                    console.log(`\n[${j + 1}/${batch.length}] 처리 중...`);
                    const result = await this.findBrandWebsite(brand);
                    batchResults.push(result);
                    
                    // 통계 업데이트
                    if (result.status === 'found') {
                        this.results.push(result);
                        batchSuccessCount++;
                        
                        if (result.searchMethod === 'domain_guessed') {
                            batchDomainGuessCount++;
                        }
                    } else {
                        this.failed.push(result);
                    }
                    
                    // 이번 브랜드에서 사용한 API 호출 수
                    const brandApiUsage = this.requestCount - currentApiUsage;
                    batchApiUsageCount += brandApiUsage;
                    
                    const brandTime = Date.now() - brandStartTime;
                    console.log(`   ⏱️ 처리 시간: ${(brandTime/1000).toFixed(1)}초, API 사용: ${brandApiUsage}건`);
                    
                } catch (error) {
                    console.log(`   ❌ ${brand.brandName} 처리 실패: ${error.message}`);
                    const errorResult = {
                        brandName: brand.brandName,
                        brandNameEnglish: brand.brandNameEnglish,
                        status: 'error',
                        error: error.message,
                        searchMethod: 'error'
                    };
                    batchResults.push(errorResult);
                    this.failed.push(errorResult);
                }
                
                // 브랜드 간 대기 (짧게)
                if (j < batch.length - 1) {
                    await this.sleep(this.delay);
                }
            }
            
            // 배치별 결과 저장
            this.saveBatchResults(batchResults, i);
            
            // 배치 완료 통계
            const batchTime = (Date.now() - batchStartTime) / 1000;
            const totalTime = (Date.now() - startTime) / 1000;
            const remainingBatches = batches.length - i - 1;
            const avgTimePerBatch = totalTime / (i + 1);
            const estimatedRemainingTime = remainingBatches * avgTimePerBatch;
            
            console.log(`\n📊 ========== 배치 ${i + 1} 완료 ==========`);
            console.log(`⏱️ 배치 처리 시간: ${batchTime.toFixed(1)}초`);
            console.log(`📈 배치 결과:`);
            console.log(`   - 성공: ${batchSuccessCount}/${batch.length}개 (${(batchSuccessCount/batch.length*100).toFixed(1)}%)`);
            console.log(`   - 도메인 추측 성공: ${batchDomainGuessCount}개`);
            console.log(`   - API 사용량: ${batchApiUsageCount}건`);
            
            console.log(`🔄 전체 진행 상황:`);
            console.log(`   - 완료된 배치: ${i + 1}/${batches.length}개`);
            console.log(`   - 전체 진행률: ${((i + 1) / batches.length * 100).toFixed(1)}%`);
            console.log(`   - 누적 성공: ${this.results.length}개`);
            console.log(`   - 누적 실패: ${this.failed.length}개`);
            console.log(`   - 전체 성공률: ${(this.results.length / (this.results.length + this.failed.length) * 100).toFixed(1)}%`);
            console.log(`   - 총 API 사용량: ${this.requestCount}/${this.dailyLimit} (${(this.requestCount / this.dailyLimit * 100).toFixed(2)}%)`);
            
            if (remainingBatches > 0) {
                console.log(`⏳ 예상 남은 시간: ${Math.ceil(estimatedRemainingTime / 60)}분`);
            }
            
            allResults.push(...batchResults);
            
            // 배치 간 대기 (서버 부하 방지)
            if (i < batches.length - 1) {
                const batchDelay = Math.max(this.delay * 5, 3000); // 최소 3초
                console.log(`⏰ 다음 배치까지 ${batchDelay/1000}초 대기...`);
                await this.sleep(batchDelay);
            }
            
            // 중간 저장 (10배치마다)
            if ((i + 1) % 10 === 0) {
                this.saveIntermediateResults(i + 1);
            }
        }
        
        return allResults;
    }

    saveIntermediateResults(completedBatches) {
        const timestamp = Date.now();
        const filename = `naver_brand_intermediate_batch${completedBatches}_${timestamp}.json`;
        
        const data = {
            savedAt: new Date().toISOString(),
            completedBatches: completedBatches,
            processingStatus: 'in_progress',
            requestCount: this.requestCount,
            summary: {
                totalProcessed: this.results.length + this.failed.length,
                successCount: this.results.length,
                failureCount: this.failed.length,
                successRate: `${(this.results.length / (this.results.length + this.failed.length) * 100).toFixed(1)}%`
            },
            successResults: this.results,
            failedResults: this.failed
        };
        
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 중간 저장 완료: ${filename}`);
        console.log(`   처리 완료: ${data.summary.totalProcessed}개`);
        console.log(`   성공률: ${data.summary.successRate}`);
    }

    saveBatchResults(results, batchIndex) {
        const timestamp = Date.now();
        const filename = `naver_brand_batch_${batchIndex + 1}_${timestamp}.json`;
        
        const data = {
            batchIndex: batchIndex + 1,
            processedAt: new Date().toISOString(),
            requestCount: this.requestCount,
            results: results,
            summary: {
                total: results.length,
                found: results.filter(r => r.status === 'found').length,
                notFound: results.filter(r => r.status === 'not_found').length,
                error: results.filter(r => r.status === 'error').length
            }
        };
        
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 배치 결과 저장: ${filename}`);
    }

    /**
     * 최종 결과 저장
     */
    saveFinalResults() {
        const timestamp = Date.now();
        const elapsedTime = Math.round((Date.now() - this.startTime) / 1000);
        
        const report = {
            processedAt: new Date().toISOString(),
            processingTime: `${elapsedTime}초`,
            apiUsage: {
                totalRequests: this.requestCount,
                dailyLimit: this.dailyLimit,
                usageRate: `${(this.requestCount / this.dailyLimit * 100).toFixed(2)}%`
            },
            summary: {
                totalBrands: this.results.length + this.failed.length,
                foundWebsites: this.results.length,
                failedSearches: this.failed.length,
                successRate: `${(this.results.length / (this.results.length + this.failed.length) * 100).toFixed(1)}%`
            },
            successResults: this.results,
            failedResults: this.failed
        };
        
        // JSON 저장
        const jsonFile = `naver_brand_final_results_${timestamp}.json`;
        fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), 'utf8');
        
        // CSV 저장 (성공한 결과만)
        const csvFile = `naver_brand_websites_${timestamp}.csv`;
        const csvContent = this.generateCSV(this.results);
        fs.writeFileSync(csvFile, csvContent, 'utf8');
        
        console.log(`\n📊 === 최종 결과 ===`);
        console.log(`처리 시간: ${elapsedTime}초`);
        console.log(`API 사용량: ${this.requestCount}/${this.dailyLimit} (${(this.requestCount / this.dailyLimit * 100).toFixed(1)}%)`);
        console.log(`총 브랜드: ${report.summary.totalBrands}개`);
        console.log(`웹사이트 발견: ${report.summary.foundWebsites}개`);
        console.log(`검색 실패: ${report.summary.failedSearches}개`);
        console.log(`성공률: ${report.summary.successRate}`);
        
        console.log(`\n💾 저장된 파일:`);
        console.log(`   전체 보고서: ${jsonFile}`);
        console.log(`   성공 결과 CSV: ${csvFile}`);
        
        return report;
    }

    /**
     * CSV 생성 (개선된 버전)
     */
    generateCSV(results) {
        const headers = [
            'Brand Name', 'English Name', 'Category', 'Is Best',
            'Primary Website', 'All Websites', 'Search Method', 
            'Search Queries Used', 'Domain Guessed', 'Status'
        ];
        const rows = [headers.join(',')];
        
        results.forEach(result => {
            const row = [
                `"${result.brandName || ''}"`,
                `"${result.brandNameEnglish || ''}"`,
                `"${result.category || ''}"`,
                `"${result.isBest ? 'Yes' : 'No'}"`,
                `"${result.primaryWebsite || ''}"`,
                `"${result.websites ? result.websites.join('; ') : ''}"`,
                `"${result.searchMethod || ''}"`,
                `"${result.searchQueries ? result.searchQueries.join('; ') : ''}"`,
                `"${result.guessedDomains && result.guessedDomains.length > 0 ? 'Yes' : 'No'}"`,
                `"${result.status || ''}"`
            ];
            rows.push(row.join(','));
        });
        
        return rows.join('\n');
    }

    /**
     * 배열을 청크로 나누기
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * 대기 함수
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 메인 실행 함수 (재시작 기능 포함)
 */
async function main() {
    try {
        // 네이버 API 키 설정 (환경변수에서 읽기)
        const clientId = process.env.NAVER_CLIENT_ID || 'your_client_id';
        const clientSecret = process.env.NAVER_CLIENT_SECRET || 'your_client_secret';
        
        if (clientId === 'your_client_id' || clientSecret === 'your_client_secret') {
            console.log('❌ 네이버 API 키가 설정되지 않았습니다.');
            console.log('환경변수를 설정하거나 코드에서 직접 설정하세요:');
            console.log('export NAVER_CLIENT_ID="your_actual_client_id"');
            console.log('export NAVER_CLIENT_SECRET="your_actual_client_secret"');
            return;
        }
        
        const collector = new NaverBrandWebsiteCollector(clientId, clientSecret);
        
        console.log('🎯 네이버 검색 API 브랜드 홈페이지 수집기 시작 (재시작 기능 포함)\n');
        
        // 브랜드 파일 로드
        const brandFilePath = './musinsa_brands_merged.json'; // 실제 파일명으로 변경
        
        if (!fs.existsSync(brandFilePath)) {
            console.log('❌ 브랜드 파일을 찾을 수 없습니다.');
            console.log('파일 경로를 확인하거나 올바른 파일명을 입력하세요.');
            return;
        }
        
        // 전체 브랜드 로드
        collector.loadBrandsFromFile(brandFilePath);
        
        // 🔄 이전 작업 상태 확인 및 복원
        console.log('\n🔍 이전 작업 상태 확인 중...');
        const previousResults = collector.loadIntermediateResults();
        
        // 이미 처리된 브랜드 제외하고 남은 브랜드만 처리
        const brandsToProcess = collector.filterUnprocessedBrands(collector.brands, previousResults);
        
        if (brandsToProcess.length === 0) {
            console.log('🎉 모든 브랜드가 이미 처리되었습니다!');
            
            // 최종 결과 재생성 (기존 결과로)
            if (previousResults) {
                collector.saveFinalResults();
            }
            
            return;
        }
        
        // 처리할 브랜드가 있는 경우
        console.log(`\n🚀 ${brandsToProcess.length}개 브랜드 처리 시작 (이어서 진행)`);
        
        if (previousResults) {
            console.log(`📊 현재 상태:`);
            console.log(`   - 이미 완료: ${collector.results.length + collector.failed.length}개`);
            console.log(`   - 남은 작업: ${brandsToProcess.length}개`);
            console.log(`   - 전체 진행률: ${((collector.results.length + collector.failed.length) / collector.brands.length * 100).toFixed(1)}%`);
        }
        
        console.log(`📊 예상 API 사용량: ${Math.ceil(brandsToProcess.length * 0.15)} / 25,000 (도메인 추측으로 85% 절약)`);
        console.log(`⏱️ 예상 소요 시간: ${Math.ceil(brandsToProcess.length * 10 / 3600)}시간`);
        
        // 배치 크기 조정 (API 효율성과 안정성 고려)
        const batchSize = 50; // 96% 성공률이므로 배치 크기 증가
        console.log(`📦 배치 크기: ${batchSize}개씩 처리`);
        
        // 처리 시작 (남은 브랜드만)
        await collector.processBrandsBatch(brandsToProcess, batchSize);
        
        // 최종 결과 저장
        collector.saveFinalResults();
        
        console.log('\n✅ 모든 브랜드 홈페이지 검색이 완료되었습니다!');
        
    } catch (error) {
        console.error('❌ 실행 중 오류:', error.message);
        process.exit(1);
    }
}

// 스크립트 직접 실행 시
if (require.main === module) {
    main();
}

module.exports = { NaverBrandWebsiteCollector };