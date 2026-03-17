const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * دالة الترجمة الذكية: تحول النصوص الإنجليزية إلى عربية مع الحفاظ على التوقيت
 */
async function translateSrt(englishSrt) {
    if (!englishSrt) return null;
    console.log("[TRANSLATOR] 🤖 بدأت عملية التعريب... جاري معالجة الأسطر.");
    
    const lines = englishSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    let translatedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تصفية النصوص فقط (تجاوز التوقيت والأرقام)
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // ترجمة كل 15 سطر معاً لضمان السرعة وعدم الحظر
        if (batchTexts.length === 15 || (i === lines.length - 1 && batchTexts.length > 0)) {
            try {
                // استخدام الفاصل | لضمان عودة النصوص مرتبة
                const res = await translate(batchTexts.join(' | '), { from: 'en', to: 'ar' });
                
                if (res && res.text) {
                    const translatedParts = res.text.split(' | ');
                    for (let j = 0; j < batchIndices.length; j++) {
                        // استبدال النص الإنجليزي بالعربي
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                    translatedCount += batchTexts.length;
                }
                
                // تأخير بسيط جداً لمنع الـ Rate Limit
                await new Promise(resolve => setTimeout(resolve, 50));
                
            } catch (e) {
                console.error(`[TRANSLATOR-ERROR] فشل في ترجمة دفعة: ${e.message}`);
            }
            batchTexts = [];
            batchIndices = [];
        }
    }
    
    console.log(`[TRANSLATOR] ✅ تم تعريب ${translatedCount} جملة بنجاح.`);
    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    // استخراج الوسوم الفنية للمزامنة (BluRay, YTS, WEB-DL...)
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season) baseUrl += `&season=${season}&episode=${episode}`;

        // 1. البحث عن العربية الجاهزة
        console.log(`[SCRAPER] 🔍 البحث عن ترجمة عربية أصلية لـ: ${imdbId}`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            results = await processSubs(arRes.data.subtitles.slice(0, 2), "Original");
        } 

        // 2. إذا لم نجد عربي، نبحث عن إنجليزي مطابق ونترجمه
        if (results.length === 0) {
            console.log(`[SCRAPER] 🔍 لا يوجد عربي. البحث عن نسخة إنجليزية مطابقة فنياً...`);
            const enRes = await axios.get(`${baseUrl}&languages=en`).catch(() => null);

            if (enRes?.data?.subtitles?.length > 0) {
                // ترتيب النتائج بناءً على الوسوم الفنية لضمان أدق مزامنة
                const sortedEnSubs = enRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestEnSub = sortedEnSubs[0];
                console.log(`[SCRAPER-AI] 🎯 اختيار نسخة إنجليزية مطابقة: ${bestEnSub.release_name}`);

                const enSrt = await downloadAndUnzip(bestEnSub.url);
                // هنا يتم استدعاء دالة الترجمة الفعلية
                const translatedAr = await translateSrt(enSrt);
                
                if (translatedAr) {
                    results.push({ 
                        content: translatedAr, 
                        releaseName: bestEnSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ: ${e.message}`); }
    return results;
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

module.exports = { fetchAllPossibleSubs };
