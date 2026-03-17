const scraper = require('./scraper');
// افترضنا وجود موديل للمونجو هنا لتخزين الكاش
// const SubtitleModel = require('./models/subtitle'); 

async function getSyncedSubtitles(imdbId) {
    try {
        console.log(`[ENGINE] جاري معالجة الطلب لـ: ${imdbId}`);

        // 1. محاولة جلب الترجمة من السكرابر
        const subData = await scraper.fetchSubs(imdbId);

        if (subData) {
            // هنا نقوم بصياغة الرابط الذي سيقرأه Stremio
            // إذا كنت تستخدم سيرفر وسيط لتحويل الملف، نضع الرابط هنا
            // للتبسيط، سنفترض أننا سنرسل رابط الملف المستخرج
            
            return {
                proxyUrl: `https://your-app-url.onrender.com/sub/${imdbId}.srt`, // هذا المسار يجب أن يكون معرفاً في index.js
                source: subData.source,
                label: "Arabic Synced"
            };
        }
    } catch (e) {
        console.error(`[ENGINE-ERROR] فشل في المحرك: ${e.message}`);
        throw e;
    }
    return null;
}

// السطر الأهم: تصدير الوظيفة ليراها addon.js
module.exports = { getSyncedSubtitles };
