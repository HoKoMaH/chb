const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * دالة التعريب الذكية: تكتشف اللغة الأصلية وتحولها للعربية
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    console.log("[TRANSLATOR] 🤖 بدء عملية التعريب الشامل لأي لغة متاحة...");
    
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
                // كشف اللغة تلقائياً والترجمة للعربي
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

    // استخراج وسوم المزامنة (YTS, BluRay, PSA...)
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة 1: جلب "كافة" المصادر العربية المتاحة بلا استثناء
        console.log(`[SCRAPER] 🔍 المرحلة 1: جلب كافة الترجمات العربية الأصلية...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ تم العثور على ${arRes.data.subtitles.length} ملف عربي. جاري التحميل...`);
            // نقوم بمعالجة "كل" الملفات المرجعة من الـ API
            results = await processSubs(arRes.data.subtitles, "Original");
        } 

        // المرحلة 2: إذا لم يوجد أي ملف عربي نهائياً، نبحث عالمياً ونترجم الأفضل
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 المرحلة 2: لا يوجد عربي. البحث عن أفضل نسخة عالمية للمزامنة...`);
            const allRes = await axios.get(`${baseUrl}`).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                // ترتيب بناءً على مطابقة اسم الملف
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0];
                console.log(`[SCRAPER-AI] 🎯 تعريب نسخة (${bestSub.lang}): ${bestSub.release_name}`);

                const sourceSrt = await downloadAndUnzip(bestSub.url);
                const translatedAr = await translateToArabic(sourceSrt);
                
                if (translatedAr) {
                    results.push({ 
                        content: translatedAr, 
                        releaseName: bestSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ: ${e.message}`); }
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

// معالجة وحفظ الترجمات
async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

module.exports = { fetchAllPossibleSubs };
