const scraper = require('./scraper');
const mongoose = require('mongoose');

// 1. تعريف الـ Schema هنا أيضاً لضمان تسجيلها فوراً عند طلب الملف
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

// 2. استخدام الموديل الموجود أو إنشاء واحد جديد (هذا يمنع خطأ MissingSchema)
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId, videoFileName) {
    console.log(`[ENGINE] 🧐 فحص المزامنة لملف: ${videoFileName}`);
    try {
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);
        if (!allSubs || allSubs.length === 0) return [];

        let results = [];
        for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
            const sub = allSubs[i];
            const fileId = `${imdbId}_v${i + 1}_smart`;

            const videoLower = (videoFileName || "").toLowerCase();
            const releaseKeywords = (sub.releaseName || "").toLowerCase().split(/[\s.-]+/);
            const isMatch = videoLower && releaseKeywords.some(kw => 
                kw.length > 3 && videoLower.includes(kw)
            );

            // الحفظ باستخدام المتغير Subtitle المعرف أعلاه
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
        
        return results.sort((a, b) => b.isMatch - a.isMatch);
    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل في المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
