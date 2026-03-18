const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. محرك التعريب الذكي - إصدار "الحماية القصوى"
 * تم تحسينه للتعامل مع الملفات الضخمة وتجنب حظر الـ IP
 */
async function translateToArabic(sourceSrt, onProgress) {
    if (!sourceSrt) return null;
    
    // تنظيف النص وتجهيز الأسطر
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines]; 
    let batchTexts = [];
    let batchIndices = [];
    
    // إعدادات الحماية (تغيير هذه القيم يؤثر على سرعة الحظر)
    const BATCH_SIZE = 15; // عدد الأسطر في كل طلب (توازن بين السرعة والأمان)
    const SUCCESS_COOLDOWN = 3000; // انتظار 3 ثوانٍ بعد كل عملية ناجحة
    const MAX_RETRIES = 5; // عدد محاولات إعادة الاتصال عند الفشل

    console.log(`[TRANSLATOR] 🚀 بدء تعريب ملف ضخم (${lines.length} سطر)...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تصفية: نأخذ نصوص الحوار فقط
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // تنفيذ الترجمة عند اكتمال الدفعة أو نهاية الملف
        if (batchTexts.length === BATCH_SIZE || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = MAX_RETRIES;

            while (!success && retries > 0) {
                try {
                    // إرسال الدفعة للترجمة
                    const res = await translate(batchTexts.join('\n'), { 
                        to: 'ar',
                        forceTo: true 
                    });
                    
                    if (res && res.text) {
                        const translatedParts = res.text.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            // دمج النص المترجم في مصفوفة الأسطر الأصلية
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    // انتظار تصاعدي طويل جداً عند حدوث خطأ (10ث، 20ث، 30ث...)
                    const waitTime = (MAX_RETRIES + 1 - retries) * 10000; 
                    console.log(`[⚠️ RETRY] ضغط عالي من جوجل.. محاولة ${MAX_RETRIES - retries}/${MAX_RETRIES}.. انتظار ${waitTime/1000} ثانية`);
                    await new Promise(r => setTimeout(r, waitTime)); 
                }
            }
            
            // تصفير الدفعة للبدء بالتي تليها
            batchTexts = [];
            batchIndices = [];

            // إرسال التحديث لواجهة المستخدم (شريط التقدم)
            if (onProgress) {
                let percent = Math.floor((i / lines.length) * 100);
                onProgress(percent);
            }

            // لوق داخلي كل 200 سطر لمدير السيرفر
            if (i % 200 === 0) {
                console.log(`[PROGRESS] ⏳ تم إنجاز ${((i / lines.length) * 100).toFixed(1)}%`);
            }
            
            // راحة إجبارية للسيرفر لمنع كشف الـ Bot
            await new Promise(r => setTimeout(r, SUCCESS_COOLDOWN)); 
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل التعريب الشامل بنجاح.`);
    return translatedLines.join('\n');
}

/**
 * 2. جلب الترجمات من SubDL
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|YTS|PSA|AMZN|WEBRIP)/g) || [];

    let results = [];
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // محاولة جلب ترجمة عربية جاهزة أولاً لتوفير الموارد
        console.log(`[SCRAPER] 🔍 يبحث عن ترجمة عربية جاهزة...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            for (let s of arRes.data.subtitles.slice(0, 2)) {
                const content = await downloadAndUnzip(s.url);
                if (content) results.push({ content, releaseName: s.release_name, source: "Original" });
            }
            if (results.length > 0) return results;
        }

        // إذا لم توجد ترجمة عربية، نجلب الأجنبية (إنجليزية/فارسية) ونعربها آلياً
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            // ترتيب حسب مطابقة جودة الفيديو
            const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                return scoreB - scoreA;
            });

            const bestSub = sortedSubs[0]; 
            const sourceContent = await downloadAndUnzip(bestSub.url);
            
            if (sourceContent) {
                // نمرر null لأنها عملية خلفية تلقائية لا تحتاج شريط تقدم حي
                const translated = await translateToArabic(sourceContent, null);
                if (translated) {
                    results.push({ content: translated, releaseName: bestSub.release_name, source: "AI" });
                }
            }
        }
    } catch (e) { 
        console.error(`[SCRAPER ERROR] ❌: ${e.message}`); 
    }
    return results;
}

/**
 * 3. تحميل وفك ضغط ملفات SubDL
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { 
            responseType: 'arraybuffer',
            timeout: 15000 
        });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { 
        return null; 
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
