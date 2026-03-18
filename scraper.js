const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. محرك التعريب الذكي - يدعم (فارسي، إنجليزي، صيني) إلى العربية
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    
    // تنظيف النص من أي رموز غريبة قد تسبب فشل المكتبة
    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    let translatedLines = [...lines]; 
    let batchTexts = [];
    let batchIndices = [];
    
    console.log(`[TRANSLATOR] 🚀 بدء تعريب ملف (${lines.length} سطر)...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تصفية: نأخذ فقط نصوص الحوار
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // دفعات صغيرة (7 أسطر) لضمان عدم خلط الفارسية بالعربية
        if (batchTexts.length === 7 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = 3;

            while (!success && retries > 0) {
                try {
                    // نستخدم translate من المكتبة مع ضبط اللغة الهدف للعربية
                    const res = await translate(batchTexts.join('\n'), { 
                        to: 'ar',
                        forceTo: true // إجبار التحويل للعربية مهما كانت اللغة المكتشفة
                    });
                    
                    if (res && res.text) {
                        const translatedParts = res.text.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            // إذا فشل سطر معين نضع النص الأصلي بدلاً من تركه فارغاً
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    console.log(`[WAIT] ⚠️ ضغط أو لغة غير مفهومة.. محاولة ${3-retries}/3...`);
                    await new Promise(r => setTimeout(r, 3000)); // انتظار قبل المحاولة التالية
                }
            }
            
            batchTexts = [];
            batchIndices = [];

            // لوقات التقدم
            if (i % 200 === 0) {
                console.log(`[PROGRESS] ⏳ تم معالجة ${i} سطر...`);
            }
            
            // Cooldown بسيط لتجنب الحظر
            await new Promise(r => setTimeout(r, 400)); 
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل تعريب الملف بنجاح.`);
    return translatedLines.join('\n');
}

/**
 * 2. جلب الترجمات من SubDL
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    const tags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|YTS|PSA|AMZN)/g) || [];

    let results = [];
    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) url += `&season=${season}&episode=${episode}`;

        // جلب العربي أولاً
        const arRes = await axios.get(`${url}&languages=ar`).catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) {
            for (let s of arRes.data.subtitles.slice(0, 2)) {
                const content = await downloadAndUnzip(s.url);
                if (content) results.push({ content, releaseName: s.release_name, source: "Original" });
            }
            if (results.length > 0) return results;
        }

        // إذا لم يوجد عربي، نجلب الأجنبي (فارسي أو إنجليزي) ونعربه
        const allRes = await axios.get(url).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const bestSub = allRes.data.subtitles[0];
            const sourceContent = await downloadAndUnzip(bestSub.url);
            const translated = await translateToArabic(sourceContent);
            if (translated) results.push({ content: translated, releaseName: bestSub.release_name, source: "AI" });
        }
    } catch (e) { console.error("Scraper Error:", e.message); }
    return results;
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { return null; }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
