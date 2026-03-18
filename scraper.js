const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. دالة التعريب الذكية (تستخدمها العمليات التلقائية واليدوية)
 * تشمل عداد النسبة المئوية ولوقات دقيقة
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    
    const lines = sourceSrt.split('\n');
    let batchTexts = [];
    let batchIndices = [];
    const totalLines = lines.length;
    let processedLines = 0;

    console.log(`[TRANSLATOR] 🤖 بدء عملية التعريب.. إجمالي الأسطر: ${totalLines}`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تصفية النصوص فقط للترجمة (تجاهل التوقيت والأرقام)
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // معالجة كل 15 سطر لضمان الجودة وعدم الحظر
        if (batchTexts.length === 15 || (i === lines.length - 1 && batchTexts.length > 0)) {
            try {
                // كشف اللغة تلقائياً والترجمة للعربية
                const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                
                if (res && res.text) {
                    const translatedParts = res.text.split(' | ');
                    for (let j = 0; j < batchIndices.length; j++) {
                        lines[batchIndices[j]] = translatedParts[j] || batchTexts[j];
                    }
                }
                
                // تحديث العداد في اللوق
                processedLines = i;
                const percentage = ((processedLines / totalLines) * 100).toFixed(1);
                console.log(`[PROGRESS] ⏳ تم تحويل: ${percentage}% (${processedLines}/${totalLines})`);

                // تأخير بسيط جداً (Safe Delay)
                await new Promise(resolve => setTimeout(resolve, 80));
            } catch (e) {
                console.error(`[TRANSLATOR-ERROR] خطأ في السطر ${i}: ${e.message}`);
            }
            batchTexts = [];
            batchIndices = [];
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل التعريب بنجاح 100%`);
    return lines.join('\n');
}

/**
 * 2. المحرك الأساسي للبحث (Scraper Engine)
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    let results = [];

    // استخراج وسوم المزامنة من اسم الملف
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|BRRIP|YTS|PSA|AMZN|DSNP|H264|H265)/g) || [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // المرحلة الأولى: جلب كل المصادر العربية المتاحة
        console.log(`[SCRAPER] 🔍 المرحلة 1: جلب كافة التراجم العربية الأصلية...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            console.log(`[SCRAPER] ✨ وجدنا ${arRes.data.subtitles.length} ملف عربي أصلي.`);
            results = await processSubs(arRes.data.subtitles, "Original");
        } 

        // المرحلة الثانية: إذا لم يتوفر عربي، نبحث عالمياً ونعرب الأفضل
        if (results.length === 0) {
            console.log(`[SCRAPER] 🌍 المرحلة 2: لا يوجد عربي. البحث العالمي عن أفضل مزامنة...`);
            const allRes = await axios.get(`${baseUrl}`).catch(() => null);

            if (allRes?.data?.subtitles?.length > 0) {
                // ترتيب الملفات العالمية بناءً على وسوم المزامنة (Match Scoring)
                const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                    const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                    const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                    return scoreB - scoreA;
                });

                const bestSub = sortedSubs[0];
                console.log(`[SCRAPER-AI] 🎯 اختيار نسخة (${bestSub.lang}) للتعريب: ${bestSub.release_name}`);

                const sourceSrt = await downloadAndUnzip(bestSub.url);
                
                // بدء التعريب التلقائي
                const translatedContent = await translateToArabic(sourceSrt);
                
                if (translatedContent) {
                    results.push({ 
                        content: translatedContent, 
                        releaseName: bestSub.release_name, 
                        source: "AI" 
                    });
                }
            }
        }
    } catch (e) { console.error(`[SCRAPER-CRITICAL] ❌ خطأ فادح: ${e.message}`); }
    return results;
}

/**
 * 3. الدوال المساعدة للتحميل والمعالجة
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) { 
        console.error(`[DOWNLOADER-ERROR] فشل تحميل الملف من SubDL`);
        return null; 
    }
}

async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

/**
 * 4. تصدير الدوال للاستخدام في engine.js و index.js
 */
module.exports = { 
    fetchAllPossibleSubs, 
    translateToArabic // مهم جداً لتشغيل زر التعريب الفوري في الموقع
};
