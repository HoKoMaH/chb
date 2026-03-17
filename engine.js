const scraper = require('./scraper');
const mongoose = require('mongoose');

// تعريف الـ Schema هنا أيضاً كأمان إضافي لمنع خطأ MissingSchema
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

// استخدام الموديل الموجود أو إنشاؤه فوراً
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`[ENGINE] 🧐 فحص المزامنة لملف: ${videoFileName}`);
    try {
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        if (!allSubs || allSubs.length === 0) {
            console.log(`[ENGINE] ⚠️ لم يتم العثور على ترجمات من المصدر.`);
            return [];
        }

        let results = [];
        for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}_smart`;

            // منطق المطابقة الذكية ⭐
            const videoLower = (videoFileName || "").toLowerCase();
            const releaseLower = (sub.releaseName || "").toLowerCase();
            
            // البحث عن كلمات مفتاحية مشتركة (YTS, BluRay, CiNEPHiLES...)
            const releaseKeywords = releaseLower.split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => 
                kw.length > 3 && videoLower.includes(kw)
            );

            // حفظ النسخة في القاعدة
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName 
                },
                { upsert: true, new: true }
            );
            
            results.push({ fileId, label: sub.releaseName, isMatch });
        }
        
        // ترتيب النتائج لتظهر ⭐ في الأعلى
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل في المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
