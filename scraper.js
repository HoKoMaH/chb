const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

// دالة الترجمة السريعة (Batching)
async function translateSrt(englishSrt) {
    console.log("[TRANSLATOR] 🚀 بدء معالجة الملف الإنجليزي وترجمته...");
    try {
        const lines = englishSrt.split('\n');
        let batchTexts = [];
        let batchIndices = [];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            // تصفية النصوص فقط (تجاوز التوقيت والأرقام)
            if (line && !line.includes('-->') && isNaN(line)) {
                batchTexts.push(line);
                batchIndices.push(i);
            }

            // إرسال دفعة من 20 سطر لتسريع العملية
            if (batchTexts.length === 20 || (i === lines.length - 1 && batchTexts.length > 0)) {
                try {
                    const combinedText = batchTexts.join(' \n ');
                    const res = await translate(combinedText, { throw: false, to: 'ar' });
                    const translatedParts = res.text.split(' \n ');

                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                } catch (e) {
                    console.error("[TRANSLATOR-LOG] ⚠️ فشلت دفعة، تم الإبقاء على النص الأصلي.");
                }
                batchTexts = [];
                batchIndices = [];
            }
        }
        console.log("[TRANSLATOR] ✅ اكتملت عملية الترجمة الآلية.");
        return lines.join('\n');
    } catch (err) {
        console.error("[TRANSLATOR-ERROR] ❌ فشل المحرك:", err.message);
        return null;
    }
}

async function fetchAllPossibleSubs(imdbId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    console.log("-----------------------------------------");
    console.log(`[SCRAPER] 🔍 فحص الفيلم ID: ${imdbId}`);
    let results = [];

    try {
        // الخطوة 1: البحث عن ترجمة عربية جاهزة (الأولوية القصوى)
        console.log("[SCRAPER-LOG] 1️⃣ محاولة جلب ترجمة عربية جاهزة من SubDL...");
        const arResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${API_KEY}`).catch(() => null);
        
        if (arResponse && arResponse.data && arResponse.data.subtitles.length > 0) {
            console.log(`[SCRAPER-SUCCESS] ✨ وجدنا ${arResponse.data.subtitles.length} ترجمة عربية أصلية.`);
            results = await processSubDLResults(arResponse.data.subtitles.slice(0, 3));
        } 
        
        // الخطوة 2: إذا لم تتوفر ترجمة عربية، ننتقل للحل البديل (الترجمة الآلية)
        if (results.length === 0) {
            console.log(`[SCRAPER-LOG] 2️⃣ لم نجد ترجمة عربية. جاري البحث عن نسخة إنجليزية لترجمتها...`);
            const enResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=en&api_key=${API_KEY}`).catch(() => null);

            if (enResponse && enResponse.data && enResponse.data.subtitles.length > 0) {
                const enSub = enResponse.data.subtitles[0];
                console.log(`[SCRAPER-LOG] 📥 تحميل الملف الإنجليزي: ${enSub.release_name}`);
                
                const enSrt = await downloadAndUnzip(enSub.url);
                if (enSrt) {
                    const translatedAr = await translateSrt(enSrt);
                    if (translatedAr) {
                        results.push({
                            content: translatedAr,
                            releaseName: `${enSub.release_name} (Auto-Translated)`,
                            source: "Google AI Sync"
                        });
                        console.log("[SCRAPER-SUCCESS] ✅ تم توليد الترجمة العربية آلياً بنجاح.");
                    }
                }
            } else {
                console.log("[SCRAPER-ERROR] ❌ لا توجد حتى نسخة إنجليزية متوفرة.");
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-CRITICAL] ❌ خطأ غير متوقع: ${e.message}`);
    }

    console.log(`[SCRAPER] 🏁 المهمة اكتملت. النتائج المتوفرة: ${results.length}`);
    console.log("-----------------------------------------");
    return results;
}

// دالة تحميل وفك الضغط
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        console.error(`[UNZIP-ERROR] فشل الملف: ${err.message}`);
        return null;
    }
}

// دالة معالجة النتائج العربية
async function processSubDLResults(subs) {
    let processed = [];
    for (let sub of subs) {
        const content = await downloadAndUnzip(sub.url);
        if (content) {
            processed.push({ content, releaseName: sub.release_name, source: "SubDL (Original)" });
        }
    }
    return processed;
}

module.exports = { fetchAllPossibleSubs };
