const scraper = require('./scraper');
const mongoose = require('mongoose');

// تعريف الـ Schema لضمان عدم وجود MissingSchemaError
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

// استدعاء الموديل بطريقة آمنة (إذا كان موجوداً استخدمه، وإذا لا انشئه)
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

            // منطق المطابقة الذكية
            const releaseNameLower = sub.releaseName.toLowerCase();
            const videoFileNameLower = videoFileName.toLowerCase();
            
            // كلمات مفتاحية للمطابقة (CiNEPHiLES, YTS, BluRay, إلخ)
            const releaseKeywords = releaseNameLower.split(/[\s.-]+/);
            const isMatch = videoFileNameLower && releaseKeywords.some(kw => 
                kw.length > 3 && videoFileNameLower.includes(kw)
            );

            // استخدام المتغير Subtitle المعرف أعلاه
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: imdbId, 
                    arabicText: sub.content, 
                    label: sub.releaseName 
                },
                { upsert: true, new: true }
            );
            
            results.push({ 
                fileId: fileId, 
                label: sub.releaseName, 
                isMatch: isMatch 
            });
        }
        
        // ترتيب النتائج بحيث تظهر ⭐ أولاً
        return results.sort((a, b) => b.isMatch - a.isMatch);

    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل في المحرك: ${e.message}`);
    }
    return [];
}

module.exports = { getSyncedSubtitles };
