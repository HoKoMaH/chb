const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * دالة التعريب الذكية: تكتشف اللغة تلقائياً وتحولها للعربية
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    console.log("[TRANSLATOR] 🤖 اكتشاف اللغة الأصلية وبدء التعريب الشامل...");
    
    const lines = sourceSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    let translatedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        if (batchTexts.length === 15 || (i === lines.length - 1 && batchTexts.length > 0)) {
            try {
                // نترك 'from' فارغة ليقوم المترجم باكتشاف اللغة (إنجليزي، فرنسي، صيني.. إلخ) تلقائياً
                const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                
                if (res && res.text) {
                    const translatedParts = res.text.split(' | ');
                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                    translatedCount += batchTexts.length;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                console.error(`[TRANSLATOR-ERROR] فشل في ترجمة دفعة: ${e.message}`);
            }
            batchTexts = [];
            batchIndices = [];
        }
    }
    console.log(`[TRANSLATOR] ✅ اكتمل التعريب بنجاح لـ ${translatedCount} جملة.`);
    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    // استخراج الكلمات المفتاحية للمزامنة (BluRay, WEB-DL, YTS...)
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة الأولى: البحث عن كل المصادر العربية المتاحة
        console.log(`[SCRAPER] 🔍 المرحلة 1: البحث عن ترجمات عربية أصلية...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ تم العثور على ${arRes.data.subtitles.length} مصدر عربي.`);
            // جلب أفضل نسختين عربيتين (لضمان التنوع في حال كانت واحدة منهما غير متوافقة)
            results = await processSubs(arRes.data.subtitles.slice(0, 3), "Original");
        } 

        // المرحلة الثانية: إذا لم نجد أي مصدر عربي، نبحث في كل اللغات ونعرب الأفضل
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 المرحلة 2: لم نجد عربي. جاري البحث في كافة اللغات العالمية...`);
            // نطلب كل اللغات المتاحة بدون فلترة
            const allRes = await axios.get(`${baseUrl}`).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                // ترتيب النتائج بناءً على "المطابقة الفنية" لاسم الملف لضمان المزامنة
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0];
                console.log(`[SCRAPER-AI] 🎯 اختيار نسخة عالمية (${bestSub.lang}) للتعريب: ${bestSub.release_name}`);

                const sourceSrt = await downloadAndUnzip(bestSub.url);
                const translatedAr = await translateToArabic(sourceSrt);
                
                if (translatedAr) {
                    results.push({ 
                        content: translatedAr, 
                        releaseName: bestSub.release_name, 
                        source: "AI" 
                    });
                }
            } else {
                console.log(`[SCRAPER] ❌ لا توجد أي ترجمة متوفرة لهذا المحتوى بأي لغة.`);
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ فادح: ${e.message}`); }
    return results;
}

// دالة التحميل وفك الضغط
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

// معالجة وحفظ الترجمات الأصلية
async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

module.exports = { fetchAllPossibleSubs };
