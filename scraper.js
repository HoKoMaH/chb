const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. محرك التعريب الذكي (إصدار الملفات الضخمة + إجبار العربية)
 * @param {string} sourceSrt - نص ملف SRT الأصلي
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    
    const lines = sourceSrt.split('\n');
    let translatedLines = [...lines]; // نسخة مطابقة للعمل عليها
    let batchTexts = [];
    let batchIndices = [];
    
    console.log(`[TRANSLATOR] 🚀 بدء تعريب ملف ضخم (${lines.length} سطر)...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // تصفية الأسطر: نأخذ فقط النصوص (نتجاهل التوقيت والأرقام)
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // معالجة دفعات صغيرة جداً (5 أسطر فقط) لضمان استقرار الترجمة من أي لغة (فارسي، صيني، إلخ)
        if (batchTexts.length === 5 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = 3;

            while (!success && retries > 0) {
                try {
                    // forceTo: true تجبر المحرك على التحويل للعربية مهما كانت لغة المصدر
                    const res = await translate(batchTexts.join(' \n '), { 
                        to: 'ar', 
                        forceTo: true 
                    });
                    
                    if (res && res.text) {
                        const translatedParts = res.text.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            // وضع النص المترجم في مكانه مع الحفاظ على هيكل الملف
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    console.log(`[WAIT] ⚠️ ضغط مؤقت من جوجل.. انتظار 4 ثوانٍ...`);
                    await new Promise(r => setTimeout(r, 4000));
                }
            }
            
            // تفريغ الدفعة الحالية
            batchTexts = [];
            batchIndices = [];

            // تحديث اللوقات كل 100 سطر لمراقبة التقدم في Render
            if (i % 100 === 0) {
                let progress = ((i / lines.length) * 100).toFixed(1);
                console.log(`[PROGRESS] ⏳ اكتمل ${progress}% (${i}/${lines.length} سطر)`);
            }
            
            // أهم خطوة: تأخير بسيط (Cooldown) لمنع حظر الـ IP
            await new Promise(r => setTimeout(r, 500)); 
        }
    }
    
    console.log(`[TRANSLATOR] ✅ اكتمل تعريب الملف بالكامل بنجاح.`);
    return translatedLines.join('\n');
}

/**
 * 2. جلب كافة الترجمات من SubDL (يدعم المسلسلات والأفلام)
 */
async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const [imdbId, season, episode] = fullId.split(':');
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|YTS|PSA|AMZN|H264|H265)/g) || [];

    let results = [];

    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // البحث عن العربية الأصلية أولاً
        console.log(`[SCRAPER] 🔍 جلب الترجمات العربية لـ ${fullId}...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            for (let s of arRes.data.subtitles) {
                const content = await downloadAndUnzip(s.url);
                if (content) {
                    results.push({ content, releaseName: s.release_name, source: "Original" });
                }
            }
            return results; // نكتفي بالأصلي إذا وجد
        }

        // إذا لم يوجد عربي، نجلب أفضل نسخة أجنبية ونعربها آلياً
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                return scoreB - scoreA;
            });

            const bestSub = sortedSubs[0]; 
            const sourceContent = await downloadAndUnzip(bestSub.url);
            const translatedContent = await translateToArabic(sourceContent);
            
            if (translatedContent) {
                results.push({ content: translatedContent, releaseName: bestSub.release_name, source: "AI" });
            }
        }
    } catch (e) {
        console.error(`[SCRAPER-ERROR] ❌: ${e.message}`);
    }
    return results;
}

/**
 * 3. تحميل وفك ضغط ملفات SubDL
 */
async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const srtEntry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.srt'));
        return srtEntry ? srtEntry.getData().toString('utf8') : null;
    } catch (err) {
        return null;
    }
}

module.exports = { fetchAllPossibleSubs, translateToArabic };
