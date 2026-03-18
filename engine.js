const mongoose = require('mongoose');
const scraper = require('./scraper');

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(fullId, videoFileName) {
    let results = [];

    try {
        // المرحلة 1: البحث في قاعدة البيانات المحلية أولاً (سرعة فائقة)
        const localSubs = await Subtitle.find({ imdbId: fullId }).sort({ createdAt: -1 });
        
        if (localSubs.length > 0) {
            console.log(`[ENGINE] ✅ إرسال ${localSubs.length} ترجمة من القاعدة المحلية.`);
            return localSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI
            }));
        }

        // المرحلة 2: إذا كانت القاعدة فارغة، نذهب للجلب الخارجي
        console.log(`[ENGINE] 🔍 جاري سحب الترجمات من المصادر الخارجية لـ ${fullId}...`);
        const externalSubs = await scraper.fetchAllPossibleSubs(fullId, videoFileName);
        
        if (!externalSubs || externalSubs.length === 0) return [];

        // معالجة وحفظ كل الملفات المجلوبة
        for (let sub of externalSubs) {
            const newFileId = `${fullId.replace(/:/g, '_')}_${sub.source}_${Date.now()}_${Math.floor(Math.random() * 100)}`;
            
            const savedSub = new Subtitle({
                fileId: newFileId,
                imdbId: fullId,
                arabicText: sub.content,
                label: sub.releaseName || "Source",
                isAI: sub.source === "AI"
            });

            await savedSub.save();
            
            results.push({
                fileId: savedSub.fileId,
                label: savedSub.label,
                isAI: savedSub.isAI
            });
        }

        return results;

    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌ فشل المحرك: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
