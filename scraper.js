const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

/**
 * 1. محرك التعريب الذكي - يدعم (فارسي، إنجليزي، صيني) إلى العربية
 * تم دمج تقنية الانتظار التصاعدي وتصغير الدفعات لتجنب الحظر
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
        
        // تصفية: نأخذ فقط نصوص الحوار (نتجاهل التوقيت والأرقام)
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        // استخدام دفعات صغيرة جداً (3-5 أسطر) لضمان عدم الحظر ودقة الفارسية
        if (batchTexts.length === 3 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false;
            let retries = 3;

            while (!success && retries > 0) {
                try {
                    // نستخدم translate من المكتبة مع إجبار اللغة العربية
                    const res = await translate(batchTexts.join('\n'), { 
                        to: 'ar',
                        forceTo: true 
                    });
                    
                    if (res && res.text) {
                        const translatedParts = res.text.split('\n');
                        for (let j = 0; j < batchIndices.length; j++) {
                            // وضع النص المترجم في مكانه الصحيح
                            translatedLines[batchIndices[j]] = translatedParts[j]?.trim() || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    // انتظار تصاعدي: كلما فشل زاد وقت الانتظار (5ث، 10ث، 15ث)
                    const waitTime = (4 - retries) * 5000; 
                    console.log(`[WAIT] ⚠️ ضغط أو لغة غير مفهومة.. محاولة ${3-retries}/3.. انتظار ${waitTime/1000}ث`);
                    await new Promise(r => setTimeout(r, waitTime)); 
                }
            }
            
            batchTexts = [];
            batchIndices = [];

            // لوقات التقدم كل 200 سطر
            if (i % 200 === 0) {
                let progress = ((i / lines.length) * 100).toFixed(1);
                console.log(`[PROGRESS] ⏳ تم معالجة ${progress}% (${i}/${lines.length} سطر)...`);
            }
            
            // Cooldown إلزامي بين الطلبات لمنع الـ IP Block
            await new Promise(r => setTimeout(r, 1000)); 
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
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|YTS|PSA|AMZN|WEBRIP)/g) || [];

    let results = [];
    try {
        let baseUrl = `https://api.subdl.com/api/v1/subtitles?imdb_id=${imdbId}&api_key=${API_KEY}`;
        if (season && episode) baseUrl += `&season=${season}&episode=${episode}`;

        // جلب العربي الأصلي أولاً
        console.log(`[SCRAPER] 🔍 البحث عن ترجمة عربية أصلية لـ ${fullId}...`);
        const arRes = await axios.get(`${baseUrl}&languages=ar`).catch(() => null);
        
        if (arRes?.data?.subtitles?.length > 0) {
            for (let s of arRes.data.subtitles.slice(0, 2)) {
                const content = await downloadAndUnzip(s.url);
                if (content) results.push({ content, releaseName: s.release_name, source: "Original" });
            }
            if (results.length > 0) return results;
        }

        // إذا لم يوجد عربي، نجلب الأجنبي (فارسي/إنجليزي) ونبدأ التعريب الآلي
        const allRes = await axios.get(baseUrl).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            // ترتيب النتائج حسب مطابقة الجودة (Technical Tags)
            const sortedSubs = allRes.data.subtitles.sort((a, b) => {
                const scoreA = technicalTags.filter(tag => a.release_name.toUpperCase().includes(tag)).length;
                const scoreB = technicalTags.filter(tag => b.release_name.toUpperCase().includes(tag)).length;
                return scoreB - scoreA;
            });

            const bestSub = sortedSubs[0]; 
            const sourceContent = await downloadAndUnzip(bestSub.url);
            
            if (sourceContent) {
                const translated = await translateToArabic(sourceContent);
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
