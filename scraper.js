const axios = require('axios');
const AdmZip = require('adm-zip');
const { Perplexity } = require('perplexity-ai');

// إعداد عميل Perplexity
const pp_client = new Perplexity(process.env.PERPLEXITY_API_KEY);

async function translateWithAI(englishSrt) {
    console.log("-----------------------------------------");
    console.log("[AI-PROCESS] 🤖 بدء عملية الترجمة الذكية...");
    
    // تقسيم النص إلى أجزاء (Chunks) لتفادي حدود الـ Tokens في Perplexity
    // سنأخذ أول 3000 حرف كمرحلة أولى للتجربة (يمكنك توسيعها لاحقاً)
    const srtToTranslate = englishSrt.slice(0, 4000); 
    console.log(`[AI-LOG] حجم النص المراد ترجمته: ${srtToTranslate.length} حرفاً.`);

    const prompt = `You are a professional subtitle translator. Translate the following English SRT content to natural, high-quality Arabic. 
    IMPORTANT: Keep the timing (00:00:00,000 --> 00:00:00,000) exactly the same. 
    Only return the translated SRT content.
    \n\n${srtToTranslate}`;

    try {
        console.log("[AI-LOG] 📡 إرسال الطلب إلى Perplexity AI...");
        const startTime = Date.now();

        const response = await pp_client.chat.create({
            model: "sonar-reasoning", 
            messages: [{ role: "user", content: prompt }]
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[AI-SUCCESS] ✅ تمت الترجمة بنجاح في ${duration} ثانية.`);
        
        return response.choices[0].message.content;
    } catch (e) {
        console.error(`[AI-ERROR] ❌ فشل الاتصال بـ Perplexity: ${e.message}`);
        return null;
    }
}

async function fetchAllPossibleSubs(imdbId) {
    const API_KEY = process.env.SUBDL_API_KEY;
    console.log("-----------------------------------------");
    console.log(`[SCRAPER] 🔍 فحص المصادر لـ: ${imdbId}`);
    
    let results = [];

    try {
        // الخطوة 1: البحث عن ترجمة عربية جاهزة
        console.log("[SCRAPER-LOG] 1️⃣ البحث عن ترجمة عربية (Original Arabic)...");
        const arResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=ar&api_key=${API_KEY}`);
        
        if (arResponse.data && arResponse.data.subtitles.length > 0) {
            console.log(`[SCRAPER-SUCCESS] ✨ وجدنا ${arResponse.data.subtitles.length} ترجمة عربية جاهزة.`);
            // معالجة أول 3 نتائج عربية
            results = await processSubDLResults(arResponse.data.subtitles.slice(0, 3));
        } else {
            console.log("[SCRAPER-LOG] ⚠️ لم تتوفر ترجمة عربية جاهزة.");

            // الخطوة 2: البحث عن ترجمة إنجليزية للقيام بالترجمة الآلية
            console.log("[SCRAPER-LOG] 2️⃣ البحث عن ترجمة إنجليزية (English Source) للتحويل...");
            const enResponse = await axios.get(`https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&languages=en&api_key=${API_KEY}`);

            if (enResponse.data && enResponse.data.subtitles.length > 0) {
                const enSub = enResponse.data.subtitles[0];
                console.log(`[SCRAPER-LOG] 📥 تحميل النسخة الإنجليزية: ${enSub.release_name}`);

                const enSrt = await downloadAndUnzip(enSub.url);
                
                if (enSrt) {
                    console.log("[SCRAPER-LOG] 🛠️ تم تحميل ملف الـ SRT الإنجليزي بنجاح.");
                    
                    // الخطوة 3: استدعاء الذكاء الاصطناعي للترجمة
                    const arSrt = await translateWithAI(enSrt);
                    
                    if (arSrt) {
                        results.push({
                            content: arSrt,
                            releaseName: `${enSub.release_name} (AI Arabic)`,
                            source: "Perplexity AI"
                        });
                        console.log("[SCRAPER-LOG] 💾 تم إضافة الترجمة الذكية للنتائج.");
                    }
                }
            } else {
                console.log("[SCRAPER-ERROR] ❌ لا توجد حتى نسخة إنجليزية لهذا الفيلم.");
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-CRITICAL-ERROR] ❌ خطأ في السكرابر: ${e.message}`);
    }

    console.log(`[SCRAPER] 🏁 انتهت المهمة. إجمالي النتائج الموفرة: ${results.length}`);
    console.log("-----------------------------------------");
    return results;
}

// دالة تحميل وفك الضغط مع لوقات
async function downloadAndUnzip(subUrl) {
    try {
        const fullUrl = `https://dl.subdl.com${subUrl}`;
        const res = await axios.get(fullUrl, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        console.error(`[UNZIP-ERROR] فشل تحميل/فك ضغط الملف: ${err.message}`);
        return null;
    }
}

// دالة معالجة النتائج العربية الجاهزة
async function processSubDLResults(subs) {
    let processed = [];
    for (let sub of subs) {
        const content = await downloadAndUnzip(sub.url);
        if (content) {
            processed.push({
                content: content,
                releaseName: sub.release_name,
                source: "SubDL (Arabic)"
            });
        }
    }
    return processed;
}

module.exports = { fetchAllPossibleSubs };
